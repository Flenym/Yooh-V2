import http from "node:http";
import os from "node:os";
import { execSync } from "node:child_process";
import path from "node:path";
import express from "express";
import httpProxy from "http-proxy";
import { createAppContext } from "./app.js";
import { attachRealtime } from "./realtime.js";
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

const context = await createAppContext();
const server = http.createServer(context.app);
server.requestTimeout = 0;
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;
const io = attachRealtime(server, context.services);
const adminProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
});
const adminApp = express();
adminApp.disable("x-powered-by");
adminApp.use((req, res, next) => {
  const pathName = String(req.path ?? "");
  if (!pathName.startsWith("/api/")) {
    next();
    return;
  }
  const targetHost = context.config.host === "0.0.0.0" || context.config.host === "::" ? "127.0.0.1" : context.config.host;
  adminProxy.web(req, res, {
    target: `http://${targetHost}:${context.config.port}`,
  });
});
adminApp.get(["/", "/admin"], (_req, res) => {
  res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(context.config.clientDir, "admin.html"));
});
adminApp.use(
  express.static(context.config.clientDir, {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders: (res) => {
      res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    },
  }),
);
adminApp.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});
const adminServer = http.createServer(adminApp);

adminProxy.on("error", (_error, _req, res) => {
  if (!res || typeof res.writeHead !== "function" || res.headersSent) {
    return;
  }
  res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Admin API proxy unavailable" }));
});

server.on("upgrade", (req, socket, head) => {
  try {
    if (typeof context.handleUpgrade === "function" && context.handleUpgrade(req, socket, head)) {
      return;
    }
  } catch {
    socket.destroy();
  }
});

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

function listLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        continue;
      }
      urls.push(`http://${entry.address}:${port}`);
    }
  }

  return [...new Set(urls)];
}

let retriedAfterPortConflict = false;

function emitRealtimeEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (event.type === "session:revoked") {
    const payload = {
      sessionIds: Array.isArray(event.sessionIds) ? event.sessionIds : [],
      reason: typeof event.reason === "string" ? event.reason : "session-revoked",
    };
    for (const userId of event.userIds ?? []) {
      io.to(`user:${userId}`).emit("auth:session-revoked", payload);
    }
    return;
  }

  if (event.type === "message" && event.message) {
    io.to(event.message.chatId).emit("chat:message", event.message);
    return;
  }

  if (event.type === "message:updated" && event.message) {
    const chatId = String(event.message.chatId ?? "").trim();
    const messageId = String(event.message.id ?? "").trim();
    if (!chatId || !messageId) {
      return;
    }
    Promise.resolve()
      .then(async () => {
        const memberIdsRaw = await context.services.chatService.getChatMemberIds(chatId);
        const memberIds = [...new Set((Array.isArray(memberIdsRaw) ? memberIdsRaw : []).map((entry) => String(entry ?? "").trim()).filter(Boolean))];
        await Promise.all(
          memberIds.map(async (userId) => {
            try {
              const messageForUser = await context.services.chatService.getMessageForUser(userId, chatId, messageId);
              io.to(`user:${userId}`).emit("chat:message:updated", messageForUser);
            } catch {
              // Ignore per-user hydration failures (for example, user left the chat during update).
            }
          }),
        );
      })
      .catch(() => {
        io.to(chatId).emit("chat:message:updated", event.message);
      });
    return;
  }

  if (event.type === "message:deleted") {
    io.to(event.chatId).emit("chat:message:deleted", {
      chatId: event.chatId,
      messageId: event.messageId,
      stream: event.stream ?? "main",
    });
    return;
  }

  if (event.type === "chat:updated") {
    for (const userId of event.userIds ?? []) {
      io.to(`user:${userId}`).emit("chat:updated", { chatId: event.chatId });
    }
    return;
  }

  if (event.type === "settings:updated") {
    for (const userId of event.userIds ?? []) {
      io.to(`user:${userId}`).emit("settings:updated", { userId });
    }
    return;
  }

  if (event.type === "requests:updated") {
    for (const userId of event.userIds ?? []) {
      io.to(`user:${userId}`).emit("requests:updated", { userId });
    }
    return;
  }

  if (event.type === "story:updated") {
    const payload = { storyId: event.storyId ?? "" };
    if (event.userIds === "all") {
      io.emit("story:updated", payload);
      return;
    }
    for (const userId of event.userIds ?? []) {
      io.to(`user:${userId}`).emit("story:updated", payload);
    }
  }
}

context.setNotifier(emitRealtimeEvent);

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE" && !retriedAfterPortConflict) {
    retriedAfterPortConflict = true;
    const killed = freePort(context.config.port);
    if (killed > 0) {
      setTimeout(() => {
        server.listen(context.config.port, context.config.host);
      }, 350);
      return;
    }
  }

  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${context.config.port} is already in use. Stop previous instance or change PORT.`);
    process.exitCode = 1;
    return;
  }

  console.error("Server error:", error);
  process.exitCode = 1;
});

server.listen(context.config.port, context.config.host, () => {
  const { host, port } = context.config;
  const isAnyAddress = host === "0.0.0.0" || host === "::";
  const mainUrl = `http://${isAnyAddress ? "localhost" : host}:${port}`;
  console.log(`Yooh API listening on ${mainUrl}`);

  if (isAnyAddress) {
    const lanUrls = listLanUrls(port);
    if (lanUrls.length) {
      console.log(`LAN access: ${lanUrls.join(", ")}`);
    }
  }

  const { adminHost, adminPort } = context.config;
  if (adminPort !== port) {
    const isAdminAnyAddress = adminHost === "0.0.0.0" || adminHost === "::";
    const adminUrl = `http://${isAdminAnyAddress ? "localhost" : adminHost}:${adminPort}/admin`;
    adminServer.listen(adminPort, adminHost, () => {
      console.log(`Yooh Admin listening on ${adminUrl}`);
    });
  }
});

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await context.close();
    if (adminServer.listening) {
      await new Promise((resolve) => {
        adminServer.close(() => resolve());
      });
    }
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.error("Shutdown error:", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);



