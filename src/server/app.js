import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import httpProxy from "http-proxy";
import QRCode from "qrcode";
import webpush from "web-push";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { HttpError, toHttpError } from "./errors.js";
import { JsonStore } from "./store.js";
import { createAuthService } from "./services/authService.js";
import { createChatService } from "./services/chatService.js";
import { createPlaymodeBridge } from "./services/playmodeBridge.js";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isStorageError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  if (!code) {
    return false;
  }

  return new Set(["EBUSY", "EPERM", "EACCES", "ENOSPC", "EROFS", "EIO"]).has(code);
}

function getRequestToken(req, options = {}) {
  const header = req.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    if (options.allowQuery) {
      const queryToken = typeof req.query?.token === "string" ? req.query.token.trim() : "";
      return queryToken || null;
    }
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function getRequestDeviceContext(req) {
  const bodyDevice = req.body?.device && typeof req.body.device === "object" ? req.body.device : {};
  return {
    name:
      req.get("x-device-name") ??
      bodyDevice.name ??
      req.body?.deviceName ??
      "",
    platform:
      req.get("x-device-platform") ??
      bodyDevice.platform ??
      req.body?.platform ??
      "",
    client:
      req.get("x-device-client") ??
      bodyDevice.client ??
      "",
    timezone:
      req.get("x-device-timezone") ??
      bodyDevice.timezone ??
      "",
    location:
      req.get("x-device-location") ??
      bodyDevice.location ??
      "",
    userAgent:
      req.get("user-agent") ??
      bodyDevice.userAgent ??
      "",
    ip: req.ip ?? req.socket?.remoteAddress ?? "",
  };
}

function getAdminActorContext(req) {
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? "",
    userAgent: req.get("user-agent") ?? "",
  };
}

function sanitizeAsciiFilename(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "file";
  }
  const sanitized = raw
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[/:*?<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "file";
}

function encodeRfc5987Filename(value) {
  return encodeURIComponent(String(value ?? "").trim())
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (match) => match.toUpperCase());
}

function buildContentDisposition(dispositionType, fileName) {
  const safeType = dispositionType === "inline" ? "inline" : "attachment";
  const utf8Name = String(fileName ?? "").trim() || "file";
  const asciiName = sanitizeAsciiFilename(utf8Name);
  const encodedUtf8 = encodeRfc5987Filename(utf8Name);
  return `${safeType}; filename="${asciiName}"; filename*=UTF-8''${encodedUtf8}`;
}

export async function createAppContext(overrides = {}) {
  const config = loadConfig(overrides);
  const appRuntimeStartedAt = Date.now();
  const appRuntimeId = `${appRuntimeStartedAt.toString(36)}-${process.pid.toString(36)}`;
  await fs.mkdir(config.uploadDir, { recursive: true });

  const store = new JsonStore(config.dataFile);
  await store.init();

  const authService = createAuthService({ store, config });
  await authService.migrateUsers();
  await authService.ensureSystemUser();

  const chatService = createChatService({ store, config });
  await chatService.purgeExpiredFiles();
  const playmodeBridge = createPlaymodeBridge({ config, authService });
  await playmodeBridge.ensureReady().catch(() => {
    // Playmode backend is retried by bridge automatically.
  });
  const playmodeProxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
    xfwd: true,
  });

  const ensureVapidKeys = async () => {
    if (config.vapidPublicKey && config.vapidPrivateKey) {
      return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
    }
    const runtimeDir = path.dirname(config.dataFile);
    const vapidPath = path.join(runtimeDir, "vapid.json");
    try {
      const raw = await fs.readFile(vapidPath, "utf8");
      const parsed = JSON.parse(raw);
      const publicKey = String(parsed?.publicKey ?? "").trim();
      const privateKey = String(parsed?.privateKey ?? "").trim();
      if (publicKey && privateKey) {
        return { publicKey, privateKey };
      }
    } catch {
      // Ignore missing/invalid cached VAPID key files.
    }
    try {
      const generated = webpush.generateVAPIDKeys();
      if (generated?.publicKey && generated?.privateKey) {
        await fs.mkdir(runtimeDir, { recursive: true });
        await fs.writeFile(
          vapidPath,
          JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey }, null, 2),
          "utf8",
        );
        return { publicKey: generated.publicKey, privateKey: generated.privateKey };
      }
    } catch {
      // Fall through to disabled push mode.
    }
    return null;
  };

  const resolvedVapid = await ensureVapidKeys();
  if (resolvedVapid?.publicKey && resolvedVapid?.privateKey) {
    config.vapidPublicKey = resolvedVapid.publicKey;
    config.vapidPrivateKey = resolvedVapid.privateKey;
  }

  const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
  if (pushEnabled) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  }

  const normalizePushSubscription = (subscription) => {
    const endpoint = String(subscription?.endpoint ?? "").trim();
    const keys = subscription?.keys && typeof subscription.keys === "object" ? subscription.keys : {};
    const p256dh = String(keys.p256dh ?? "").trim();
    const auth = String(keys.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) {
      return null;
    }
    return {
      endpoint,
      keys: { p256dh, auth },
    };
  };

  const savePushSubscription = async (userId, subscription, userAgent = "") => {
    if (!pushEnabled) {
      return null;
    }
    const normalized = normalizePushSubscription(subscription);
    if (!normalized) {
      throw new HttpError(400, "Invalid push subscription");
    }
    return store.transact((db) => {
      const now = new Date().toISOString();
      db.pushSubscriptions = (db.pushSubscriptions ?? []).filter((entry) => entry.endpoint !== normalized.endpoint);
      db.pushSubscriptions.push({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        userId: String(userId ?? "").trim(),
        endpoint: normalized.endpoint,
        keys: normalized.keys,
        userAgent: String(userAgent ?? "").trim(),
        createdAt: now,
        updatedAt: now,
      });
      return normalized;
    });
  };

  const removePushSubscription = async (endpoint) => {
    const safeEndpoint = String(endpoint ?? "").trim();
    if (!safeEndpoint) {
      return;
    }
    await store.transact((db) => {
      db.pushSubscriptions = (db.pushSubscriptions ?? []).filter((entry) => entry.endpoint !== safeEndpoint);
    });
  };

  const listPushSubscriptionsForUsers = async (userIds = []) => {
    const safeUserIds = new Set(userIds.map((entry) => String(entry ?? "").trim()).filter(Boolean));
    if (!safeUserIds.size) {
      return [];
    }
    return store.read((db) =>
      (db.pushSubscriptions ?? []).filter((entry) => safeUserIds.has(String(entry.userId ?? "").trim())),
    );
  };

  const sendPushNotification = async ({ userIds = [], payload = {} }) => {
    if (!pushEnabled) {
      return;
    }
    const subscriptions = await listPushSubscriptionsForUsers(userIds);
    if (!subscriptions.length) {
      return;
    }
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (entry) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: entry.endpoint,
              keys: entry.keys,
            },
            body,
          );
        } catch (error) {
          const status = Number(error?.statusCode ?? error?.status ?? 0);
          if ([404, 410].includes(status)) {
            await removePushSubscription(entry.endpoint);
          }
        }
      }),
    );
  };

  const buildPushPayloadForMessage = async (message, senderUserId) => {
    const chatId = String(message?.chatId ?? "").trim();
    const senderId = String(senderUserId ?? "").trim();
    if (!chatId || !senderId) {
      return null;
    }
    const { chatTitle, senderName } = await store.read((db) => {
      const chat = db.chats.find((entry) => entry.id === chatId);
      const sender = db.users.find((entry) => entry.id === senderId);
      return {
        chatTitle: chat?.title ?? "",
        senderName: sender?.displayName ?? sender?.username ?? "Yooh",
      };
    });
    const title = chatTitle || senderName || "Yooh";
    const text = String(message?.text ?? "").trim();
    const fileName = message?.file?.originalName ? String(message.file.originalName).trim() : "";
    const body = text || fileName || "New message";
    return { title, body, chatId };
  };

  const resolvePlaymodeTarget = () => {
    const target = playmodeBridge.getProxyTarget?.();
    return typeof target === "string" && target.trim() ? target.trim() : null;
  };

  const respondPlaymodeUnavailable = (res) => {
    if (!res || res.headersSent) {
      return;
    }
    res.status(503).json({ error: "Playmode backend unavailable" });
  };

  playmodeProxy.on("error", (_error, _req, res) => {
    if (!res || typeof res.writeHead !== "function" || res.headersSent) {
      return;
    }
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Playmode proxy unavailable" }));
  });

  let notifier = () => {};
  const setNotifier = (handler) => {
    notifier = typeof handler === "function" ? handler : () => {};
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  const upload = multer({
    dest: config.uploadDir,
    // No file size limits here: uploads can be large (tunnel/PWA friendly).
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "img-src": ["'self'", "data:", "blob:", "https://emojicdn.elk.sh", "https://cdn.jsdelivr.net"],
        },
      },
    }),
  );
  app.use(compression({ threshold: 1024 }));
  app.use(cors());
  app.use(
    morgan("dev", {
      skip: (req, res) => {
        const pathName = String(req.originalUrl ?? req.url ?? "");
        if (req.method === "GET" && (pathName.startsWith("/api/admin/") || pathName.startsWith("/api/chats"))) {
          return true;
        }
        return res.statusCode === 304;
      },
    }),
  );

  app.use("/playmode-api", (req, res) => {
    playmodeBridge
      .ensureReady()
      .then(() => {
        const target = resolvePlaymodeTarget();
        if (!target) {
          respondPlaymodeUnavailable(res);
          return;
        }
        req.url = `/api${req.url || ""}`;
        playmodeProxy.web(req, res, { target });
      })
      .catch(() => {
        respondPlaymodeUnavailable(res);
      });
  });

  app.use("/playmode-socket", (req, res) => {
    playmodeBridge
      .ensureReady()
      .then(() => {
        const target = resolvePlaymodeTarget();
        if (!target) {
          respondPlaymodeUnavailable(res);
          return;
        }
        req.url = `/socket.io${req.url || ""}`;
        playmodeProxy.web(req, res, { target });
      })
      .catch(() => {
        respondPlaymodeUnavailable(res);
      });
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  const requireAuth = asyncRoute(async (req, _res, next) => {
    const token = getRequestToken(req);
    const user = await authService.authenticate(token, getRequestDeviceContext(req));
    req.user = user;
    req.sessionId = String(user?.sessionId ?? "").trim() || null;
    next();
  });

  const requireFileAuth = asyncRoute(async (req, _res, next) => {
    const token = getRequestToken(req, { allowQuery: true });
    const user = await authService.authenticate(token, getRequestDeviceContext(req));
    req.user = user;
    req.sessionId = String(user?.sessionId ?? "").trim() || null;
    next();
  });

  const resolveOptionalUser = async (req) => {
    const token = getRequestToken(req);
    if (!token) {
      return null;
    }
    try {
      return await authService.authenticate(token);
    } catch {
      return null;
    }
  };

  const requireAdmin = (req, _res, next) => {
    const token = req.get("x-admin-token");
    if (token !== config.adminPanelToken) {
      return next(new HttpError(401, "Admin token is invalid"));
    }
    next();
  };

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "yooh", time: new Date().toISOString() });
  });

  app.get("/api/app-version", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.status(200).json({
      runtimeId: appRuntimeId,
      startedAt: new Date(appRuntimeStartedAt).toISOString(),
      startedAtMs: appRuntimeStartedAt,
    });
  });

  app.get(
    "/api/auth/qr/image",
    asyncRoute(async (req, res) => {
      const value = String(req.query?.data ?? "").trim();
      if (!value) {
        throw new HttpError(400, "QR data is required");
      }
      const sizeRaw = Number.parseInt(String(req.query?.size ?? "380"), 10);
      const size = Number.isFinite(sizeRaw) ? Math.min(1024, Math.max(120, sizeRaw)) : 380;
      const svg = await QRCode.toString(value, {
        type: "svg",
        width: size,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      res.set("cache-control", "no-store");
      res.type("image/svg+xml");
      res.status(200).send(svg);
    }),
  );

  app.post(
    "/api/client-errors",
    asyncRoute(async (req, res) => {
      const user = await resolveOptionalUser(req);
      await chatService.logError({
        source: "client",
        userId: user?.id ?? null,
        endpoint: req.body?.endpoint ?? req.body?.path ?? null,
        message: req.body?.message ?? "Client error",
        stack: req.body?.stack ?? null,
        url: req.body?.url ?? null,
        userAgent: req.get("user-agent") ?? req.body?.userAgent ?? null,
        platform: req.body?.platform ?? null,
        statusCode: req.body?.statusCode ?? null,
        extra: req.body?.extra ?? null,
      });
      res.status(201).json({ logged: true });
    }),
  );

  async function deliverAuthCodeToSupportFallback({ target, purpose = "login", channel = "sms", delivery = "" }) {
    const safeTarget = String(target ?? "").trim();
    const safePurpose = String(purpose ?? "").trim() || "login";
    const safeChannel = String(channel ?? "sms").trim() || "sms";
    const safeDelivery = String(delivery ?? "").trim().toLowerCase();
    const supportDeliveryEnabled = config.smsFallbackToSupportBot || safeDelivery === "admin";
    if (!supportDeliveryEnabled || !safeTarget || safePurpose !== "login") {
      return;
    }

    try {
      const targetUser = await authService.findUserByLoginTarget(safeTarget, safeChannel);
      const activeCode = await authService.getActiveAuthCode(safeTarget, safePurpose, safeChannel);
      if (!targetUser?.id || !activeCode?.code) {
        return;
      }

      const expiresAtMs = new Date(activeCode.expiresAt).getTime();
      const expiresInMinutes = Number.isFinite(expiresAtMs)
        ? Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 60_000))
        : null;
      const purposeLabel = safePurpose === "register" ? "регистрации" : "входа";
      const codeMessage = expiresInMinutes
        ? `🔐 Код ${purposeLabel} Yooh: ${activeCode.code}
⏳ Действует: ${expiresInMinutes} мин.
⚠️ Никому не сообщайте этот код, даже сотрудникам Yooh.
Если это были не вы — просто проигнорируйте сообщение.`
        : `🔐 Код ${purposeLabel} Yooh: ${activeCode.code}
⚠️ Никому не сообщайте этот код, даже сотрудникам Yooh.
Если это были не вы — просто проигнорируйте сообщение.`;
      const delivered = await chatService.sendSystemBotMessageToUser(targetUser.id, {
        text: codeMessage,
      });
      notifier({ type: "chat:updated", chatId: delivered.chatId, userIds: delivered.memberIds });
      notifier({ type: "message", message: delivered.message });
    } catch {
      // Support fallback delivery is best-effort and must not break auth.
    }
  }

  app.post(
    "/api/auth/register/request-code",
    asyncRoute(async (req, res) => {
      const result = await authService.requestRegisterCode(req.body ?? {});
      res.status(200).json({ ok: true, ...result });
    }),
  );

  app.post(
    "/api/auth/register/verify-code",
    asyncRoute(async (req, res) => {
      const result = await authService.verifyRegisterCode(req.body ?? {}, getRequestDeviceContext(req));
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/auth/login/request-code",
    asyncRoute(async (req, res) => {
      const result = await authService.requestLoginCode(req.body ?? {});
      await deliverAuthCodeToSupportFallback({
        target: result.target ?? result.phone,
        purpose: result.purpose ?? "login",
        channel: result.channel ?? "sms",
        delivery: result.delivery,
      });
      res.status(200).json({ ok: true, ...result });
    }),
  );

  app.post(
    "/api/auth/login/verify-code",
    asyncRoute(async (req, res) => {
      const result = await authService.verifyLoginCode(req.body ?? {}, getRequestDeviceContext(req));
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/auth/login/verify-cloud-password",
    asyncRoute(async (req, res) => {
      const result = await authService.verifyCloudPassword(req.body ?? {}, getRequestDeviceContext(req));
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/auth/qr/create",
    asyncRoute(async (req, res) => {
      const result = await authService.createQrLogin(req.body ?? {}, getRequestDeviceContext(req));
      res.status(201).json(result);
    }),
  );

  app.get(
    "/api/auth/qr/status",
    asyncRoute(async (req, res) => {
      const status = await authService.getQrLoginStatus(req.query?.token);
      res.status(200).json(status);
    }),
  );

  app.get(
    "/api/me",
    requireAuth,
    asyncRoute(async (req, res) => {
      res.status(200).json({ user: req.user });
    }),
  );

  app.get(
    "/api/me/username-availability",
    requireAuth,
    asyncRoute(async (req, res) => {
      const availability = await authService.checkUsernameAvailability(req.user.id, req.query.username ?? "");
      res.status(200).json(availability);
    }),
  );

  app.get(
    "/api/push/public-key",
    asyncRoute(async (_req, res) => {
      if (!pushEnabled) {
        res.status(503).json({ error: "Push notifications are not configured" });
        return;
      }
      res.status(200).json({ publicKey: config.vapidPublicKey });
    }),
  );

  app.post(
    "/api/push/subscribe",
    requireAuth,
    asyncRoute(async (req, res) => {
      const subscription = await savePushSubscription(req.user.id, req.body?.subscription ?? req.body, req.get("user-agent") ?? "");
      res.status(201).json({ subscription });
    }),
  );

  app.post(
    "/api/push/unsubscribe",
    requireAuth,
    asyncRoute(async (req, res) => {
      await removePushSubscription(req.body?.endpoint ?? "");
      res.status(200).json({ ok: true });
    }),
  );

  app.post(
    "/api/playmode/session",
    requireAuth,
    asyncRoute(async (req, res) => {
      if (!req.user?.isPremium) {
        throw new HttpError(403, "Game mode requires Yooh Plus");
      }
      const session = await playmodeBridge.createSessionForMainUser(req.user);
      res.status(200).json(session);
    }),
  );

  app.get(
    "/api/playmode/health",
    asyncRoute(async (_req, res) => {
      try {
        await playmodeBridge.ensureReady();
        res.status(200).json({ ok: true });
      } catch {
        res.status(503).json({ ok: false });
      }
    }),
  );

  app.post(
    "/api/playmode/sync-main-profile",
    requireAuth,
    asyncRoute(async (req, res) => {
      const user = await playmodeBridge.syncMainProfileFromPlaymode(req.user.id, req.body ?? {});
      res.status(200).json({ user });
    }),
  );

  app.patch(
    "/api/me/profile",
    requireAuth,
    asyncRoute(async (req, res) => {
      const user = await authService.updateProfile(req.user.id, req.body ?? {});
      res.status(200).json({ user });
    }),
  );

  app.get(
    "/api/me/settings",
    requireAuth,
    asyncRoute(async (req, res) => {
      const settings = await authService.getSettings(req.user.id);
      res.status(200).json({ settings });
    }),
  );

  app.patch(
    "/api/me/settings",
    requireAuth,
    asyncRoute(async (req, res) => {
      const settings = await authService.updateSettings(req.user.id, req.body ?? {});
      notifier({ type: "settings:updated", userIds: [req.user.id] });
      res.status(200).json({ settings });
    }),
  );

  app.post(
    "/api/me/contacts",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.syncContactHashes(req.user.id, req.body ?? {});
      if (Array.isArray(result?.created)) {
        for (const entry of result.created) {
          notifier({ type: "chat:updated", chatId: entry.chatId, userIds: entry.memberIds });
        }
      }
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/auth/cloud-password",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await authService.setCloudPassword(req.user.id, req.body ?? {});
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/auth/sessions",
    requireAuth,
    asyncRoute(async (req, res) => {
      const sessions = await authService.listSessions(req.user.id, req.sessionId);
      res.status(200).json({ sessions });
    }),
  );

  app.patch(
    "/api/auth/sessions/current",
    requireAuth,
    asyncRoute(async (req, res) => {
      const session = await authService.renameCurrentSession(req.user.id, req.sessionId, req.body ?? {});
      res.status(200).json({ session });
    }),
  );

  app.post(
    "/api/auth/sessions/terminate-others",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await authService.terminateOtherSessions(req.user.id, req.sessionId);
      if (Array.isArray(result?.removedSessionIds) && result.removedSessionIds.length) {
        notifier({
          type: "session:revoked",
          userIds: [req.user.id],
          sessionIds: result.removedSessionIds,
          reason: "terminate-others",
        });
      }
      res.status(200).json(result);
    }),
  );

  app.delete(
    "/api/auth/sessions/:sessionId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await authService.removeSession(req.user.id, req.sessionId, req.params.sessionId);
      if (Array.isArray(result?.removedSessionIds) && result.removedSessionIds.length) {
        notifier({
          type: "session:revoked",
          userIds: [req.user.id],
          sessionIds: result.removedSessionIds,
          reason: "remove-session",
        });
      }
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/auth/sessions/link-device",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await authService.linkDeviceByQr(req.user.id, req.body ?? {});
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/webrtc/config",
    requireAuth,
    asyncRoute(async (_req, res) => {
      res.status(200).json({
        iceServers: config.webrtcIceServers,
      });
    }),
  );

  app.get(
    "/api/chats",
    requireAuth,
    asyncRoute(async (req, res) => {
      await chatService.ensureSupportChat(req.user.id);
      const chats = await chatService.listChats(req.user.id);
      res.status(200).json({ chats });
    }),
  );

  app.get(
    "/api/stickers/packs",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.listStickerPacks(req.user.id, {
        query: req.query.q ?? "",
        mineOnly: String(req.query.mine ?? "").trim() === "1",
        installedOnly: String(req.query.installed ?? "").trim() === "1",
      });
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/stickers/packs",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.createStickerPack(req.user.id, req.body ?? {});
      res.status(201).json(result);
    }),
  );

  app.post(
    "/api/stickers/packs/:packId/install",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.setStickerPackInstalled(req.user.id, req.params.packId, true);
      res.status(200).json(result);
    }),
  );

  app.delete(
    "/api/stickers/packs/:packId/install",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.setStickerPackInstalled(req.user.id, req.params.packId, false);
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/stories",
    requireAuth,
    asyncRoute(async (req, res) => {
      const payload = await chatService.listStories(req.user.id);
      res.status(200).json(payload);
    }),
  );

  app.post(
    "/api/stories",
    requireAuth,
    asyncRoute(async (req, res) => {
      const story = await chatService.publishStory(req.user.id, req.body ?? {});
      notifier({ type: "story:updated", storyId: story.id, userIds: "all" });
      res.status(201).json({ story });
    }),
  );

  app.patch(
    "/api/stories/:storyId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const story = await chatService.publishStory(req.user.id, { ...(req.body ?? {}), id: req.params.storyId });
      notifier({ type: "story:updated", storyId: story.id, userIds: "all" });
      res.status(200).json({ story });
    }),
  );

  app.delete(
    "/api/stories/:storyId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.deleteStory(req.user.id, req.params.storyId);
      notifier({ type: "story:updated", storyId: result.storyId, userIds: "all" });
      res.status(200).json({ deleted: true, storyId: result.storyId });
    }),
  );

  app.post(
    "/api/stories/:storyId/view",
    requireAuth,
    asyncRoute(async (req, res) => {
      const story = await chatService.markStoryViewed(req.user.id, req.params.storyId, req.body ?? {});
      notifier({ type: "story:updated", storyId: story.id, userIds: "all" });
      res.status(200).json({ story });
    }),
  );

  app.post(
    "/api/stories/:storyId/reaction",
    requireAuth,
    asyncRoute(async (req, res) => {
      const story = await chatService.reactToStory(req.user.id, req.params.storyId, req.body ?? {});
      notifier({ type: "story:updated", storyId: story.id, userIds: "all" });
      res.status(200).json({ story });
    }),
  );

  app.post(
    "/api/stories/:storyId/comments",
    requireAuth,
    asyncRoute(async (req, res) => {
      const story = await chatService.commentOnLiveStory(req.user.id, req.params.storyId, req.body ?? {});
      notifier({ type: "story:updated", storyId: story.id, userIds: "all" });
      res.status(200).json({ story });
    }),
  );

  app.get(
    "/api/calls",
    requireAuth,
    asyncRoute(async (req, res) => {
      const calls = await chatService.listCallLogs(req.user.id, {
        limit: req.query.limit,
      });
      res.status(200).json({ calls });
    }),
  );

  app.delete(
    "/api/calls/:callId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeCallLog(req.user.id, req.params.callId);
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/users/search",
    requireAuth,
    asyncRoute(async (req, res) => {
      const botsOnly = String(req.query.bot ?? "").trim() === "1";
      const users = await chatService.searchUsers(req.user.id, req.query.q ?? "", { botsOnly });
      res.status(200).json({ users });
    }),
  );

  app.get(
    "/api/chats/discovery",
    requireAuth,
    asyncRoute(async (req, res) => {
      const chats = await chatService.searchPublicChats(req.user.id, req.query.q ?? "");
      res.status(200).json({ chats });
    }),
  );

  app.post(
    "/api/chats/join",
    requireAuth,
    asyncRoute(async (req, res) => {
      const chat = await chatService.joinPublicChatByHandle(req.user.id, req.body?.handle);
      const memberIds = await chatService.getChatMemberIds(chat.id);
      notifier({ type: "chat:updated", chatId: chat.id, userIds: memberIds });
      res.status(200).json({ chat });
    }),
  );

  app.post(
    "/api/chats",
    requireAuth,
    asyncRoute(async (req, res) => {
      const chat = await chatService.createChat(req.user.id, req.body ?? {});
      const memberIds = await chatService.getChatMemberIds(chat.id);
      notifier({ type: "chat:updated", chatId: chat.id, userIds: memberIds });
      res.status(201).json({ chat });
    }),
  );

  app.patch(
    "/api/chats/:chatId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const chat = await chatService.updateChat(req.user.id, req.params.chatId, req.body ?? {});
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: memberIds });
      res.status(200).json({ chat });
    }),
  );

  app.delete(
    "/api/chats/:chatId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.deleteChat(req.user.id, req.params.chatId);
      notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      res.status(200).json({ deleted: true, chatId: result.chatId });
    }),
  );

  app.get(
    "/api/chats/:chatId/messages",
    requireAuth,
    asyncRoute(async (req, res) => {
      const messages = await chatService.listMessages(req.user.id, req.params.chatId, {
        limit: req.query.limit,
        before: req.query.before,
        stream: "main",
        threadRootId: req.query.threadRootId,
      });
      res.status(200).json({ messages });
    }),
  );

  app.get(
    "/api/chats/:chatId/messages/search",
    requireAuth,
    asyncRoute(async (req, res) => {
      const messages = await chatService.searchMessages(req.user.id, req.params.chatId, {
        q: req.query.q,
        limit: req.query.limit,
        stream: req.query.stream,
      });
      res.status(200).json({ messages });
    }),
  );

  app.get(
    "/api/chats/:chatId/messages/scheduled",
    requireAuth,
    asyncRoute(async (req, res) => {
      const messages = await chatService.listScheduledMessages(req.user.id, req.params.chatId);
      res.status(200).json({ messages });
    }),
  );

  app.post(
    "/api/chats/:chatId/messages",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.sendTextMessage(req.user.id, req.params.chatId, req.body ?? {});
      if (!message.scheduledAt) {
        notifier({ type: "message", message });
        const memberIds = await chatService.getChatMemberIds(req.params.chatId);
        const pushPayload = await buildPushPayloadForMessage(message, req.user.id);
        if (pushPayload) {
          await sendPushNotification({
            userIds: memberIds.filter((id) => String(id) !== String(req.user.id)),
            payload: pushPayload,
          });
        }
      }
      res.status(201).json({ message });
    }),
  );

  app.patch(
    "/api/chats/:chatId/messages/:messageId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.editMessage(
        req.user.id,
        req.params.chatId,
        req.params.messageId,
        req.body ?? {},
      );
      notifier({ type: "message:updated", message });
      res.status(200).json({ message });
    }),
  );

  app.delete(
    "/api/chats/:chatId/messages/:messageId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.deleteMessage(req.user.id, req.params.chatId, req.params.messageId);
      notifier({ type: "message:deleted", ...result });
      res.status(200).json({ deleted: true, messageId: result.messageId });
    }),
  );

  app.post(
    "/api/chats/:chatId/messages/:messageId/reactions",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.toggleMessageReaction(
        req.user.id,
        req.params.chatId,
        req.params.messageId,
        req.body?.emoji,
      );
      notifier({ type: "message:updated", message });
      res.status(200).json({ message });
    }),
  );

  app.post(
    "/api/chats/:chatId/messages/:messageId/poll-vote",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.votePoll(
        req.user.id,
        req.params.chatId,
        req.params.messageId,
        req.body ?? {},
      );
      notifier({ type: "message:updated", message });
      res.status(200).json({ message });
    }),
  );

  app.post(
    "/api/chats/:chatId/messages/:messageId/forward",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.forwardMessage(
        req.user.id,
        req.params.chatId,
        req.params.messageId,
        req.body ?? {},
      );
      notifier({ type: "message", message });
      res.status(201).json({ message });
    }),
  );

  app.get(
    "/api/chats/:chatId/comments",
    requireAuth,
    asyncRoute(async (req, res) => {
      const messages = await chatService.listMessages(req.user.id, req.params.chatId, {
        limit: req.query.limit,
        before: req.query.before,
        stream: "comment",
        threadRootId: req.query.threadRootId,
      });
      res.status(200).json({ messages });
    }),
  );

  app.post(
    "/api/chats/:chatId/comments",
    requireAuth,
    asyncRoute(async (req, res) => {
      const message = await chatService.sendComment(req.user.id, req.params.chatId, req.body ?? {});
      notifier({ type: "message", message });
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      const pushPayload = await buildPushPayloadForMessage(message, req.user.id);
      if (pushPayload) {
        await sendPushNotification({
          userIds: memberIds.filter((id) => String(id) !== String(req.user.id)),
          payload: pushPayload,
        });
      }
      res.status(201).json({ message });
    }),
  );

  app.post(
    "/api/chats/:chatId/files",
    requireAuth,
    upload.single("file"),
    asyncRoute(async (req, res) => {
      const message = await chatService.sendFileMessage(req.user.id, req.params.chatId, req.file, {
        text: req.body?.text,
        stream: req.body?.stream,
        replyToMessageId: req.body?.replyToMessageId,
        threadRootId: req.body?.threadRootId,
        clientMessageId: req.body?.clientMessageId,
      });
      notifier({ type: "message", message });
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      const pushPayload = await buildPushPayloadForMessage(message, req.user.id);
      if (pushPayload) {
        await sendPushNotification({
          userIds: memberIds.filter((id) => String(id) !== String(req.user.id)),
          payload: pushPayload,
        });
      }
      res.status(201).json({ message });
    }),
  );

  app.post(
    "/api/chats/:chatId/clear-history",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.clearChatHistory(req.user.id, req.params.chatId);
      notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      notifier({ type: "message:deleted", chatId: result.chatId, messageId: null, stream: "main" });
      notifier({ type: "message:deleted", chatId: result.chatId, messageId: null, stream: "comment" });
      res.status(200).json({ cleared: true, removedMessages: result.removedMessages });
    }),
  );

  app.get(
    "/api/files/:fileId/download",
    requireFileAuth,
    asyncRoute(async (req, res) => {
      const file = await chatService.getFileForUser(req.user.id, req.params.fileId);
      const resolvedPath = path.resolve(file.path);
      res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", buildContentDisposition("attachment", file.originalName));
      res.sendFile(resolvedPath);
    }),
  );

  app.get(
    "/api/files/:fileId/inline",
    requireFileAuth,
    asyncRoute(async (req, res) => {
      const file = await chatService.getFileForUser(req.user.id, req.params.fileId);
      const resolvedPath = path.resolve(file.path);
      res.type(file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", buildContentDisposition("inline", file.originalName));
      res.sendFile(resolvedPath);
    }),
  );

  app.post(
    "/api/chats/:chatId/members",
    requireAuth,
    asyncRoute(async (req, res) => {
      const member = await chatService.addMember(req.user.id, req.params.chatId, req.body ?? {});
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: memberIds });
      res.status(201).json({ member });
    }),
  );

  app.post(
    "/api/chats/:chatId/bots",
    requireAuth,
    asyncRoute(async (req, res) => {
      const member = await chatService.addBotMember(req.user.id, req.params.chatId, req.body ?? {});
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: memberIds });
      res.status(201).json({ member });
    }),
  );

  app.patch(
    "/api/chats/:chatId/members/:memberId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const member = await chatService.setMemberRole(
        req.user.id,
        req.params.chatId,
        req.params.memberId,
        req.body?.role,
      );
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: memberIds });
      res.status(200).json({ member });
    }),
  );

  app.delete(
    "/api/chats/:chatId/members/:memberId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeMember(req.user.id, req.params.chatId, req.params.memberId);
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({
        type: "chat:updated",
        chatId: req.params.chatId,
        userIds: [...new Set([...memberIds, result.userId])],
      });
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/chats/:chatId/messages/:messageId/report",
    requireAuth,
    asyncRoute(async (req, res) => {
      const report = await chatService.reportMessage(
        req.user.id,
        req.params.chatId,
        req.params.messageId,
        req.body?.reason,
      );
      res.status(201).json({ report });
    }),
  );

  app.get(
    "/api/admin/auth-codes",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const codes = await authService.listActiveCodes();
      res.status(200).json({ codes });
    }),
  );

  app.get(
    "/api/admin/stats",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const stats = await chatService.getAdminStats();
      res.status(200).json({ stats });
    }),
  );

  app.get(
    "/api/admin/users",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const users = await chatService.listAdminUsers();
      res.status(200).json({ users });
    }),
  );

  app.post(
    "/api/feedback",
    requireAuth,
    asyncRoute(async (req, res) => {
      const ticket = await chatService.createFeedbackTicket(req.user.id, {
        category: req.body?.category,
        message: req.body?.message,
      });
      res.status(201).json({ ticket });
    }),
  );

  app.post(
    "/api/admin/users/entitlements",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const user = await authService.setAdminEntitlements(req.body?.target, req.body ?? {});
      res.status(200).json({ user });
    }),
  );

  app.get(
    "/api/admin/runtime",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const dbSizeBytes = await fs
        .stat(config.dataFile)
        .then((dbStat) => (Number.isFinite(dbStat?.size) ? dbStat.size : 0))
        .catch(() => 0);

      const memory = process.memoryUsage();
      const cpus = os.cpus?.() ?? [];
      const cpuModel = cpus[0]?.model ?? "Unknown CPU";
      const cpuCount = cpus.length || 0;
      const uptimeSec = Math.max(0, Math.round(process.uptime()));

      res.status(200).json({
        runtime: {
          dbSizeBytes,
          memory: {
            rss: memory.rss,
            heapTotal: memory.heapTotal,
            heapUsed: memory.heapUsed,
            external: memory.external,
            arrayBuffers: memory.arrayBuffers ?? 0,
          },
          system: {
            totalMem: os.totalmem(),
            freeMem: os.freemem(),
            loadAvg: os.loadavg(),
            uptimeSec: Math.round(os.uptime()),
            platform: os.platform(),
            arch: os.arch(),
            cpuModel,
            cpuCount,
          },
          process: {
            pid: process.pid,
            uptimeSec,
            node: process.version,
          },
          at: new Date().toISOString(),
        },
      });
    }),
  );

  app.get(
    "/api/admin/system-bot",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const state = await chatService.getSystemBotState();
      res.status(200).json({ state });
    }),
  );

  app.post(
    "/api/admin/system-bot/message",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.sendSystemBotMessageToTarget(req.body?.target, { text: req.body?.text });
      notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      notifier({ type: "message", message: result.message });
      res.status(201).json({
        delivered: 1,
        targetUserId: result.targetUserId,
        targetChatId: result.targetChatId,
        chatId: result.chatId,
      });
    }),
  );

  app.post(
    "/api/admin/system-bot/broadcast",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.broadcastSystemBotMessage({ text: req.body?.text });
      for (const delivery of result.deliveries) {
        notifier({ type: "chat:updated", chatId: delivery.chatId, userIds: delivery.memberIds });
        notifier({ type: "message", message: delivery.message });
      }
      res.status(201).json({
        delivered: result.delivered,
      });
    }),
  );

  app.post(
    "/api/admin/system-bot/stories",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.broadcastSystemBotStory({ text: req.body?.text });
      notifier({ type: "story:updated", storyId: result.storyId, userIds: "all" });
      res.status(201).json({
        delivered: result.delivered,
        storyId: result.storyId,
        story: result.story,
      });
    }),
  );

  app.get(
    "/api/support/ticket-state",
    requireAuth,
    asyncRoute(async (req, res) => {
      const support = await chatService.getSupportTicketState(req.user.id);
      res.status(200).json({ support });
    }),
  );

  app.post(
    "/api/support/tickets",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.createSupportTicket(req.user.id, {
        category: req.body?.category,
      });
      if (result?.chatId && Array.isArray(result?.memberIds)) {
        notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      }
      if (result?.message) {
        notifier({ type: "message", message: result.message });
      }
      res.status(201).json({ ticket: result.ticket });
    }),
  );

  app.get(
    "/api/admin/moderation",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const moderation = await chatService.getModerationState();
      res.status(200).json({ moderation });
    }),
  );

  app.get(
    "/api/admin/support-tickets",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const tickets = await chatService.listAdminSupportTickets(getAdminActorContext(req));
      res.status(200).json({ tickets });
    }),
  );

  app.get(
    "/api/admin/support-tickets/:ticketId/messages",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.getAdminSupportTicketMessages(req.params.ticketId, getAdminActorContext(req));
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/admin/support-tickets/:ticketId/claim",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.claimSupportTicket(req.params.ticketId, getAdminActorContext(req));
      if (result?.chatId && Array.isArray(result?.memberIds)) {
        notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      }
      if (result?.message) {
        notifier({ type: "message", message: result.message });
      }
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/admin/support-tickets/:ticketId/reply",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.replySupportTicket(
        req.params.ticketId,
        { text: req.body?.text },
        getAdminActorContext(req),
      );
      if (result?.chatId && Array.isArray(result?.memberIds)) {
        notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      }
      if (result?.message) {
        notifier({ type: "message", message: result.message });
      }
      res.status(201).json(result);
    }),
  );

  app.post(
    "/api/admin/support-tickets/:ticketId/close",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.closeSupportTicket(req.params.ticketId, getAdminActorContext(req));
      if (result?.chatId && Array.isArray(result?.memberIds)) {
        notifier({ type: "chat:updated", chatId: result.chatId, userIds: result.memberIds });
      }
      if (result?.message) {
        notifier({ type: "message", message: result.message });
      }
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/admin/feedback",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const tickets = await chatService.listFeedbackTickets();
      res.status(200).json({ tickets });
    }),
  );

  app.delete(
    "/api/admin/feedback/:ticketId",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeFeedbackTicket(req.params.ticketId);
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/admin/bans",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const ban = await chatService.setBan(req.body?.userId, req.body?.reason, req.body?.expiresAt ?? null);
      res.status(201).json({ ban });
    }),
  );

  app.delete(
    "/api/admin/bans/:userId",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeBan(req.params.userId);
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/admin/mutes",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const mute = await chatService.setMute(
        req.body?.chatId,
        req.body?.userId,
        req.body?.reason,
        req.body?.expiresAt ?? null,
      );
      res.status(201).json({ mute });
    }),
  );

  app.delete(
    "/api/admin/mutes/:chatId/:userId",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeMute(req.params.chatId, req.params.userId);
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/chats/:chatId/moderation/bans",
    requireAuth,
    asyncRoute(async (req, res) => {
      const ban = await chatService.setChatBan(
        req.user.id,
        req.params.chatId,
        req.body?.userId,
        req.body?.reason,
        req.body?.expiresAt ?? null,
      );
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: [...new Set([...memberIds, req.body?.userId])] });
      res.status(201).json({ ban });
    }),
  );

  app.delete(
    "/api/chats/:chatId/moderation/bans/:userId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeChatBan(req.user.id, req.params.chatId, req.params.userId);
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: [...new Set([...memberIds, req.params.userId])] });
      res.status(200).json(result);
    }),
  );

  app.post(
    "/api/chats/:chatId/moderation/mutes",
    requireAuth,
    asyncRoute(async (req, res) => {
      const mute = await chatService.setChatMute(
        req.user.id,
        req.params.chatId,
        req.body?.userId,
        req.body?.reason,
        req.body?.expiresAt ?? null,
      );
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: [...new Set([...memberIds, req.body?.userId])] });
      res.status(201).json({ mute });
    }),
  );

  app.delete(
    "/api/chats/:chatId/moderation/mutes/:userId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeChatMute(req.user.id, req.params.chatId, req.params.userId);
      const memberIds = await chatService.getChatMemberIds(req.params.chatId);
      notifier({ type: "chat:updated", chatId: req.params.chatId, userIds: [...new Set([...memberIds, req.params.userId])] });
      res.status(200).json(result);
    }),
  );

  app.delete(
    "/api/admin/reports/:reportId",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeReport(req.params.reportId);
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/admin/error-logs",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const logs = await chatService.listErrorLogs({ limit: req.query.limit });
      res.status(200).json({ logs });
    }),
  );

  app.delete(
    "/api/admin/error-logs/:errorLogId",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await chatService.removeErrorLog(req.params.errorLogId);
      res.status(200).json(result);
    }),
  );

  app.get("/admin", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDir, "admin.html"));
  });

  const playmodeRoot = path.join(config.clientDir, "vendor", "playmode");
  app.get("/playmode", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(playmodeRoot, "index.html"));
  });
  app.use(
    "/playmode",
    express.static(playmodeRoot, {
      etag: true,
      lastModified: true,
      maxAge: 0,
      setHeaders: (res) => {
        res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      },
    }),
  );

  app.get("/game", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDir, "game.html"));
  });
  app.get("/game.js", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDir, "game.js"));
  });
  app.get("/game.css", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDir, "game.css"));
  });

  app.get("/y.ooh/:handle", (_req, res) => {
    res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(config.clientDir, "index.html"));
  });

  app.use(
    express.static(config.clientDir, {
      etag: true,
      lastModified: true,
      maxAge: "5m",
      setHeaders: (res, filePath) => {
        if (/\.(?:html|css|js)$/i.test(String(filePath ?? ""))) {
          res.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        }
      },
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((error, _req, res, _next) => {
    const statusCode = Number.isFinite(error?.status) ? Number(error.status) : null;
    const errorMessage = String(error?.message ?? "Server error");
    const shouldLog =
      ![400, 401, 403, 404].includes(statusCode ?? -1) &&
      !/session is invalid or expired/i.test(errorMessage);
    if (shouldLog) {
      chatService
        .logError({
          source: "server",
          endpoint: _req?.originalUrl ?? _req?.url ?? null,
          message: errorMessage,
          stack: error?.stack ?? null,
          url: _req?.originalUrl ?? _req?.url ?? null,
          userAgent: _req?.get?.("user-agent") ?? null,
          statusCode,
        })
        .catch(() => {
          // Logging errors must not break main error handler.
        });
    }

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File exceeds size limit" });
    }

    if (isStorageError(error)) {
      console.error("[storage-error]", error?.code ?? "UNKNOWN", error?.message ?? "");
      return res.status(503).json({ error: "Storage is temporarily unavailable. Try again in a few seconds." });
    }

    const httpError = toHttpError(error);
    return res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  });

  const cleanupTimer = setInterval(() => {
    chatService.purgeExpiredFiles().catch(() => {
      // Cleanup should not crash API loop.
    });
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  // Publishes due scheduled messages (realtime + push, like a normal send).
  const scheduledTimer = setInterval(() => {
    chatService
      .collectDueScheduledMessages()
      .then(async (published) => {
        for (const entry of published ?? []) {
          try {
            notifier({ type: "message", message: entry.message });
            const memberIds = Array.isArray(entry.memberIds) ? entry.memberIds : [];
            if (memberIds.length) {
              notifier({ type: "chat:updated", chatId: entry.message.chatId, userIds: memberIds });
            }
            const pushPayload = await buildPushPayloadForMessage(entry.message, entry.message.senderId);
            if (pushPayload) {
              await sendPushNotification({
                userIds: memberIds.filter((id) => String(id) !== String(entry.message.senderId)),
                payload: pushPayload,
              });
            }
          } catch {
            // One failed delivery must not block the rest.
          }
        }
      })
      .catch(() => {
        // Scheduler should not crash API loop.
      });
  }, 30_000);
  scheduledTimer.unref();

  return {
    app,
    config,
    services: { authService, chatService },
    setNotifier,
    handleUpgrade: (req, socket, head) => {
      const originalUrl = String(req.url ?? "");
      if (!originalUrl.startsWith("/playmode-socket")) {
        return false;
      }
      const target = resolvePlaymodeTarget();
      if (!target) {
        socket.destroy();
        return true;
      }
      req.url = originalUrl.replace(/^\/playmode-socket(?=\/|$)/, "/socket.io");
      playmodeProxy.ws(req, socket, head, { target });
      return true;
    },
    close: async () => {
      clearInterval(cleanupTimer);
      clearInterval(scheduledTimer);
      await playmodeBridge.close();
    },
  };
}
