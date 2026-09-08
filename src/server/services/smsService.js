import { HttpError } from "../errors.js";

function safeTrim(value) {
  return String(value ?? "").trim();
}

function normalizeProvider(value) {
  return safeTrim(value).toLowerCase() || "none";
}

function parseHeaderJson(value) {
  const raw = safeTrim(value);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Ignore invalid json, fall back to empty headers.
  }
  return {};
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export function createSmsService(config = {}) {
  const provider = normalizeProvider(config.smsProvider);
  const timeoutMs = Number.parseInt(config.smsRequestTimeoutMs ?? "10000", 10) || 10_000;

  async function sendWithTextbee({ to, message }) {
    const apiKey = safeTrim(config.smsTextbeeApiKey);
    const deviceId = safeTrim(config.smsTextbeeDeviceId);
    const baseUrl = safeTrim(config.smsTextbeeBaseUrl) || "https://api.textbee.dev/api/v1";
    if (!apiKey || !deviceId) {
      throw new HttpError(503, "Textbee API key or device id is missing");
    }
    const response = await fetchWithTimeout(
      `${baseUrl}/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          recipients: [to],
          message,
        }),
      },
      timeoutMs,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(503, `Textbee SMS failed: ${response.status} ${text}`.trim());
    }
    return true;
  }

  async function sendWithMySmsgate({ to, message }) {
    const apiKey = safeTrim(config.smsMySmsgateApiKey);
    const baseUrl = safeTrim(config.smsMySmsgateBaseUrl) || "https://mysmsgate.net";
    if (!apiKey) {
      throw new HttpError(503, "MySMSGate API key is missing");
    }
    const response = await fetchWithTimeout(
      `${baseUrl}/api/v1/send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          to,
          message,
        }),
      },
      timeoutMs,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(503, `MySMSGate SMS failed: ${response.status} ${text}`.trim());
    }
    return true;
  }

  async function sendWithTwilio({ to, message }) {
    const accountSid = safeTrim(config.smsTwilioAccountSid);
    const authToken = safeTrim(config.smsTwilioAuthToken);
    const from = safeTrim(config.smsTwilioFrom);
    const baseUrl = safeTrim(config.smsTwilioBaseUrl) || "https://api.twilio.com/2010-04-01";
    if (!accountSid || !authToken || !from) {
      throw new HttpError(503, "Twilio credentials are missing");
    }
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const body = new URLSearchParams({
      From: from,
      To: to,
      Body: message,
    });
    const response = await fetchWithTimeout(
      `${baseUrl}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      timeoutMs,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(503, `Twilio-compatible SMS failed: ${response.status} ${text}`.trim());
    }
    return true;
  }

  async function sendWithHttp({ to, message }) {
    const url = safeTrim(config.smsHttpUrl);
    if (!url) {
      throw new HttpError(503, "SMS HTTP URL is missing");
    }
    const headers = {
      "Content-Type": "application/json",
      ...parseHeaderJson(config.smsHttpHeaders),
    };
    const token = safeTrim(config.smsHttpToken);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ to, message }),
      },
      timeoutMs,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(503, `SMS HTTP gateway failed: ${response.status} ${text}`.trim());
    }
    return true;
  }

  async function sendSms({ to, message }) {
    const safeTo = safeTrim(to);
    const safeMessage = safeTrim(message);
    if (!safeTo || !safeMessage) {
      throw new HttpError(400, "SMS payload is invalid");
    }
    if (provider === "mock") {
      return true;
    }
    if (provider === "none") {
      throw new HttpError(503, "SMS provider is not configured");
    }
    if (provider === "textbee") {
      return sendWithTextbee({ to: safeTo, message: safeMessage });
    }
    if (provider === "mysmsgate") {
      return sendWithMySmsgate({ to: safeTo, message: safeMessage });
    }
    if (provider === "twilio") {
      return sendWithTwilio({ to: safeTo, message: safeMessage });
    }
    if (provider === "http") {
      return sendWithHttp({ to: safeTo, message: safeMessage });
    }
    throw new HttpError(503, "Unsupported SMS provider");
  }

  return {
    provider,
    sendSms,
  };
}
