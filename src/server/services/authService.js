import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { HttpError } from "../errors.js";
import {
  generateNumericChatId,
  hashPhone,
  monthKey,
  normalizePhone,
  normalizeUsername,
  nowIso,
  randomOtpCode,
  trimText,
} from "../utils.js";
import { canViewerCallTarget, canViewerSeeLastSeen } from "./privacyRules.js";
import { createSmsService } from "./smsService.js";

const OTP_LOGIN_TICKET_TTL_MS = 7 * 60 * 1000;
const QR_LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_SESSIONS_PER_USER = 30;
const YOOH_PLUS_FILE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
const YOOH_FREE_FILE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const STARS_EXPIRE_MS = 3 * 365 * 24 * 60 * 60 * 1000;

const requestRegisterOtpSchema = z.object({
  phone: z.string().min(10).max(20),
});

const requestLoginOtpSchema = z
  .object({
    phone: z.string().min(10).max(20).optional(),
    email: z.string().email().max(254).optional(),
  })
  .refine((value) => Number(Boolean(value.phone)) + Number(Boolean(value.email)) === 1, {
    message: "Provide exactly one of phone or email",
    path: ["phone"],
  });

const deviceSchema = z
  .object({
    name: z.string().max(80).optional(),
    platform: z.string().max(24).optional(),
    client: z.string().max(120).optional(),
    timezone: z.string().max(80).optional(),
    location: z.string().max(120).optional(),
    userAgent: z.string().max(500).optional(),
    ip: z.string().max(120).optional(),
  })
  .optional();

const verifyRegisterSchema = z.object({
  phone: z.string().min(10).max(20),
  code: z.string().regex(/^\d{6}$/),
  displayName: z.string().min(1).max(80),
  username: z.string().min(5).max(32),
  locale: z.enum(["ru", "en"]).optional(),
  device: deviceSchema,
});

const verifyLoginSchema = z
  .object({
    phone: z.string().min(10).max(20).optional(),
    email: z.string().email().max(254).optional(),
    code: z.string().regex(/^\d{6}$/),
    locale: z.enum(["ru", "en"]).optional(),
    device: deviceSchema,
  })
  .refine((value) => Number(Boolean(value.phone)) + Number(Boolean(value.email)) === 1, {
    message: "Provide exactly one of phone or email",
    path: ["phone"],
  });

const verifyCloudPasswordSchema = z.object({
  loginTicket: z.string().min(16).max(120),
  password: z.string().min(4).max(120),
  locale: z.enum(["ru", "en"]).optional(),
});

const createQrLoginSchema = z.object({
  device: deviceSchema,
});

const linkQrLoginSchema = z.object({
  token: z.string().min(16).max(120),
});

const renameSessionSchema = z.object({
  name: z.string().min(1).max(80),
});

const setCloudPasswordSchema = z.object({
  password: z.string().max(120).nullable().optional(),
});

const premiumBadgeSchema = z.object({
  type: z.enum(["none", "star", "svg", "photo"]).optional(),
  star: z.string().max(8).optional(),
  svg: z.string().max(120_000).optional(),
  photo: z.string().max(2_000_000).optional(),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  size: z.coerce.number().int().min(12).max(36).optional(),
  offsetX: z.coerce.number().int().min(-24).max(24).optional(),
  offsetY: z.coerce.number().int().min(-24).max(24).optional(),
});

const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    username: z.string().min(5).max(32).optional(),
    about: z.string().max(280).optional(),
    avatar: z.string().max(2_000_000).optional(),
    banner: z.string().max(2_000_000).optional(),
    // ISO calendar date (YYYY-MM-DD) or empty string to clear.
    birthday: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
    premiumBadge: premiumBadgeSchema.optional(),
    locale: z.enum(["ru", "en"]).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one profile field must be provided",
  });

const looseObjectSchema = z.object({}).passthrough();

const updateSettingsSchema = z
  .object({
    language: z.enum(["ru", "en"]).optional(),
    notifications: looseObjectSchema.optional(),
    privacy: looseObjectSchema.optional(),
    data: looseObjectSchema.optional(),
    appearance: looseObjectSchema.optional(),
    folders: looseObjectSchema.optional(),
    advanced: looseObjectSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one settings field must be provided",
  });

function defaultSettings(locale = "ru") {
  return {
    language: locale,
    notifications: {
      privateChats: true,
      groups: true,
      channels: true,
      messagePreview: true,
      sounds: true,
      vibration: true,
    },
    privacy: {
      lastSeen: "everyone",
      profilePhoto: "everyone",
      forwards: "everyone",
      calls: "contacts",
      groupsInvites: "everyone",
      readReceipts: true,
    },
    data: {
      autoDownloadMobile: true,
      autoDownloadWifi: true,
      autoDownloadRoaming: false,
      useLessDataForCalls: "never",
    },
    appearance: {
      theme: "classic",
      fontSize: 16,
      chatFontSize: 16,
      fontFamily: "system",
      chatBackground: "yooh",
      compactMode: false,
      globalWallpaperPreset: "",
      globalWallpaper: "",
      globalWallpaperBlur: 0,
      globalWallpaperDim: 0,
      syncWallpaperAcrossChats: true,
    },
    folders: {
      enabled: false,
      unreadFirst: true,
    },
    advanced: {
      animatedStickers: true,
      saveToGallery: true,
      archiveMutedChats: false,
      powerSaving: false,
      uiAnimations: true,
      proxyEnabled: false,
      proxyServer: "",
      ipv6Enabled: true,
      backgroundUpdates: true,
    },
  };
}

function mergeSettings(current, patch, locale) {
  const base = defaultSettings(locale);
  const source = current && typeof current === "object" ? current : {};
  const input = patch && typeof patch === "object" ? patch : {};

  return {
    ...base,
    ...source,
    ...input,
    notifications: {
      ...base.notifications,
      ...(source.notifications ?? {}),
      ...(input.notifications ?? {}),
    },
    privacy: {
      ...base.privacy,
      ...(source.privacy ?? {}),
      ...(input.privacy ?? {}),
    },
    data: {
      ...base.data,
      ...(source.data ?? {}),
      ...(input.data ?? {}),
    },
    appearance: {
      ...base.appearance,
      ...(source.appearance ?? {}),
      ...(input.appearance ?? {}),
    },
    folders: {
      ...base.folders,
      ...(source.folders ?? {}),
      ...(input.folders ?? {}),
    },
    advanced: {
      ...base.advanced,
      ...(source.advanced ?? {}),
      ...(input.advanced ?? {}),
    },
  };
}

function toSafeUser(user, options = {}) {
  const limits = buildYoohPlusLimits(user, options.config);
  return {
    id: user.id,
    chatId: user.chatId,
    phone: user.phone,
    username: user.username,
    displayName: user.displayName,
    about: user.about ?? "",
    avatar: user.avatar ?? "",
    banner: user.banner ?? "",
    birthday: user.birthday ?? "",
    locale: user.locale,
    createdAt: user.createdAt,
    usageMonth: user.usageMonth,
    usedBytes: user.usedBytes,
    settings: user.settings,
    cloudPasswordEnabled: Boolean(user.cloudPassword?.hash && user.cloudPassword?.salt),
    isBot: Boolean(user.isBot),
    isSystemBot: Boolean(user.isSystemBot),
    isPremium: Boolean(user.isPremium),
    isPlus: Boolean(user.isPremium),
    premiumUntil: user.premiumUntil ?? null,
    starsBalance: Math.max(0, Number.parseInt(user.starsBalance ?? 0, 10) || 0),
    starsEarned: Math.max(0, Number.parseInt(user.starsEarned ?? 0, 10) || 0),
    starsExpireAt: user.starsExpireAt ?? null,
    emojiStatus: trimText(user.emojiStatus),
    premiumBadge: normalizePremiumBadge(user.premiumBadge),
    business: normalizeBusinessProfile(user.business),
    feedbackBlocked: Boolean(user.feedbackBlocked),
    yoohPlusLimits: limits,
    sessionId: options.sessionId ? String(options.sessionId) : undefined,
  };
}

function createToken(config, user, sessionId) {
  return jwt.sign({ sub: user.id, phone: user.phone, sid: sessionId }, config.jwtSecret, {
    expiresIn: "30d",
  });
}

function detectBrowserName(userAgent) {
  const ua = String(userAgent ?? "");
  if (/Edg\//i.test(ua)) {
    return "Edge";
  }
  if (/OPR\//i.test(ua)) {
    return "Opera";
  }
  if (/Firefox\//i.test(ua)) {
    return "Firefox";
  }
  if (/Chrome\//i.test(ua)) {
    return "Chrome";
  }
  if (/Safari\//i.test(ua)) {
    return "Safari";
  }
  return "Browser";
}

function normalizePlatform(value, userAgent = "") {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["iphone", "ios"].includes(raw)) {
    return "iphone";
  }
  if (raw === "android") {
    return "android";
  }
  if (["pc", "desktop", "windows", "mac", "linux", "web"].includes(raw)) {
    return "pc";
  }

  const ua = String(userAgent ?? "").toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) {
    return "iphone";
  }
  if (ua.includes("android")) {
    return "android";
  }

  return "pc";
}

function defaultSessionName(platform) {
  if (platform === "iphone") {
    return "iPhone";
  }
  if (platform === "android") {
    return "Android";
  }
  return "Desktop";
}

function platformIcon(platform) {
  return platform === "iphone" ? "apple" : "desktop";
}

function normalizeSessionDeviceMeta(input = {}, context = {}) {
  const userAgent = String(input.userAgent ?? context.userAgent ?? "").trim();
  const platform = normalizePlatform(input.platform ?? context.platform, userAgent);
  const browserName = detectBrowserName(userAgent);
  const safeName = trimText(input.name ?? context.name);
  const safeClient = trimText(input.client ?? context.client);
  const timezone = trimText(input.timezone ?? context.timezone);
  const location = trimText(input.location ?? context.location);

  return {
    name: safeName || defaultSessionName(platform),
    client: safeClient || `Yooh Web (${browserName})`,
    platform,
    icon: platformIcon(platform),
    location: timezone || location || "Unknown",
    userAgent,
    ip: trimText(input.ip ?? context.ip),
  };
}

function createDefaultBusinessProfile() {
  return {
    enabled: false,
    hours: "",
    location: "",
    welcomeMessage: "",
    awayMessage: "",
    quickReplies: [],
    chatLinks: [],
    aiAssistantEnabled: false,
    adsRevenueEnabled: false,
  };
}

function createDefaultPremiumBadge() {
  return {
    type: "star",
    star: "⭐",
    svg: "",
    photo: "",
    bgColor: "#f4c84c",
    size: 16,
    offsetX: 0,
    offsetY: 0,
  };
}

function normalizePremiumBadge(input = {}, fallback = createDefaultPremiumBadge()) {
  const source = input && typeof input === "object" ? input : {};
  const base = fallback && typeof fallback === "object" ? fallback : createDefaultPremiumBadge();
  const allowedTypes = new Set(["none", "star", "svg", "photo"]);
  const requestedType = trimText(source.type).toLowerCase();
  const fallbackType = trimText(base.type).toLowerCase();
  const type = allowedTypes.has(requestedType) ? requestedType : allowedTypes.has(fallbackType) ? fallbackType : "star";
  const star = trimText(source.star ?? base.star).slice(0, 8) || "⭐";
  const svg = trimText(source.svg ?? base.svg).slice(0, 120_000);
  const photo = trimText(source.photo ?? base.photo).slice(0, 2_000_000);
  const bgColorInput = trimText(source.bgColor ?? base.bgColor).toLowerCase();
  const bgColor = /^#[0-9a-f]{6}$/i.test(bgColorInput) ? bgColorInput : "#f4c84c";
  const size = Math.max(12, Math.min(36, Number.parseInt(source.size ?? base.size ?? 16, 10) || 16));
  const offsetX = Math.max(-24, Math.min(24, Number.parseInt(source.offsetX ?? base.offsetX ?? 0, 10) || 0));
  const offsetY = Math.max(-24, Math.min(24, Number.parseInt(source.offsetY ?? base.offsetY ?? 0, 10) || 0));
  return {
    type,
    star,
    svg,
    photo,
    bgColor,
    size,
    offsetX,
    offsetY,
  };
}

function normalizeStringList(value, maxItems = 20, maxLength = 160) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => trimText(entry).slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeBusinessProfile(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = createDefaultBusinessProfile();
  return {
    ...base,
    ...source,
    enabled: Boolean(source.enabled),
    hours: trimText(source.hours).slice(0, 160),
    location: trimText(source.location).slice(0, 160),
    welcomeMessage: trimText(source.welcomeMessage).slice(0, 500),
    awayMessage: trimText(source.awayMessage).slice(0, 500),
    quickReplies: normalizeStringList(source.quickReplies, 30, 240),
    chatLinks: normalizeStringList(source.chatLinks, 20, 240),
    aiAssistantEnabled: Boolean(source.aiAssistantEnabled),
    adsRevenueEnabled: Boolean(source.adsRevenueEnabled),
  };
}

function normalizeIsoOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (["1", "true", "yes", "on", "premium", "plus"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "free"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function buildYoohPlusLimits(user, config) {
  const isPlus = Boolean(user?.isPremium);
  const safeConfig = config && typeof config === "object" ? config : {};
  const baseFileLimit = Number.parseInt(safeConfig.fileLimitBytes ?? YOOH_FREE_FILE_LIMIT_BYTES, 10) || YOOH_FREE_FILE_LIMIT_BYTES;
  const baseMonthLimit = Number.parseInt(safeConfig.monthLimitBytes ?? 20 * 1024 * 1024 * 1024, 10) || 20 * 1024 * 1024 * 1024;
  return {
    maxFileBytes: isPlus ? Math.max(baseFileLimit, YOOH_PLUS_FILE_LIMIT_BYTES) : Math.min(baseFileLimit, YOOH_FREE_FILE_LIMIT_BYTES),
    maxBioLength: isPlus ? 140 : 70,
    maxCaptionLength: isPlus ? 2048 : 1024,
    maxPinnedChats: isPlus ? 999 : 10,
    maxFolders: isPlus ? 20 : 10,
    maxFavoriteStickerSets: isPlus ? 10 : 5,
    maxStoryCaptionLength: isPlus ? 2048 : 200,
    monthlyTrafficBytes: isPlus ? baseMonthLimit * 2 : baseMonthLimit,
    boostsPerMonth: isPlus ? 1 : 0,
  };
}

function normalizeSessionSource(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "auth";
  }
  if (raw.includes("qr")) {
    return "qr";
  }
  if (raw.includes("register")) {
    return "register";
  }
  return "auth";
}

function buildSessionDeviceKey(deviceMeta = {}, source = "auth") {
  const normalizedMeta = normalizeSessionDeviceMeta(deviceMeta);
  const sourceBucket = normalizeSessionSource(source) === "qr" ? "qr" : "auth";
  const signature = [
    sourceBucket,
    normalizedMeta.platform,
    String(normalizedMeta.name ?? "").trim().toLowerCase(),
    String(normalizedMeta.client ?? "").trim().toLowerCase(),
    String(normalizedMeta.userAgent ?? "").trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha1").update(signature).digest("hex");
}

function getSessionDeviceKey(session) {
  const savedKey = trimText(session?.deviceKey);
  if (savedKey) {
    return savedKey;
  }
  return buildSessionDeviceKey(
    {
      platform: session?.platform,
      name: session?.name,
      client: session?.client,
      userAgent: session?.userAgent,
    },
    session?.source ?? "auth",
  );
}

function serializeSession(session, currentSessionId = null) {
  return {
    id: session.id,
    name: session.name,
    client: session.client,
    location: session.location,
    platform: session.platform,
    icon: session.icon,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    isCurrent: currentSessionId ? session.id === currentSessionId : false,
  };
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(password, salt),
  };
}

function isCloudPasswordValid(user, password) {
  const safePassword = String(password ?? "");
  if (!safePassword || !user?.cloudPassword?.salt || !user?.cloudPassword?.hash) {
    return false;
  }
  return hashPassword(safePassword, user.cloudPassword.salt) === user.cloudPassword.hash;
}

function cleanupAuthState(db) {
  const now = Date.now();

  db.authCodes = db.authCodes.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  db.loginTickets = (db.loginTickets ?? []).filter((entry) => new Date(entry.expiresAt).getTime() > now);
  db.qrLogins = (db.qrLogins ?? []).filter((entry) => {
    const expiresAtMs = new Date(entry.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return false;
    }
    if (entry.status === "authorized") {
      const authorizedAtMs = new Date(entry.authorizedAt ?? entry.createdAt).getTime();
      if (Number.isFinite(authorizedAtMs) && now - authorizedAtMs > 2 * 60 * 1000) {
        return false;
      }
    }
    return true;
  });

  db.sessions = (db.sessions ?? []).filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    if (entry.revokedAt) {
      return false;
    }
    const lastSeenMs = new Date(entry.lastSeenAt ?? entry.createdAt).getTime();
    if (!Number.isFinite(lastSeenMs)) {
      return false;
    }
    return now - lastSeenMs < 45 * 24 * 60 * 60 * 1000;
  });
}

function createSession(db, userId, rawDeviceMeta = {}, options = {}) {
  const deviceMeta = normalizeSessionDeviceMeta(rawDeviceMeta);
  const source = normalizeSessionSource(options?.source);
  const deviceKey = buildSessionDeviceKey(deviceMeta, source);
  const existingSession = db.sessions.find(
    (entry) => entry.userId === userId && !entry.revokedAt && getSessionDeviceKey(entry) === deviceKey,
  );

  if (existingSession) {
    existingSession.name = deviceMeta.name;
    existingSession.client = deviceMeta.client;
    existingSession.location = deviceMeta.location;
    existingSession.platform = deviceMeta.platform;
    existingSession.icon = deviceMeta.icon;
    existingSession.userAgent = deviceMeta.userAgent;
    existingSession.ip = deviceMeta.ip;
    existingSession.source = source;
    existingSession.deviceKey = deviceKey;
    existingSession.lastSeenAt = nowIso();
    return existingSession;
  }

  const createdAt = nowIso();
  const session = {
    id: uuid(),
    userId,
    name: deviceMeta.name,
    client: deviceMeta.client,
    location: deviceMeta.location,
    platform: deviceMeta.platform,
    icon: deviceMeta.icon,
    userAgent: deviceMeta.userAgent,
    ip: deviceMeta.ip,
    source,
    deviceKey,
    createdAt,
    lastSeenAt: createdAt,
    revokedAt: null,
  };

  db.sessions.push(session);

  const userSessions = db.sessions
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  if (userSessions.length > MAX_ACTIVE_SESSIONS_PER_USER) {
    const staleIds = userSessions.slice(MAX_ACTIVE_SESSIONS_PER_USER).map((entry) => entry.id);
    db.sessions = db.sessions.filter((entry) => !staleIds.includes(entry.id));
  }

  return session;
}

function touchSession(session, context = {}) {
  session.lastSeenAt = nowIso();
  const nextClient = trimText(context.client);
  const nextLocation = trimText(context.timezone ?? context.location);
  const nextUserAgent = trimText(context.userAgent);
  const nextIp = trimText(context.ip);

  if (nextClient) {
    session.client = nextClient;
  }
  if (nextLocation) {
    session.location = nextLocation;
  }
  if (nextUserAgent) {
    session.userAgent = nextUserAgent;
  }
  if (nextIp) {
    session.ip = nextIp;
  }
}

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function maskEmail(email) {
  const safe = normalizeEmail(email);
  const atIndex = safe.indexOf("@");
  if (atIndex <= 0) {
    return safe;
  }
  const localPart = safe.slice(0, atIndex);
  const domain = safe.slice(atIndex + 1);
  if (!domain) {
    return safe;
  }

  const maskedLocal =
    localPart.length <= 2 ? `${localPart[0] ?? "*"}*` : `${localPart[0]}${"*".repeat(localPart.length - 2)}${localPart.at(-1)}`;
  return `${maskedLocal}@${domain}`;
}

function getUserLoginEmail(user) {
  return normalizeEmail(user?.settings?.privacy?.loginEmail);
}

function getAuthCodeTarget(entry) {
  const target = String(entry?.target ?? "").trim();
  if (target) {
    return target;
  }
  return String(entry?.phone ?? "").trim();
}

function getAuthCodeChannel(entry) {
  return String(entry?.channel ?? "sms").trim() || "sms";
}

function consumeOtpCode(db, target, code, purpose, channel = "sms") {
  const normalizedTarget = String(target ?? "").trim();
  const normalizedChannel = String(channel ?? "sms").trim() || "sms";
  const now = Date.now();
  const codeEntry = db.authCodes.find(
    (entry) =>
      getAuthCodeTarget(entry) === normalizedTarget &&
      getAuthCodeChannel(entry) === normalizedChannel &&
      entry.code === code &&
      entry.purpose === purpose &&
      new Date(entry.expiresAt).getTime() > now,
  );

  if (!codeEntry) {
    throw new HttpError(400, "OTP code is invalid or expired");
  }

  db.authCodes = db.authCodes.filter((entry) => entry.id !== codeEntry.id);
}

function issueOtpCode(db, target, purpose, ttlMs, channel = "sms") {
  const normalizedTarget = String(target ?? "").trim();
  const normalizedChannel = String(channel ?? "sms").trim() || "sms";
  const now = Date.now();
  const existing = db.authCodes.find(
    (entry) =>
      getAuthCodeTarget(entry) === normalizedTarget &&
      getAuthCodeChannel(entry) === normalizedChannel &&
      entry.purpose === purpose &&
      new Date(entry.expiresAt).getTime() > now,
  );

  if (existing) {
    return {
      target: normalizedTarget,
      phone: normalizedTarget,
      channel: normalizedChannel,
      purpose,
      code: existing.code,
      expiresAt: existing.expiresAt,
      expiresInSeconds: Math.max(1, Math.floor((new Date(existing.expiresAt).getTime() - now) / 1000)),
    };
  }

  const code = randomOtpCode();
  const createdAt = nowIso();
  const expiresAt = new Date(now + ttlMs).toISOString();

  db.authCodes = db.authCodes.filter(
    (item) =>
      !(
        getAuthCodeTarget(item) === normalizedTarget &&
        getAuthCodeChannel(item) === normalizedChannel &&
        item.purpose === purpose
      ),
  );
  db.authCodes.push({
    id: uuid(),
    target: normalizedTarget,
    phone: normalizedTarget,
    channel: normalizedChannel,
    code,
    purpose,
    createdAt,
    expiresAt,
  });

  return {
    target: normalizedTarget,
    phone: normalizedTarget,
    channel: normalizedChannel,
    purpose,
    code,
    expiresAt,
    expiresInSeconds: Math.floor(ttlMs / 1000),
  };
}

function findLatestActiveAuthCode(db, target, purpose, channel = "sms") {
  const normalizedTarget = String(target ?? "").trim();
  const normalizedChannel = String(channel ?? "sms").trim() || "sms";
  const now = Date.now();

  return db.authCodes
    .filter(
      (entry) =>
        getAuthCodeTarget(entry) === normalizedTarget &&
        getAuthCodeChannel(entry) === normalizedChannel &&
        entry.purpose === purpose &&
        new Date(entry.expiresAt).getTime() > now,
    )
    .sort((a, b) => new Date(b.createdAt ?? b.expiresAt).getTime() - new Date(a.createdAt ?? a.expiresAt).getTime())[0];
}

function ensureUserShape(db, user, config) {
  let changed = false;

  if (!user.locale || !["ru", "en"].includes(user.locale)) {
    user.locale = "ru";
    changed = true;
  }

  if (!user.displayName) {
    user.displayName = `User ${String(user.phone).slice(-4)}`;
    changed = true;
  }

  if (typeof user.about !== "string") {
    user.about = "";
    changed = true;
  }

  if (typeof user.avatar !== "string") {
    user.avatar = "";
    changed = true;
  }

  if (typeof user.banner !== "string") {
    user.banner = "";
    changed = true;
  }

  if (typeof user.birthday !== "string") {
    user.birthday = "";
    changed = true;
  }

  const safeConfig = config && typeof config === "object" ? config : {};
  const nextPhoneHash = hashPhone(user.phone ?? "", safeConfig.contactHashSalt);
  if (nextPhoneHash !== user.phoneHash) {
    user.phoneHash = nextPhoneHash;
    changed = true;
  }

  const rawContactHashes = Array.isArray(user.contactHashes) ? user.contactHashes : [];
  const normalizedContactHashes = [
    ...new Set(
      rawContactHashes
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter((entry) => /^[a-f0-9]{64}$/.test(entry)),
    ),
  ].slice(0, 5000);
  if (JSON.stringify(normalizedContactHashes) !== JSON.stringify(user.contactHashes ?? [])) {
    user.contactHashes = normalizedContactHashes;
    changed = true;
  }

  if (user.contactsUpdatedAt && Number.isNaN(new Date(user.contactsUpdatedAt).getTime())) {
    user.contactsUpdatedAt = null;
    changed = true;
  }
  if (user.contactsUpdatedAt === undefined) {
    user.contactsUpdatedAt = null;
    changed = true;
  }

  if (typeof user.isBot !== "boolean") {
    user.isBot = false;
    changed = true;
  }

  if (typeof user.isSystemBot !== "boolean") {
    user.isSystemBot = false;
    changed = true;
  }

  const legacyPlusFlag = normalizeBooleanFlag(user.isPlus);
  if (typeof user.isPremium !== "boolean") {
    user.isPremium = legacyPlusFlag === true;
    changed = true;
  }
  if (legacyPlusFlag === true && !user.isPremium) {
    user.isPremium = true;
    changed = true;
  }
  if (typeof user.isPlus !== "boolean" || user.isPlus !== user.isPremium) {
    user.isPlus = Boolean(user.isPremium);
    changed = true;
  }

  if (typeof user.feedbackBlocked !== "boolean") {
    user.feedbackBlocked = false;
    changed = true;
  }

  const normalizedPremiumUntil = normalizeIsoOrNull(user.premiumUntil);
  if (normalizedPremiumUntil !== user.premiumUntil) {
    user.premiumUntil = normalizedPremiumUntil;
    changed = true;
  }
  if (user.premiumUntil && new Date(user.premiumUntil).getTime() <= Date.now()) {
    user.isPremium = false;
    user.premiumUntil = null;
    changed = true;
  }
  if (typeof user.isPlus !== "boolean" || user.isPlus !== user.isPremium) {
    user.isPlus = Boolean(user.isPremium);
    changed = true;
  }

  const normalizedStarsBalance = Math.max(0, Number.parseInt(user.starsBalance ?? 0, 10) || 0);
  if (normalizedStarsBalance !== user.starsBalance) {
    user.starsBalance = normalizedStarsBalance;
    changed = true;
  }

  const normalizedStarsEarned = Math.max(0, Number.parseInt(user.starsEarned ?? 0, 10) || 0);
  if (normalizedStarsEarned !== user.starsEarned) {
    user.starsEarned = normalizedStarsEarned;
    changed = true;
  }

  const normalizedStarsExpireAt = normalizeIsoOrNull(user.starsExpireAt);
  if (normalizedStarsExpireAt !== user.starsExpireAt) {
    user.starsExpireAt = normalizedStarsExpireAt;
    changed = true;
  }
  if (user.starsBalance > 0 && !user.starsExpireAt) {
    user.starsExpireAt = new Date(Date.now() + STARS_EXPIRE_MS).toISOString();
    changed = true;
  }
  if (user.starsBalance <= 0 && user.starsExpireAt) {
    user.starsExpireAt = null;
    changed = true;
  }

  const safeEmojiStatus = trimText(user.emojiStatus).slice(0, 32);
  if (safeEmojiStatus !== user.emojiStatus) {
    user.emojiStatus = safeEmojiStatus;
    changed = true;
  }

  const normalizedPremiumBadge = normalizePremiumBadge(user.premiumBadge);
  if (JSON.stringify(normalizedPremiumBadge) !== JSON.stringify(user.premiumBadge ?? null)) {
    user.premiumBadge = normalizedPremiumBadge;
    changed = true;
  }

  const normalizedBusiness = normalizeBusinessProfile(user.business);
  if (JSON.stringify(normalizedBusiness) !== JSON.stringify(user.business ?? null)) {
    user.business = normalizedBusiness;
    changed = true;
  }

  if (!user.cloudPassword || typeof user.cloudPassword !== "object") {
    user.cloudPassword = null;
    changed = true;
  }

  const existingChatIds = new Set(db.users.filter((entry) => entry.id !== user.id).map((entry) => String(entry.chatId)));
  const validChatId = /^\d{10}$/.test(String(user.chatId ?? ""));
  if (!validChatId || existingChatIds.has(String(user.chatId))) {
    user.chatId = generateNumericChatId(existingChatIds);
    changed = true;
  }

  const merged = mergeSettings(user.settings, {}, user.locale);
  if (merged.privacy && typeof merged.privacy === "object") {
    const normalizedLoginEmail = normalizeEmail(merged.privacy.loginEmail);
    merged.privacy.loginEmail = normalizedLoginEmail;
  }
  if (JSON.stringify(merged) !== JSON.stringify(user.settings)) {
    user.settings = merged;
    changed = true;
  }

  return changed;
}

export function createAuthService({ store, config }) {
  const systemBotBaseUsername = normalizeUsername(config.systemBotUsername) || "yooh_support_bot";
  const systemBotDisplayName = trimText(config.systemBotDisplayName) || "Yooh Support";
  const systemBotAbout = trimText(config.systemBotAbout) || "Official Yooh support and updates.";
  const smtpReady = Boolean(config.smtpHost && config.smtpPort && config.smtpFrom);
  const smsService = createSmsService(config);
  const smtpTransport = smtpReady
    ? nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: Boolean(config.smtpSecure),
        auth: config.smtpUser && config.smtpPass ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
      })
    : null;

  function buildAuthCodeSecurityHint() {
    return "Никому не сообщайте этот код. Сотрудники Yooh никогда его не запрашивают.";
  }

  function buildAuthCodePurposeLabel(purpose = "login") {
    return purpose === "register" ? "регистрации" : "входа";
  }

  function resolveUniqueSystemBotUsername(db, preferredUsername = systemBotBaseUsername) {
    const preferred = normalizeUsername(preferredUsername) || "yooh_support_bot";
    const takenByOther = db.users.some((entry) => entry.username === preferred && !entry.isSystemBot);
    if (!takenByOther) {
      return preferred;
    }

    for (let index = 1; index <= 999; index += 1) {
      const suffix = `_${index}`;
      const base = preferred.slice(0, Math.max(1, 32 - suffix.length));
      const candidate = normalizeUsername(`${base}${suffix}`);
      if (!candidate) {
        continue;
      }
      const exists = db.users.some((entry) => entry.username === candidate);
      if (!exists) {
        return candidate;
      }
    }

    return normalizeUsername(`${preferred.slice(0, 24)}_${Date.now().toString(36).slice(-6)}`) || preferred;
  }

  async function ensureSystemUser() {
    return store.transact((db) => {
      cleanupAuthState(db);

      let user = db.users.find((entry) => entry.isSystemBot);
      if (!user) {
        user = db.users.find((entry) => entry.username === systemBotBaseUsername) ?? null;
      }

      if (!user) {
        const username = resolveUniqueSystemBotUsername(db, systemBotBaseUsername);
        user = {
          id: uuid(),
          chatId: generateNumericChatId(new Set(db.users.map((entry) => String(entry.chatId ?? "")))),
          phone: `system:${username}`,
          phoneHash: hashPhone(`system:${username}`, config.contactHashSalt),
          username,
          displayName: systemBotDisplayName,
          about: systemBotAbout,
          avatar: "",
          banner: "",
          locale: "ru",
          createdAt: nowIso(),
          usageMonth: monthKey(),
          usedBytes: 0,
          cloudPassword: null,
          settings: defaultSettings("ru"),
          isBot: true,
          isSystemBot: true,
          isPremium: false,
          premiumUntil: null,
          starsBalance: 0,
          starsEarned: 0,
          starsExpireAt: null,
          emojiStatus: "",
          premiumBadge: createDefaultPremiumBadge(),
          business: createDefaultBusinessProfile(),
          contactHashes: [],
          contactsUpdatedAt: null,
        };
        db.users.push(user);
      } else {
        user.isBot = true;
        user.isSystemBot = true;
        if (!trimText(user.displayName)) {
          user.displayName = systemBotDisplayName;
        }
        if (!trimText(user.about)) {
          user.about = systemBotAbout;
        }
        if (typeof user.phone !== "string" || !user.phone.trim()) {
          user.phone = `system:${normalizeUsername(user.username) || systemBotBaseUsername}`;
        }
        const usernameTaken =
          !normalizeUsername(user.username) ||
          db.users.some((entry) => entry.id !== user.id && entry.username === user.username);
        if (usernameTaken) {
          user.username = resolveUniqueSystemBotUsername(db, systemBotBaseUsername);
        }
      }

      ensureUserShape(db, user, config);
      return toSafeUser(user);
    });
  }

  async function sendLoginCodeByEmail(email, code, expiresAt) {
    if (!smtpTransport) {
      return false;
    }

    const safeEmail = normalizeEmail(email);
    const safeCode = String(code ?? "").trim();
    const expiresInMinutes = Math.max(
      1,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60_000),
    );

    await smtpTransport.sendMail({
      from: config.smtpFrom,
      to: safeEmail,
      subject: "Код входа Yooh",
      text: `Ваш код для входа в Yooh: ${safeCode}
Срок действия: ${expiresInMinutes} мин.
${buildAuthCodeSecurityHint()}
Если это были не вы, просто проигнорируйте это письмо.`,
    });
    return true;
  }

  async function sendLoginCodeBySms(phone, code, expiresAt, purpose = "login") {
    const safePhone = normalizePhone(phone);
    if (!safePhone) {
      throw new HttpError(400, "Phone format is invalid");
    }
    const safeCode = String(code ?? "").trim();
    const expiresInMinutes = Math.max(
      1,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60_000),
    );
    const purposeLabel = buildAuthCodePurposeLabel(purpose);
    const message = `Yooh: код ${purposeLabel} ${safeCode}. Действует ${expiresInMinutes} мин. ${buildAuthCodeSecurityHint()}`;
    return smsService.sendSms({ to: safePhone, message });
  }

  async function requestRegisterCode(payload) {
    const parsed = requestRegisterOtpSchema.parse(payload);
    const phone = normalizePhone(parsed.phone);
    if (!phone) {
      throw new HttpError(400, "Phone format is invalid");
    }

    await store.read((db) => {
      const exists = db.users.some((entry) => entry.phone === phone);
      if (exists) {
        throw new HttpError(409, "Phone is already registered");
      }
    });

    const issued = await store.transact((db) => {
      cleanupAuthState(db);
      return issueOtpCode(db, phone, "register", config.otpTtlMs, "sms");
    });
    let delivery = "sms";
    try {
      await sendLoginCodeBySms(issued.phone, issued.code, issued.expiresAt, "register");
    } catch (error) {
      const status = Number.parseInt(error?.statusCode ?? error?.status ?? 0, 10);
      if (status === 503) {
        delivery = "admin";
      } else {
        throw new HttpError(503, error?.message || "Failed to send code by SMS");
      }
    }
    return {
      phone: issued.phone,
      purpose: issued.purpose,
      channel: "sms",
      delivery,
      expiresAt: issued.expiresAt,
      expiresInSeconds: issued.expiresInSeconds,
    };
  }

  async function requestLoginCode(payload) {
    const parsed = requestLoginOtpSchema.parse(payload);
    const rawEmail = normalizeEmail(parsed.email);
    const isEmailMode = Boolean(rawEmail);

    if (isEmailMode) {
      if (!isValidEmail(rawEmail)) {
        throw new HttpError(400, "Email format is invalid");
      }

      const targetEmail = await store.read((db) => {
        const matches = db.users.filter((entry) => getUserLoginEmail(entry) === rawEmail);
        if (!matches.length) {
          throw new HttpError(404, "User with this email is not registered");
        }
        if (matches.length > 1) {
          throw new HttpError(409, "Email is linked to multiple accounts");
        }
        return rawEmail;
      });

      const issued = await store.transact((db) => {
        cleanupAuthState(db);
        return issueOtpCode(db, targetEmail, "login", config.otpTtlMs, "email");
      });

      try {
        const delivered = await sendLoginCodeByEmail(targetEmail, issued.code, issued.expiresAt);
        return {
          target: issued.target,
          maskedTarget: maskEmail(targetEmail),
          purpose: issued.purpose,
          channel: "email",
          delivery: delivered ? "email" : "admin",
          expiresAt: issued.expiresAt,
          expiresInSeconds: issued.expiresInSeconds,
        };
      } catch {
        throw new HttpError(503, "Failed to send code by email");
      }
    }

    const phone = normalizePhone(parsed.phone);
    if (!phone) {
      throw new HttpError(400, "Phone format is invalid");
    }

    await store.read((db) => {
      const exists = db.users.some((entry) => entry.phone === phone);
      if (!exists) {
        throw new HttpError(404, "User with this phone is not registered");
      }
    });

    const issued = await store.transact((db) => {
      cleanupAuthState(db);
      return issueOtpCode(db, phone, "login", config.otpTtlMs, "sms");
    });
    let delivery = "sms";
    try {
      await sendLoginCodeBySms(issued.phone, issued.code, issued.expiresAt, "login");
    } catch (error) {
      const status = Number.parseInt(error?.statusCode ?? error?.status ?? 0, 10);
      if (status === 503) {
        delivery = "admin";
      } else {
        throw new HttpError(503, error?.message || "Failed to send code by SMS");
      }
    }
    return {
      phone: issued.phone,
      purpose: issued.purpose,
      channel: "sms",
      delivery,
      expiresAt: issued.expiresAt,
      expiresInSeconds: issued.expiresInSeconds,
    };
  }

  async function verifyRegisterCode(payload, context = {}) {
    const parsed = verifyRegisterSchema.parse(payload);
    const phone = normalizePhone(parsed.phone);
    if (!phone) {
      throw new HttpError(400, "Phone format is invalid");
    }

    const displayName = trimText(parsed.displayName) || `User ${phone.slice(-4)}`;
    const usernameInput = normalizeUsername(parsed.username);
    if (!usernameInput) {
      throw new HttpError(400, "Username format is invalid");
    }

    const locale = parsed.locale ?? "ru";

    return store.transact((db) => {
      cleanupAuthState(db);
      consumeOtpCode(db, phone, parsed.code, "register", "sms");

      if (db.users.some((entry) => entry.phone === phone)) {
        throw new HttpError(409, "Phone is already registered");
      }

      if (db.users.some((entry) => entry.username === usernameInput)) {
        throw new HttpError(409, "Такой юзернейм уже занят");
      }

      const chatId = generateNumericChatId(new Set(db.users.map((entry) => String(entry.chatId))));
      const user = {
        id: uuid(),
        chatId,
        phone,
        phoneHash: hashPhone(phone, config.contactHashSalt),
        username: usernameInput,
        displayName,
        about: "",
        avatar: "",
        banner: "",
        locale,
        createdAt: nowIso(),
        usageMonth: monthKey(),
        usedBytes: 0,
        cloudPassword: null,
        settings: defaultSettings(locale),
        isBot: false,
        isSystemBot: false,
        isPremium: false,
        premiumUntil: null,
        starsBalance: 0,
        starsEarned: 0,
        starsExpireAt: null,
        emojiStatus: "",
        premiumBadge: createDefaultPremiumBadge(),
        business: createDefaultBusinessProfile(),
        contactHashes: [],
        contactsUpdatedAt: null,
      };
      db.users.push(user);

      const session = createSession(db, user.id, normalizeSessionDeviceMeta(parsed.device, context), {
        source: "register",
      });
      const safeUser = toSafeUser(user, { sessionId: session.id });
      const token = createToken(config, safeUser, session.id);
      return { token, user: safeUser };
    });
  }

  async function verifyLoginCode(payload, context = {}) {
    const parsed = verifyLoginSchema.parse(payload);
    const email = normalizeEmail(parsed.email);
    const isEmailMode = Boolean(email);
    const phone = isEmailMode ? "" : normalizePhone(parsed.phone);
    if (!isEmailMode && !phone) {
      throw new HttpError(400, "Phone format is invalid");
    }
    if (isEmailMode && !isValidEmail(email)) {
      throw new HttpError(400, "Email format is invalid");
    }

    const locale = parsed.locale ?? "ru";

    return store.transact((db) => {
      cleanupAuthState(db);
      consumeOtpCode(db, isEmailMode ? email : phone, parsed.code, "login", isEmailMode ? "email" : "sms");

      const user = isEmailMode
        ? db.users.find((entry) => getUserLoginEmail(entry) === email)
        : db.users.find((entry) => entry.phone === phone);
      if (!user) {
        throw new HttpError(404, isEmailMode ? "User with this email is not registered" : "User with this phone is not registered");
      }

      user.locale = locale;
      user.settings = mergeSettings(user.settings, { language: locale }, locale);
      ensureUserShape(db, user, config);

      const hasCloudPassword = Boolean(user.cloudPassword?.hash && user.cloudPassword?.salt);
      if (hasCloudPassword) {
        const ticket = {
          id: uuid(),
          userId: user.id,
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + OTP_LOGIN_TICKET_TTL_MS).toISOString(),
          locale,
          device: normalizeSessionDeviceMeta(parsed.device, context),
        };
        db.loginTickets = db.loginTickets.filter((entry) => entry.userId !== user.id);
        db.loginTickets.push(ticket);

        return {
          requiresCloudPassword: true,
          loginTicket: ticket.id,
          expiresAt: ticket.expiresAt,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
          },
        };
      }

      const session = createSession(db, user.id, normalizeSessionDeviceMeta(parsed.device, context), {
        source: "auth",
      });
      const safeUser = toSafeUser(user, { sessionId: session.id });
      const token = createToken(config, safeUser, session.id);
      return { token, user: safeUser };
    });
  }

  async function verifyCloudPassword(payload, context = {}) {
    const parsed = verifyCloudPasswordSchema.parse(payload);

    return store.transact((db) => {
      cleanupAuthState(db);
      const loginTicket = db.loginTickets.find((entry) => entry.id === parsed.loginTicket);
      if (!loginTicket) {
        throw new HttpError(400, "Cloud password challenge is invalid or expired");
      }

      const user = db.users.find((entry) => entry.id === loginTicket.userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      if (!isCloudPasswordValid(user, parsed.password)) {
        throw new HttpError(401, "Cloud password is invalid");
      }

      db.loginTickets = db.loginTickets.filter((entry) => entry.id !== loginTicket.id);
      user.locale = parsed.locale ?? loginTicket.locale ?? user.locale ?? "ru";
      user.settings = mergeSettings(user.settings, { language: user.locale }, user.locale);
      ensureUserShape(db, user, config);

      const session = createSession(db, user.id, normalizeSessionDeviceMeta(loginTicket.device, context), {
        source: "auth",
      });
      const safeUser = toSafeUser(user, { sessionId: session.id });
      const token = createToken(config, safeUser, session.id);
      return { token, user: safeUser };
    });
  }

  async function createQrLogin(payload = {}, context = {}) {
    const parsed = createQrLoginSchema.parse(payload);
    return store.transact((db) => {
      cleanupAuthState(db);
      const now = Date.now();
      const entry = {
        id: uuid(),
        token: uuid(),
        status: "pending",
        userId: null,
        sessionId: null,
        authToken: null,
        device: normalizeSessionDeviceMeta(parsed.device, context),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + QR_LOGIN_TTL_MS).toISOString(),
        authorizedAt: null,
      };
      db.qrLogins.push(entry);
      return {
        token: entry.token,
        expiresAt: entry.expiresAt,
      };
    });
  }

  async function getQrLoginStatus(rawToken) {
    const token = String(rawToken ?? "").trim();
    if (!token) {
      throw new HttpError(400, "QR token is required");
    }

    return store.transact((db) => {
      cleanupAuthState(db);
      const entry = db.qrLogins.find((item) => item.token === token);
      if (!entry) {
        return { status: "expired" };
      }

      if (entry.status === "pending") {
        return { status: "pending", expiresAt: entry.expiresAt };
      }

      if (entry.status === "authorized" && entry.userId && entry.sessionId && entry.authToken) {
        const user = db.users.find((candidate) => candidate.id === entry.userId);
        if (!user) {
          db.qrLogins = db.qrLogins.filter((item) => item.id !== entry.id);
          return { status: "expired" };
        }

        const safeUser = toSafeUser(user, { sessionId: entry.sessionId });
        db.qrLogins = db.qrLogins.filter((item) => item.id !== entry.id);
        return {
          status: "authorized",
          token: entry.authToken,
          user: safeUser,
          expiresAt: entry.expiresAt,
        };
      }

      return { status: "expired" };
    });
  }

  async function linkDeviceByQr(userId, payload) {
    const parsed = linkQrLoginSchema.parse(payload);
    return store.transact((db) => {
      cleanupAuthState(db);
      const qrLogin = db.qrLogins.find((entry) => entry.token === parsed.token);
      if (!qrLogin) {
        throw new HttpError(404, "QR login request not found");
      }

      if (qrLogin.status !== "pending") {
        throw new HttpError(409, "QR login request is already used");
      }

      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      const session = createSession(db, user.id, normalizeSessionDeviceMeta(qrLogin.device), {
        source: "qr",
      });
      const safeUser = toSafeUser(user, { sessionId: session.id });
      const authToken = createToken(config, safeUser, session.id);

      qrLogin.status = "authorized";
      qrLogin.userId = user.id;
      qrLogin.sessionId = session.id;
      qrLogin.authToken = authToken;
      qrLogin.authorizedAt = nowIso();

      return { linked: true, expiresAt: qrLogin.expiresAt };
    });
  }

  async function getUserById(userId) {
    return store.transact((db) => {
      cleanupAuthState(db);
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        return null;
      }
      ensureUserShape(db, user, config);
      return toSafeUser(user);
    });
  }

  async function canViewerSeeLastSeenByUserIds(viewerUserId, targetUserId) {
    const safeViewerId = String(viewerUserId ?? "").trim();
    const safeTargetId = String(targetUserId ?? "").trim();
    if (!safeViewerId || !safeTargetId) {
      return false;
    }

    return store.read((db) => {
      const target = db.users.find((entry) => entry.id === safeTargetId);
      if (!target) {
        return false;
      }
      ensureUserShape(db, target, config);
      return canViewerSeeLastSeen(db, target, safeViewerId);
    });
  }

  async function canViewerCallTargetByUserIds(viewerUserId, targetUserId) {
    const safeViewerId = String(viewerUserId ?? "").trim();
    const safeTargetId = String(targetUserId ?? "").trim();
    if (!safeViewerId || !safeTargetId) {
      return false;
    }

    return store.read((db) => {
      const target = db.users.find((entry) => entry.id === safeTargetId);
      if (!target) {
        return false;
      }
      ensureUserShape(db, target, config);
      return canViewerCallTarget(db, target, safeViewerId);
    });
  }

  async function findUserByLoginTarget(target, channel = "sms") {
    const normalizedChannel = String(channel ?? "sms").trim() || "sms";
    return store.read((db) => {
      cleanupAuthState(db);
      const normalizedTarget = normalizedChannel === "email" ? normalizeEmail(target) : normalizePhone(target);
      if (!normalizedTarget) {
        return null;
      }
      const user = normalizedChannel === "email"
        ? db.users.find((entry) => getUserLoginEmail(entry) === normalizedTarget)
        : db.users.find((entry) => entry.phone === normalizedTarget);
      if (!user) {
        return null;
      }
      ensureUserShape(db, user, config);
      return toSafeUser(user);
    });
  }

  async function getActiveAuthCode(target, purpose, channel = "sms") {
    const normalizedTarget = String(target ?? "").trim();
    const normalizedPurpose = String(purpose ?? "").trim();
    const normalizedChannel = String(channel ?? "sms").trim() || "sms";
    if (!normalizedTarget || !normalizedPurpose) {
      return null;
    }

    return store.read((db) => {
      cleanupAuthState(db);
      const entry = findLatestActiveAuthCode(db, normalizedTarget, normalizedPurpose, normalizedChannel);
      if (!entry) {
        return null;
      }
      return {
        id: entry.id,
        target: getAuthCodeTarget(entry),
        channel: getAuthCodeChannel(entry),
        purpose: entry.purpose,
        code: entry.code,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      };
    });
  }

  async function updateProfile(userId, payload) {
    const parsed = updateProfileSchema.parse(payload);

    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      if (parsed.displayName !== undefined) {
        user.displayName = trimText(parsed.displayName);
        if (!user.displayName) {
          throw new HttpError(400, "Display name is invalid");
        }
      }

      if (parsed.locale !== undefined) {
        user.locale = parsed.locale;
      }

      if (parsed.username !== undefined) {
        const username = normalizeUsername(parsed.username);
        if (!username) {
          throw new HttpError(400, "Username format is invalid");
        }

        const usernameTaken = db.users.some((entry) => entry.username === username && entry.id !== user.id);
        if (usernameTaken) {
          throw new HttpError(409, "Такой юзернейм уже занят");
        }

        user.username = username;
      }

      if (parsed.about !== undefined) {
        const maxBioLength = buildYoohPlusLimits(user, config).maxBioLength;
        user.about = trimText(parsed.about).slice(0, maxBioLength);
      }

      if (parsed.avatar !== undefined) {
        user.avatar = trimText(parsed.avatar);
      }

      if (parsed.banner !== undefined) {
        user.banner = trimText(parsed.banner);
      }

      if (parsed.birthday !== undefined) {
        const raw = trimText(parsed.birthday);
        if (raw) {
          const [y, m, d] = raw.split("-").map((part) => Number.parseInt(part, 10));
          const valid =
            Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
            y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
          if (!valid) {
            throw new HttpError(400, "Birthday is invalid");
          }
          user.birthday = raw;
        } else {
          user.birthday = "";
        }
      }

      if (parsed.premiumBadge !== undefined) {
        if (!user.isPremium) {
          throw new HttpError(403, "Yooh Plus required for badge customization");
        }
        user.premiumBadge = normalizePremiumBadge(parsed.premiumBadge, normalizePremiumBadge(user.premiumBadge));
      }

      ensureUserShape(db, user, config);
      return toSafeUser(user);
    });
  }

  async function checkUsernameAvailability(userId, rawUsername) {
    const username = normalizeUsername(rawUsername);
    if (!username) {
      throw new HttpError(400, "Username format is invalid");
    }

    return store.read((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      const occupiedBy = db.users.find((entry) => entry.username === username);
      const isCurrent = Boolean(occupiedBy && occupiedBy.id === userId);
      return {
        username,
        available: !occupiedBy || isCurrent,
        isCurrent,
      };
    });
  }

  function findUserByTarget(db, target) {
    const rawTarget = trimText(target);
    if (!rawTarget) {
      throw new HttpError(400, "User target is required");
    }
    const normalizedUsername = normalizeUsername(rawTarget);
    const normalizedPhone = normalizePhone(rawTarget);
    const normalizedChatId = /^\d{10}$/.test(rawTarget) ? rawTarget : "";
    const user =
      db.users.find((entry) => entry.id === rawTarget) ??
      db.users.find((entry) => String(entry.chatId ?? "") === normalizedChatId) ??
      (normalizedUsername ? db.users.find((entry) => entry.username === normalizedUsername) : null) ??
      (normalizedPhone ? db.users.find((entry) => entry.phone === normalizedPhone) : null) ??
      null;
    if (!user) {
      throw new HttpError(404, "User not found");
    }
    return user;
  }

  async function setAdminEntitlements(target, payload = {}) {
    return store.transact((db) => {
      cleanupAuthState(db);
      const user = findUserByTarget(db, target);
      ensureUserShape(db, user, config);

      if (payload.isPremium !== undefined) {
        user.isPremium = Boolean(payload.isPremium);
        user.isPlus = user.isPremium;
        if (!user.isPremium && payload.premiumUntil === undefined) {
          user.premiumUntil = null;
        }
      }

      if (payload.premiumUntil !== undefined) {
        user.premiumUntil = normalizeIsoOrNull(payload.premiumUntil);
        if (payload.isPremium === undefined && user.premiumUntil) {
          user.isPremium = true;
        }
      }

      if (payload.starsBalance !== undefined) {
        user.starsBalance = Math.max(0, Number.parseInt(payload.starsBalance, 10) || 0);
      }

      if (payload.starsDelta !== undefined) {
        user.starsBalance = Math.max(0, (Number.parseInt(user.starsBalance ?? 0, 10) || 0) + (Number.parseInt(payload.starsDelta, 10) || 0));
      }

      if (payload.starsEarned !== undefined) {
        user.starsEarned = Math.max(0, Number.parseInt(payload.starsEarned, 10) || 0);
      }

      if (payload.emojiStatus !== undefined) {
        user.emojiStatus = trimText(payload.emojiStatus).slice(0, 32);
      }

      if (payload.businessEnabled !== undefined) {
        user.business = normalizeBusinessProfile({
          ...user.business,
          enabled: Boolean(payload.businessEnabled),
        });
      }

      if (payload.business && typeof payload.business === "object") {
        user.business = normalizeBusinessProfile({
          ...user.business,
          ...payload.business,
        });
      }

      if (payload.feedbackBlocked !== undefined) {
        user.feedbackBlocked = Boolean(payload.feedbackBlocked);
      }

      if (payload.starsExpireAt !== undefined) {
        user.starsExpireAt = normalizeIsoOrNull(payload.starsExpireAt);
      }
      if (user.starsBalance > 0 && !user.starsExpireAt) {
        user.starsExpireAt = new Date(Date.now() + STARS_EXPIRE_MS).toISOString();
      }
      if (user.starsBalance <= 0) {
        user.starsExpireAt = null;
      }

      ensureUserShape(db, user, config);
      return toSafeUser(user, { config });
    });
  }

  async function getSettings(userId) {
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      ensureUserShape(db, user, config);
      return user.settings;
    });
  }

  async function updateSettings(userId, payload) {
    const parsed = updateSettingsSchema.parse(payload);

    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      ensureUserShape(db, user, config);
      if (parsed.language) {
        user.locale = parsed.language;
      }

      if (parsed.privacy && typeof parsed.privacy === "object" && Object.hasOwn(parsed.privacy, "loginEmail")) {
        const rawValue = String(parsed.privacy.loginEmail ?? "").trim();
        const loginEmail = normalizeEmail(rawValue);
        if (loginEmail && !isValidEmail(loginEmail)) {
          throw new HttpError(400, "Email format is invalid");
        }

        if (loginEmail) {
          const taken = db.users.some((entry) => entry.id !== userId && getUserLoginEmail(entry) === loginEmail);
          if (taken) {
            throw new HttpError(409, "Email is already linked to another account");
          }
        }

        parsed.privacy.loginEmail = loginEmail;
      }

      user.settings = mergeSettings(user.settings, parsed, user.locale);
      return user.settings;
    });
  }

  async function setCloudPassword(userId, payload) {
    const parsed = setCloudPasswordSchema.parse(payload);
    const rawPassword = String(parsed.password ?? "").trim();

    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      if (!rawPassword) {
        user.cloudPassword = null;
        return { enabled: false };
      }

      if (rawPassword.length < 4) {
        throw new HttpError(400, "Cloud password must be at least 4 characters");
      }

      const hashed = createPasswordHash(rawPassword);
      user.cloudPassword = {
        hash: hashed.hash,
        salt: hashed.salt,
        updatedAt: nowIso(),
      };
      return { enabled: true };
    });
  }

async function listSessions(userId, currentSessionId) {
  return store.transact((db) => {
    cleanupAuthState(db);
    const allSessions = db.sessions
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

    const deduplicated = [];
    const seenKeys = new Map();
    const prioritized = [
      ...allSessions.filter((entry) => entry.id === currentSessionId),
      ...allSessions.filter((entry) => entry.id !== currentSessionId),
    ];
    for (const entry of prioritized) {
      const key = getSessionDeviceKey(entry);
      const seenIndex = seenKeys.get(key);
      if (seenIndex === undefined) {
        seenKeys.set(key, deduplicated.length);
        deduplicated.push(entry);
        continue;
      }

      const selected = deduplicated[seenIndex];
      if (selected?.id !== currentSessionId && entry?.id === currentSessionId) {
        deduplicated[seenIndex] = entry;
      }
    }

    const sessions = deduplicated.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    const current = sessions.find((entry) => entry.id === currentSessionId) ?? sessions[0] ?? null;
    const currentId = current?.id ?? null;
    return {
      current: current ? serializeSession(current, currentId) : null,
      others: sessions.filter((entry) => entry.id !== currentId).map((entry) => serializeSession(entry, currentId)),
    };
  });
}

  async function renameCurrentSession(userId, currentSessionId, payload) {
    const parsed = renameSessionSchema.parse(payload);
    const nextName = trimText(parsed.name);
    return store.transact((db) => {
      const session = db.sessions.find((entry) => entry.id === currentSessionId && entry.userId === userId);
      if (!session) {
        throw new HttpError(404, "Session not found");
      }
      session.name = nextName;
      session.lastSeenAt = nowIso();
      return serializeSession(session, currentSessionId);
    });
  }

async function terminateOtherSessions(userId, currentSessionId) {
  return store.transact((db) => {
    const removedSessionIds = db.sessions
      .filter((entry) => entry.userId === userId && entry.id !== currentSessionId)
      .map((entry) => entry.id);
    const before = db.sessions.length;
    db.sessions = db.sessions.filter((entry) => !(entry.userId === userId && entry.id !== currentSessionId));
    return { removed: Math.max(0, before - db.sessions.length), removedSessionIds };
  });
}

async function removeSession(userId, currentSessionId, targetSessionId) {
    const safeTargetSessionId = String(targetSessionId ?? "").trim();
    if (!safeTargetSessionId) {
      throw new HttpError(400, "Session id is required");
    }
    if (safeTargetSessionId === currentSessionId) {
      throw new HttpError(400, "Current session cannot be removed");
    }

  return store.transact((db) => {
    const targetSession = db.sessions.find((entry) => entry.id === safeTargetSessionId && entry.userId === userId);
    if (!targetSession) {
      throw new HttpError(404, "Session not found");
    }

    const targetDeviceKey = getSessionDeviceKey(targetSession);
    const removedSessionIds = db.sessions
      .filter(
        (entry) =>
          entry.userId === userId &&
          entry.id !== currentSessionId &&
          getSessionDeviceKey(entry) === targetDeviceKey,
      )
      .map((entry) => entry.id);
    if (!removedSessionIds.length) {
      throw new HttpError(404, "Session not found");
    }

    db.sessions = db.sessions.filter((entry) => !removedSessionIds.includes(entry.id));
    return { removed: true, sessionId: safeTargetSessionId, removedSessionIds };
  });
}

  async function authenticate(token, context = {}) {
    if (!token) {
      throw new HttpError(401, "Token is missing");
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, "Token is invalid");
    }

    const userId = typeof payload === "object" && payload.sub ? String(payload.sub) : null;
    const sessionId = typeof payload === "object" && payload.sid ? String(payload.sid) : null;
    if (!userId || !sessionId) {
      throw new HttpError(401, "Token payload is invalid");
    }

    return store.transact((db) => {
      cleanupAuthState(db);
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(401, "User not found");
      }

      const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === userId);
      if (!session) {
        throw new HttpError(401, "Session is invalid or expired");
      }

      ensureUserShape(db, user, config);
      touchSession(session, normalizeSessionDeviceMeta({}, context));
      return toSafeUser(user, { sessionId: session.id });
    });
  }

  async function listActiveCodes() {
    const now = Date.now();
    return store.read((db) =>
      db.authCodes
        .filter((entry) => new Date(entry.expiresAt).getTime() > now)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((entry) => ({
          id: entry.id,
          phone: getAuthCodeTarget(entry),
          target: getAuthCodeTarget(entry),
          channel: getAuthCodeChannel(entry),
          code: entry.code,
          purpose: entry.purpose,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
        })),
    );
  }

  async function migrateUsers() {
    await store.transact((db) => {
      cleanupAuthState(db);
      for (const user of db.users) {
        ensureUserShape(db, user, config);
      }
    });
  }

  /// Peer-to-peer Stars transfer. Additive endpoint: balances were previously
  /// admin-only. Guarded by integer bounds and sender balance; the whole
  /// move is one transaction so money is never created or lost.
  async function transferStars(userId, payload = {}) {
    const amount = Number.parseInt(payload?.amount, 10);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
      throw new HttpError(400, "Amount must be an integer between 1 and 10000");
    }
    return store.transact((db) => {
      const sender = db.users.find((entry) => entry.id === userId);
      if (!sender) {
        throw new HttpError(404, "User not found");
      }
      const receiver = findUserByTarget(db, payload?.target);
      if (receiver.id === sender.id) {
        throw new HttpError(400, "Cannot send Stars to yourself");
      }
      if (receiver.isSystemBot) {
        throw new HttpError(400, "Cannot send Stars to the support bot");
      }
      ensureUserShape(db, sender, config);
      ensureUserShape(db, receiver, config);
      const balance = Math.max(0, Number.parseInt(sender.starsBalance ?? 0, 10) || 0);
      if (balance < amount) {
        throw new HttpError(400, "Not enough Stars");
      }
      sender.starsBalance = balance - amount;
      receiver.starsBalance = Math.max(0, Number.parseInt(receiver.starsBalance ?? 0, 10) || 0) + amount;
      return {
        sent: amount,
        balance: sender.starsBalance,
        target: { id: receiver.id, username: receiver.username, displayName: receiver.displayName },
      };
    });
  }

  /// Permanent account deletion. Messages stay (attributed to a removed
  /// sender, which hydration already tolerates); memberships, sessions,
  /// stories, requests and tickets are removed. With 2FA on, the cloud
  /// password is required as a second confirmation factor.
  async function deleteAccount(userId, payload = {}) {
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      if (user.cloudPassword?.hash && !isCloudPasswordValid(user, payload?.password)) {
        throw new HttpError(403, "Cloud password is required to delete the account");
      }
      const uid = user.id;
      db.users = db.users.filter((entry) => entry.id !== uid);
      if (Array.isArray(db.memberships)) {
        db.memberships = db.memberships.filter((entry) => entry.userId !== uid);
      }
      if (Array.isArray(db.sessions)) {
        db.sessions = db.sessions.filter((entry) => entry.userId !== uid);
      }
      if (Array.isArray(db.stories)) {
        db.stories = db.stories.filter((entry) => entry.authorId !== uid);
      }
      if (Array.isArray(db.messageRequests)) {
        db.messageRequests = db.messageRequests.filter(
          (entry) => entry.fromUserId !== uid && entry.toUserId !== uid,
        );
      }
      if (Array.isArray(db.supportTickets)) {
        db.supportTickets = db.supportTickets.filter((entry) => entry.userId !== uid);
      }
      if (Array.isArray(db.feedbackTickets)) {
        db.feedbackTickets = db.feedbackTickets.filter((entry) => entry.userId !== uid);
      }
      return { deleted: true };
    });
  }

  return {
    requestRegisterCode,
    requestLoginCode,
    verifyRegisterCode,
    verifyLoginCode,
    verifyCloudPassword,
    createQrLogin,
    getQrLoginStatus,
    linkDeviceByQr,
    updateProfile,
    checkUsernameAvailability,
    getSettings,
    updateSettings,
    setCloudPassword,
    listSessions,
    renameCurrentSession,
    terminateOtherSessions,
    removeSession,
    authenticate,
    getUserById,
    canViewerSeeLastSeenByUserIds,
    canViewerCallTargetByUserIds,
    findUserByLoginTarget,
    getActiveAuthCode,
    listActiveCodes,
    setAdminEntitlements,
    transferStars,
    deleteAccount,
    ensureSystemUser,
    migrateUsers,
  };
}

