import { execSync, spawn } from "node:child_process";
function ignoreBrokenPipe(stream) {
  if (!stream || typeof stream.on !== "function") {
    return;
  }

  stream.on("error", (error) => {
    if (error?.code === "EPIPE") {
      return;
    }
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

function ensureDependenciesInstalled() {
  try {
    execSync("npm ls --depth=0", {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return;
  } catch {
    console.warn("[dev-server] Missing dependencies detected. Running npm install...");
    execSync("npm install", {
      stdio: "inherit",
    });
  }
}

function listPidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();

      if (!output) {
        return [];
      }

      return output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).at(-1))
        .filter(Boolean)
        .map((pid) => Number.parseInt(pid, 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    }

    const output = execSync(`lsof -ti tcp:${port}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!output) {
      return [];
    }

    return output
      .split(/\r?\n/)
      .map((pid) => Number.parseInt(pid, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { stdio: ["ignore", "ignore", "ignore"] });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

function freePort(port) {
  const pids = listPidsOnPort(port);
  let killed = 0;
  for (const pid of pids) {
    if (killPid(pid)) {
      killed += 1;
    }
  }
  return killed;
}

const port = Number.parseInt(process.env.PORT ?? "4200", 10);
if (Number.isInteger(port) && port > 0) {
  freePort(port);
}

ensureDependenciesInstalled();

const child = spawn(process.execPath, ["--watch", "src/server/index.js"], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});

