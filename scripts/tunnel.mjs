import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import localtunnel from "localtunnel";

function toPort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = toPort(process.env.PORT, 4200);
const subdomain = (process.env.TUNA_SUBDOMAIN ?? process.env.TUNNEL_SUBDOMAIN ?? "").trim();
const host = (process.env.TUNA_HOST ?? process.env.TUNNEL_HOST ?? "").trim();
const rawProvider = (process.env.TUNA_PROVIDER ?? process.env.TUNNEL_PROVIDER ?? "auto").trim().toLowerCase();
const providerAliases = new Map([
  ["tuna", "localtunnel"],
  ["lt", "localtunnel"],
  ["cloudflare", "cloudflared"],
  ["cf", "cloudflared"],
]);
const normalizedProvider = providerAliases.get(rawProvider) ?? rawProvider;
const provider = new Set(["auto", "cloudflared", "localtunnel"]).has(normalizedProvider)
  ? normalizedProvider
  : "auto";
const healthIntervalMs = toPositiveInt(process.env.TUNNEL_HEALTH_INTERVAL_MS, 12000);
const maxHealthFailures = toPositiveInt(process.env.TUNNEL_MAX_HEALTH_FAILURES, 10);
const healthGraceMs = toPositiveInt(process.env.TUNNEL_HEALTH_GRACE_MS, 30000);
const unstableWindowMs = toPositiveInt(process.env.TUNNEL_UNSTABLE_WINDOW_MS, 8 * 60 * 1000);
const unstableThreshold = toPositiveInt(process.env.TUNNEL_UNSTABLE_RESTARTS, 2);
const localFallbackMs = toPositiveInt(process.env.TUNNEL_LOCAL_FALLBACK_MS, 30 * 60 * 1000);
const maxEdgeFailures = toPositiveInt(process.env.TUNNEL_MAX_EDGE_FAILURES, 2);
const cloudflaredProtocol = (process.env.TUNNEL_CLOUDFLARED_PROTOCOL ?? "http2").trim().toLowerCase();
const cloudflaredCacheDir = path.join(process.cwd(), "runtime", "bin");
const tunnelStateFile = path.join(process.cwd(), "runtime", "tunnel-current.json");
const unhealthyStatuses = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const edgeFailureStatuses = new Set([521, 522, 523, 525, 526, 530]);
const cloudflareForcedRestartPatterns = [
  /origin has been unregistered from argo tunnel/i,
  /unregistered from argo tunnel/i,
  /failed to serve tunnel connection/i,
];

let stopping = false;
let activeTunnel = null;
let activeProcess = null;
let cloudflareUnstableAt = [];
let forceLocaltunnelUntil = 0;

function logReady(url) {
  console.log(`[tunnel] Public URL: ${url}`);
  console.log(`[tunnel] App URL: ${url}`);
  console.log(`[tunnel] Admin URL: ${url}/admin`);
  console.log("[tunnel] If you see Cloudflare 1033, use the latest Public URL from this console.");
}

function persistTunnelState(url, currentProvider) {
  const payload = {
    url,
    provider: currentProvider,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdir(path.dirname(tunnelStateFile), { recursive: true })
    .then(() => fs.writeFile(tunnelStateFile, `${JSON.stringify(payload, null, 2)}\n`))
    .catch(() => {
      // Ignore persistence failures.
    });
}

function rememberCloudflareInstability(reason) {
  const now = Date.now();
  cloudflareUnstableAt = cloudflareUnstableAt.filter((timestamp) => now - timestamp <= unstableWindowMs);
  cloudflareUnstableAt.push(now);

  console.warn(
    `[tunnel] cloudflare instability (${reason}) ${cloudflareUnstableAt.length}/${unstableThreshold} in ${Math.floor(
      unstableWindowMs / 1000,
    )}s window`,
  );

  if (cloudflareUnstableAt.length >= unstableThreshold) {
    forceLocaltunnelUntil = now + localFallbackMs;
    console.warn(
      `[tunnel] Switching to localtunnel for ${Math.floor(localFallbackMs / 60000)} minutes to avoid Cloudflare 1033`,
    );
  }
}

async function isLocalOriginHealthy() {
  try {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 2500);
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: timeoutController.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

function createTunnelMonitor(publicUrl, onUnhealthy) {
  let stopped = false;
  const healthUrl = new URL("/health", publicUrl).toString();
  const startedAt = Date.now();

  const done = (async () => {
    let failures = 0;
    let edgeFailures = 0;

    while (!stopping && !stopped) {
      await sleep(healthIntervalMs);
      if (stopping || stopped) {
        break;
      }

      if (Date.now() - startedAt < healthGraceMs) {
        continue;
      }

      try {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), Math.min(7000, healthIntervalMs));
        const response = await fetch(healthUrl, {
          headers: {
            "user-agent": "yooh-tunnel-monitor",
            "bypass-tunnel-reminder": "1",
          },
          signal: timeoutController.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok || !unhealthyStatuses.has(response.status)) {
          failures = 0;
          edgeFailures = 0;
          continue;
        }

        failures += 1;
        const localHealthy = await isLocalOriginHealthy();
        if (localHealthy && edgeFailureStatuses.has(response.status)) {
          edgeFailures += 1;
          console.warn(
            `[tunnel] Edge status ${response.status} with healthy origin ${edgeFailures}/${maxEdgeFailures}`,
          );
        } else {
          edgeFailures = 0;
        }
        console.warn(`[tunnel] Health check failed (${response.status}) ${failures}/${maxHealthFailures}`);
      } catch (error) {
        const localHealthy = await isLocalOriginHealthy();
        if (localHealthy && /aborted/i.test(String(error?.message ?? error))) {
          console.warn("[tunnel] Health probe timeout ignored (origin healthy).");
          continue;
        }
        failures += 1;
        edgeFailures = 0;
        console.warn(`[tunnel] Health check failed (${error?.message ?? error}) ${failures}/${maxHealthFailures}`);
      }

      if ((edgeFailures >= maxEdgeFailures || failures >= maxHealthFailures) && !stopped && !stopping) {
        const reason =
          edgeFailures >= maxEdgeFailures
            ? `edge failures ${edgeFailures}/${maxEdgeFailures}`
            : `health failures ${failures}/${maxHealthFailures}`;
        console.warn(`[tunnel] Public tunnel looks unavailable (${reason}). Restarting...`);
        try {
          await onUnhealthy();
        } catch {
          // Ignore forced close failures.
        }
        return;
      }
    }
  })();

  return {
    stop() {
      stopped = true;
    },
    done,
  };
}

async function commandExists(command) {
  return canRunCommand(command, ["--version"]);
}

async function canRunCommand(command, args = ["--version"]) {
  return new Promise((resolve) => {
    const probe = spawn(command, args, { stdio: "ignore", shell: false });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
}

function getCloudflaredAssetName() {
  if (process.platform !== "win32") {
    return "";
  }
  if (process.arch === "arm64") {
    return "cloudflared-windows-arm64.exe";
  }
  return "cloudflared-windows-amd64.exe";
}

async function ensureBundledCloudflared() {
  const assetName = getCloudflaredAssetName();
  if (!assetName) {
    throw new Error("auto-download is currently supported only on Windows");
  }

  await fs.mkdir(cloudflaredCacheDir, { recursive: true });
  const binaryPath = path.join(cloudflaredCacheDir, "cloudflared.exe");
  if (await canRunCommand(binaryPath)) {
    return binaryPath;
  }

  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName}`;
  console.log("[tunnel] Downloading cloudflared portable binary...");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`cloudflared download failed: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(binaryPath, buffer);

  if (!(await canRunCommand(binaryPath))) {
    throw new Error("downloaded cloudflared binary is not executable");
  }

  console.log(`[tunnel] cloudflared saved to ${binaryPath}`);
  return binaryPath;
}

async function resolveCloudflaredCommand() {
  if (await commandExists("cloudflared")) {
    return "cloudflared";
  }
  return ensureBundledCloudflared();
}

async function printLocaltunnelPasswordHint() {
  try {
    const response = await fetch("https://loca.lt/mytunnelpassword", {
      headers: {
        "user-agent": "yooh-tunnel-helper",
      },
    });
    if (!response.ok) {
      return;
    }

    const value = (await response.text()).trim();
    if (!value) {
      return;
    }

    console.log(`[tunnel] localtunnel password: ${value}`);
  } catch {
    // Ignore helper failures.
  }
}

async function openLocaltunnel() {
  const options = { port };
  if (subdomain) {
    options.subdomain = subdomain;
  }
  if (host) {
    options.host = host;
  }

  const tunnel = await localtunnel(options);
  activeTunnel = tunnel;

  if (typeof tunnel.on === "function") {
    tunnel.on("error", (error) => {
      if (stopping) {
        return;
      }
      console.error(`[tunnel] Error: ${error?.message ?? error}`);
    });
  }

  const publicUrl = String(tunnel.url ?? "").trim();
  if (!publicUrl) {
    throw new Error("Tunnel did not return a public URL");
  }

  logReady(publicUrl);
  console.log("[tunnel] Provider: localtunnel");
  persistTunnelState(publicUrl, "localtunnel");
  await printLocaltunnelPasswordHint();

  const monitor = createTunnelMonitor(publicUrl, async () => {
    if (activeTunnel === tunnel && typeof tunnel.close === "function") {
      tunnel.close();
    }
  });

  await new Promise((resolve) => {
    if (typeof tunnel.once === "function") {
      tunnel.once("close", resolve);
      return;
    }
    resolve();
  });

  monitor.stop();
  activeTunnel = null;
}

async function openCloudflareTunnel() {
  const command = await resolveCloudflaredCommand();
  const args = ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"];
  if (cloudflaredProtocol) {
    args.push("--protocol", cloudflaredProtocol);
  }

  const child = spawn(command, args, {
    shell: false,
  });
  activeProcess = child;

  let ready = false;
  let monitor = null;
  let endedByMonitor = false;
  let forcedRestartReason = "";
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = String(chunk ?? "");
      if (
        !forcedRestartReason &&
        cloudflareForcedRestartPatterns.some((pattern) => pattern.test(text))
      ) {
        forcedRestartReason = "origin-unregistered";
        console.warn("[tunnel] cloudflared reported unregistered origin. Restarting tunnel session...");
        if (activeProcess === child && !child.killed) {
          child.kill();
        }
        return;
      }

      const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
      if (match && !ready) {
        ready = true;
        const publicUrl = match[0];
        logReady(publicUrl);
        console.log("[tunnel] Provider: cloudflared");
        persistTunnelState(publicUrl, "cloudflared");
        monitor = createTunnelMonitor(publicUrl, async () => {
          if (activeProcess === child && !child.killed) {
            endedByMonitor = true;
            child.kill();
          }
        });
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", reject);
    child.on("exit", (code) => {
      monitor?.stop();
      activeProcess = null;
      if (forcedRestartReason && !stopping) {
        reject(new Error(`cloudflared session invalidated: ${forcedRestartReason}`));
        return;
      }
      if (!ready && !stopping) {
        reject(new Error(`cloudflared exited before URL was assigned (code ${code ?? "unknown"})`));
        return;
      }
      resolve();
    });
  });

  return {
    endedByMonitor,
    forcedRestartReason,
  };
}

async function openTunnelByProvider() {
  if (provider === "cloudflared") {
    const result = await openCloudflareTunnel();
    if (result?.endedByMonitor) {
      rememberCloudflareInstability("health-check");
    }
    if (result?.forcedRestartReason) {
      rememberCloudflareInstability(result.forcedRestartReason);
    }
    return;
  }

  if (provider === "localtunnel") {
    await openLocaltunnel();
    return;
  }

  if (Date.now() < forceLocaltunnelUntil) {
    await openLocaltunnel();
    return;
  }

  try {
    const result = await openCloudflareTunnel();
    if (result?.endedByMonitor) {
      rememberCloudflareInstability("health-check");
    } else if (result?.forcedRestartReason) {
      rememberCloudflareInstability(result.forcedRestartReason);
    } else {
      cloudflareUnstableAt = [];
    }
  } catch (error) {
    console.warn(`[tunnel] cloudflared unavailable: ${error?.message ?? error}`);
    rememberCloudflareInstability("startup");
    console.warn("[tunnel] Falling back to localtunnel");
    await openLocaltunnel();
  }
}

async function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;
  try {
    if (activeProcess && !activeProcess.killed) {
      activeProcess.kill();
    }
  } catch {
    // Ignore process close failures.
  }
  try {
    if (activeTunnel && typeof activeTunnel.close === "function") {
      activeTunnel.close();
    }
  } catch {
    // Ignore tunnel close failures.
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[tunnel] Creating public tunnel for http://localhost:${port}`);
if (subdomain) {
  console.log(`[tunnel] Requested subdomain: ${subdomain}`);
}
if (rawProvider && provider === "auto" && normalizedProvider !== "auto") {
  console.warn(`[tunnel] Unknown provider '${rawProvider}', fallback to auto mode`);
}
if (provider !== "auto") {
  console.log(`[tunnel] Requested provider: ${provider}`);
}

while (!stopping) {
  try {
    await openTunnelByProvider();
    if (!stopping) {
      console.warn("[tunnel] Tunnel closed. Reconnecting in 2s...");
      await sleep(2000);
    }
  } catch (error) {
    if (stopping) {
      break;
    }

    console.error(`[tunnel] Failed: ${error?.message ?? error}`);
    console.warn("[tunnel] Retry in 3s...");
    await sleep(3000);
  }
}
