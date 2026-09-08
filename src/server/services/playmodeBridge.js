import crypto from "node:crypto";
import path from "node:path";
import net from "node:net";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

const PLAYMODE_DEFAULT_BACKEND_PORT = 4000;
const PLAYMODE_USERNAME_RE = /^[a-z0-9._]{3,32}$/;

function trimText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePlaymodeUsername(value, fallback = "") {
  const source = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._]/g, "");
  if (PLAYMODE_USERNAME_RE.test(source)) {
    return source;
  }

  const safeFallback = String(fallback ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");
  const base = source || safeFallback || `user${Date.now().toString(36)}`;
  const normalized = base.slice(0, 32);
  if (PLAYMODE_USERNAME_RE.test(normalized)) {
    return normalized;
  }

  const patched = normalized.replace(/[^a-z0-9._]/g, "").slice(0, 32) || "user000";
  if (patched.length >= 3 && PLAYMODE_USERNAME_RE.test(patched)) {
    return patched;
  }
  return "user000";
}

function derivePlaymodeEmail(user) {
  const stableId = String(user?.id ?? "").trim() || crypto.randomUUID();
  return `${stableId}@yooh.local`;
}

function derivePlaymodePassword(user, config) {
  const stableSeed = `${String(user?.id ?? "").trim()}:${String(user?.chatId ?? "").trim()}`;
  return crypto.createHmac("sha256", String(config?.jwtSecret ?? "yooh-dev-secret")).update(stableSeed).digest("hex");
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 7000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPlaymodeBackendAlive(healthUrl) {
  try {
    const health = await fetchJson(healthUrl, { timeoutMs: 1500 });
    return Boolean(health.ok && health.payload?.ok);
  } catch {
    return false;
  }
}

export function createPlaymodeBridge({ config, authService }) {
  const playmodeServerEntry = path.join(process.cwd(), "playmode", "backend", "src", "server.js");
  const runtimeDir = path.dirname(path.resolve(String(config?.dataFile ?? path.join(process.cwd(), "runtime", "db.json"))));
  const playmodeDataDir =
    String(process.env.YOOH_PLAYMODE_DATA_DIR ?? "").trim() || path.join(runtimeDir, "playmode");
  const playmodeSqlitePath =
    String(process.env.YOOH_PLAYMODE_SQLITE_PATH ?? "").trim() || path.join(playmodeDataDir, "yooh-playmode.sqlite");
  const envPort = Number.parseInt(String(process.env.YOOH_PLAYMODE_PORT ?? ""), 10);
  const fixedPort = Number.isInteger(envPort) && envPort > 0 ? envPort : null;
  let backendPort = fixedPort;
  let childProcess = null;
  let startPromise = null;
  let restartTimer = null;
  let closing = false;

  function getBackendOrigin() {
    if (Number.isInteger(backendPort) && backendPort > 0) {
      return `http://127.0.0.1:${backendPort}`;
    }
    return null;
  }

  function getApiBase() {
    const origin = getBackendOrigin();
    return origin ? `${origin}/api` : null;
  }

  function getHealthUrl() {
    const apiBase = getApiBase();
    return apiBase ? `${apiBase}/health` : null;
  }

  async function allocateBackendPort() {
    if (Number.isInteger(backendPort) && backendPort > 0) {
      return backendPort;
    }
    backendPort = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const selectedPort =
          address && typeof address === "object" && Number.isInteger(address.port) && address.port > 0
            ? address.port
            : PLAYMODE_DEFAULT_BACKEND_PORT;
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve(selectedPort);
          }
        });
      });
    });
    return backendPort;
  }

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function scheduleRestart() {
    clearRestartTimer();
    if (closing) {
      return;
    }
    restartTimer = setTimeout(() => {
      ensureBackendStarted().catch(() => {
        scheduleRestart();
      });
    }, 1200);
  }

  async function ensureBackendStarted() {
    await allocateBackendPort();
    await fs.mkdir(playmodeDataDir, { recursive: true });
    const healthUrl = getHealthUrl();
    if (healthUrl && (await isPlaymodeBackendAlive(healthUrl))) {
      return;
    }

    if (startPromise) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      clearRestartTimer();
      childProcess = spawn(process.execPath, [playmodeServerEntry], {
        cwd: path.dirname(path.dirname(playmodeServerEntry)),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: {
          ...process.env,
          PORT: String(backendPort),
          METIOR_JWT_SECRET: String(config?.jwtSecret ?? "yooh-dev-secret"),
          YOOH_PLAYMODE_DATA_DIR: playmodeDataDir,
          YOOH_PLAYMODE_SQLITE_PATH: playmodeSqlitePath,
        },
      });

      childProcess.stdout?.on("data", () => {
        // Keep stream attached so child logs are drained.
      });
      childProcess.stderr?.on("data", () => {
        // Keep stream attached so child logs are drained.
      });

      childProcess.once("error", () => {
        scheduleRestart();
      });

      childProcess.once("exit", () => {
        childProcess = null;
        scheduleRestart();
      });

      const startAt = Date.now();
      const timeoutMs = 12_000;
      while (Date.now() - startAt < timeoutMs) {
        if (healthUrl && (await isPlaymodeBackendAlive(healthUrl))) {
          return;
        }
        await wait(300);
      }

      throw new Error("Playmode backend did not start in time");
    })();

    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function loginOrRegister(mainUser) {
    const apiBase = getApiBase();
    if (!apiBase) {
      throw new Error("Playmode API base is unavailable");
    }
    const email = derivePlaymodeEmail(mainUser);
    const password = derivePlaymodePassword(mainUser, config);
    const preferredUsername = normalizePlaymodeUsername(mainUser?.username, mainUser?.chatId);
    const fallbackSuffix = String(mainUser?.chatId ?? "").trim().slice(-4) || "0000";

    const login = async () =>
      fetchJson(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { email, password },
        timeoutMs: 7000,
      });

    let loginResponse = await login();
    if (loginResponse.ok && loginResponse.payload?.token) {
      return loginResponse.payload;
    }

    let registered = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const nextUsername =
        attempt === 0
          ? preferredUsername
          : normalizePlaymodeUsername(`${preferredUsername}.${fallbackSuffix}.${attempt}`, fallbackSuffix);
      const registerResponse = await fetchJson(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
          name: trimText(mainUser?.displayName, 64) || trimText(mainUser?.username, 64) || "User",
          username: nextUsername,
          email,
          password,
        },
        timeoutMs: 9000,
      });

      if (registerResponse.ok) {
        registered = true;
        break;
      }

      if (registerResponse.status === 409) {
        // Conflict can happen for username on migrated data. Retry with suffix.
        continue;
      }

      // Non-conflict errors should not keep retrying registration.
      break;
    }

    if (!registered) {
      // If registration could not proceed, try login once more (account may already exist).
      loginResponse = await login();
      if (loginResponse.ok && loginResponse.payload?.token) {
        return loginResponse.payload;
      }
      throw new Error("Unable to create or login playmode account");
    }

    loginResponse = await login();
    if (!loginResponse.ok || !loginResponse.payload?.token) {
      throw new Error("Playmode login failed after registration");
    }
    return loginResponse.payload;
  }

  async function syncPlaymodeUsernameFromMain(mainUser, playmodeToken) {
    const apiBase = getApiBase();
    if (!apiBase) {
      return;
    }
    const username = normalizePlaymodeUsername(mainUser?.username, mainUser?.chatId);
    if (!username || !playmodeToken) {
      return;
    }
    const response = await fetchJson(`${apiBase}/profiles/me`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${playmodeToken}`,
      },
      body: { username },
      timeoutMs: 7000,
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(response.payload?.error || "Unable to sync playmode username");
    }
  }

  async function createSessionForMainUser(mainUser) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await ensureBackendStarted();
        const session = await loginOrRegister(mainUser);
        const token = String(session?.token ?? "").trim();
        if (!token) {
          throw new Error("Playmode token is missing");
        }
        await syncPlaymodeUsernameFromMain(mainUser, token);
        return { token };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await wait(350 * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error("Playmode session failed");
  }

  async function syncMainProfileFromPlaymode(mainUserId) {
    // Game mode profile is intentionally independent from the main profile.
    // Keep endpoint for backward compatibility with older clients.
    return authService.getUserById(mainUserId);
  }

  async function close() {
    closing = true;
    clearRestartTimer();
    const processToStop = childProcess;
    if (!processToStop) {
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const hardKillTimer = setTimeout(() => {
        try {
          processToStop.kill("SIGKILL");
        } catch {
          // Ignore process shutdown errors.
        }
      }, 1800);

      processToStop.once("exit", () => {
        clearTimeout(hardKillTimer);
        finish();
      });

      try {
        processToStop.kill("SIGTERM");
      } catch {
        clearTimeout(hardKillTimer);
        finish();
      }
    });
  }

  return {
    ensureReady: ensureBackendStarted,
    getProxyTarget: getBackendOrigin,
    createSessionForMainUser,
    syncMainProfileFromPlaymode,
    close,
  };
}
