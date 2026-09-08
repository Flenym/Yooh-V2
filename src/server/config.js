import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLEANUP_INTERVAL_MS,
  DEFAULT_FILE_LIMIT_BYTES,
  DEFAULT_FILE_RETENTION_DAYS,
  DEFAULT_MONTH_LIMIT_BYTES,
  OTP_TTL_MS,
} from "./constants.js";

// Resolve project root from this file location so starting the server from a different CWD
// (e.g. via `run/*.cmd` that `cd` into another folder) still uses the same runtime storage.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildIceServers() {
  const stunUrls = toList(
    process.env.STUN_URLS ??
      process.env.WEBRTC_STUN_URLS ??
      "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
  );
  const turnUrls = toList(
    process.env.TURN_URLS ??
      process.env.WEBRTC_TURN_URLS ??
      process.env.TURN_URL ??
      process.env.WEBRTC_TURN_URL ??
      "",
  );
  const turnUsername = (process.env.TURN_USERNAME ?? process.env.WEBRTC_TURN_USERNAME ?? "").trim();
  const turnCredential = (process.env.TURN_CREDENTIAL ?? process.env.WEBRTC_TURN_CREDENTIAL ?? "").trim();

  const iceServers = [];
  if (stunUrls.length) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
}

export function loadConfig(overrides = {}) {
  const root = PROJECT_ROOT;
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  const configuredSmsProvider = String(process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const defaultSmsProvider =
    configuredSmsProvider || (nodeEnv === "production" ? "none" : "mock");
  return {
    port: toInt(process.env.PORT, 4200),
    adminPort: toInt(process.env.ADMIN_PORT, 4201),
    host: process.env.HOST ?? "0.0.0.0",
    adminHost: process.env.ADMIN_HOST ?? process.env.HOST ?? "0.0.0.0",
    jwtSecret: process.env.JWT_SECRET ?? "yooh-dev-secret",
    adminPanelToken: process.env.ADMIN_PANEL_TOKEN ?? "yooh-admin-local",
    dataFile: path.join(root, "runtime", "db.json"),
    uploadDir: path.join(root, "runtime", "uploads"),
    clientDir: path.join(root, "src", "client"),
    monthLimitBytes: toInt(process.env.MONTH_LIMIT_BYTES, DEFAULT_MONTH_LIMIT_BYTES),
    fileLimitBytes: toInt(process.env.FILE_LIMIT_BYTES, DEFAULT_FILE_LIMIT_BYTES),
    fileRetentionDays: toInt(process.env.FILE_RETENTION_DAYS, DEFAULT_FILE_RETENTION_DAYS),
    webrtcIceServers: buildIceServers(),
    otpTtlMs: OTP_TTL_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
    smtpHost: (process.env.SMTP_HOST ?? "").trim(),
    smtpPort: toInt(process.env.SMTP_PORT, 587),
    smtpSecure: toBoolean(process.env.SMTP_SECURE, false),
    smtpUser: (process.env.SMTP_USER ?? "").trim(),
    smtpPass: (process.env.SMTP_PASS ?? "").trim(),
    smtpFrom: (process.env.SMTP_FROM ?? "").trim(),
    systemBotUsername: (process.env.SYSTEM_BOT_USERNAME ?? "yooh_support_bot").trim(),
    systemBotDisplayName: (process.env.SYSTEM_BOT_DISPLAY_NAME ?? "Yooh Support").trim(),
    systemBotAbout:
      (process.env.SYSTEM_BOT_ABOUT ?? "Official Yooh support and updates.").trim(),
    smsProvider: String(defaultSmsProvider).trim(),
    smsRequestTimeoutMs: toInt(process.env.SMS_REQUEST_TIMEOUT_MS, 10_000),
    smsTextbeeApiKey: (process.env.SMS_TEXTBEE_API_KEY ?? "").trim(),
    smsTextbeeDeviceId: (process.env.SMS_TEXTBEE_DEVICE_ID ?? "").trim(),
    smsTextbeeBaseUrl: (process.env.SMS_TEXTBEE_BASE_URL ?? "").trim(),
    smsMySmsgateApiKey: (process.env.SMS_MYSMSGATE_API_KEY ?? "").trim(),
    smsMySmsgateBaseUrl: (process.env.SMS_MYSMSGATE_BASE_URL ?? "").trim(),
    smsTwilioAccountSid: (process.env.SMS_TWILIO_ACCOUNT_SID ?? "").trim(),
    smsTwilioAuthToken: (process.env.SMS_TWILIO_AUTH_TOKEN ?? "").trim(),
    smsTwilioFrom: (process.env.SMS_TWILIO_FROM ?? "").trim(),
    smsTwilioBaseUrl: (process.env.SMS_TWILIO_BASE_URL ?? "").trim(),
    smsHttpUrl: (process.env.SMS_HTTP_URL ?? "").trim(),
    smsHttpToken: (process.env.SMS_HTTP_TOKEN ?? "").trim(),
    smsHttpHeaders: (process.env.SMS_HTTP_HEADERS ?? "").trim(),
    smsFallbackToSupportBot: toBoolean(process.env.SMS_FALLBACK_TO_SUPPORT_BOT, true),
    contactHashSalt: (process.env.CONTACT_HASH_SALT ?? process.env.CONTACTS_HASH_SALT ?? "yooh-contact-salt").trim(),
    vapidPublicKey: (process.env.VAPID_PUBLIC_KEY ?? "").trim(),
    vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY ?? "").trim(),
    vapidSubject: (process.env.VAPID_SUBJECT ?? "mailto:support@yooh.app").trim(),
    ...overrides,
  };
}
