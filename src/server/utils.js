import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function randomOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

export function byteLength(text) {
  return Buffer.byteLength(text ?? "", "utf8");
}

export function normalizePhone(value) {
  const phone = String(value ?? "").replace(/[^\d+]/g, "");
  const valid = /^\+?[1-9]\d{9,14}$/.test(phone);
  if (!valid) {
    return null;
  }

  return phone.startsWith("+") ? phone : `+${phone}`;
}

export function hashPhone(value, salt = "") {
  const normalized = normalizePhone(value);
  if (!normalized) {
    return "";
  }
  return crypto.createHash("sha256").update(`${normalized}${salt}`).digest("hex");
}

export function normalizeUsername(value) {
  if (typeof value !== "string") {
    return null;
  }

  const username = value.trim();
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    return null;
  }

  return username.toLowerCase();
}

export function normalizePublicHandle(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^[@%&*$]+/, "");
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
}

const GROUP_TITLE_SPECIAL = new Set(["[", "]", "(", ")", "-", "_", "=", "+", "/", "?", "<", ">"]);

export function isValidGroupTitle(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  return Array.from(value).every((char) => {
    if (/\s/u.test(char)) {
      return true;
    }
    if (GROUP_TITLE_SPECIAL.has(char)) {
      return true;
    }
    if (/[\p{L}\p{N}]/u.test(char)) {
      return true;
    }
    if (/\p{Extended_Pictographic}/u.test(char)) {
      return true;
    }
    if (/\p{Emoji_Component}/u.test(char)) {
      return true;
    }
    return char === "\u200D" || char === "\uFE0F";
  });
}

export function generateNumericChatId(existingIds = new Set()) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = String(crypto.randomInt(1_000_000_000, 9_999_999_999));
    if (!existingIds.has(value)) {
      return value;
    }
  }

  throw new Error("Failed to generate unique numeric chat id");
}

export function trimText(value) {
  return String(value ?? "").trim();
}
