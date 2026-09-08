import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { createAppContext } from "../src/server/app.js";
import { attachRealtime } from "../src/server/realtime.js";

const ADMIN_TOKEN = "ui-admin-token";

let tempDir;
let context;
let server;
let api;
let baseUrl;
let browser;
let primaryUser;
let secondaryUser;
let tertiaryUser;
let directChatId;

function listen(serverInstance, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    serverInstance.listen(0, host, () => {
      const address = serverInstance.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test server address"));
        return;
      }
      resolve(address);
    });
    serverInstance.once("error", reject);
  });
}

async function getOtpCode(target, purpose, channel = "sms") {
  const response = await api.get("/api/admin/auth-codes").set("x-admin-token", ADMIN_TOKEN);
  expect(response.status).toBe(200);
  const record = response.body.codes.find(
    (entry) => (entry.target ?? entry.phone) === target && entry.purpose === purpose && (entry.channel ?? "sms") === channel,
  );
  expect(record).toBeTruthy();
  return record.code;
}

async function registerUser(phone, profile = {}) {
  const requestCode = await api.post("/api/auth/register/request-code").send({ phone });
  expect(requestCode.status).toBe(200);

  const code = await getOtpCode(phone, "register");
  const verify = await api.post("/api/auth/register/verify-code").send({
    phone,
    code,
    displayName: profile.displayName ?? `User ${phone.slice(-2)}`,
    username: profile.username ?? `user_${phone.slice(-4)}`,
    locale: "ru",
  });

  expect(verify.status).toBe(200);
  return verify.body;
}

async function seedSmokeData() {
  primaryUser = await registerUser("+79990000301", {
    displayName: "UI Owner",
    username: "ui_owner",
  });
  secondaryUser = await registerUser("+79990000302", {
    displayName: "UI Peer",
    username: "ui_peer",
  });
  tertiaryUser = await registerUser("+79990000303", {
    displayName: "UI Guest",
    username: "ui_guest",
  });

  const direct = await api
    .post("/api/chats")
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({
      type: "direct",
      memberUsername: "@ui_peer",
    });
  expect(direct.status).toBe(201);

  directChatId = direct.body.chat.id;

  const firstMessage = await api
    .post(`/api/chats/${directChatId}/messages`)
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({ text: "Привет из smoke UI" });
  expect(firstMessage.status).toBe(201);

  const secondMessage = await api
    .post(`/api/chats/${directChatId}/messages`)
    .set("authorization", `Bearer ${secondaryUser.token}`)
    .send({ text: "Ответ для проверки интерфейса" });
  expect(secondMessage.status).toBe(201);

  const tertiaryDirect = await api
    .post("/api/chats")
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({
      type: "direct",
      memberUsername: "@ui_guest",
    });
  expect(tertiaryDirect.status).toBe(201);

  const group = await api
    .post("/api/chats")
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({
      type: "group",
      title: "Smoke Group",
      isPublic: false,
    });
  expect(group.status).toBe(201);

  const addMember = await api
    .post(`/api/chats/${group.body.chat.id}/members`)
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({ memberUsername: "@ui_peer" });
  expect(addMember.status).toBe(201);

  const channel = await api
    .post("/api/chats")
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({
      type: "channel",
      title: "Smoke Channel",
      isPublic: false,
    });
  expect(channel.status).toBe(201);

  const addSubscriber = await api
    .post(`/api/chats/${channel.body.chat.id}/members`)
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({ memberUsername: "@ui_peer" });
  expect(addSubscriber.status).toBe(201);

  const channelPost = await api
    .post(`/api/chats/${channel.body.chat.id}/messages`)
    .set("authorization", `Bearer ${primaryUser.token}`)
    .send({ text: "Smoke channel post" });
  expect(channelPost.status).toBe(201);

  const peerStory = await api
    .post("/api/stories")
    .set("authorization", `Bearer ${secondaryUser.token}`)
    .send({
      caption: "Peer smoke story",
      privacy: "contacts",
      background: "sunset",
      expiresHours: 24,
    });
  expect(peerStory.status).toBe(201);

  const peerLiveStory = await api
    .post("/api/stories")
    .set("authorization", `Bearer ${secondaryUser.token}`)
    .send({
      caption: "Peer smoke live story",
      privacy: "contacts",
      background: "forest",
      isLive: true,
      liveCommentPrice: 3,
      expiresHours: 24,
    });
  expect(peerLiveStory.status).toBe(201);
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yooh-ui-smoke-"));
  context = await createAppContext({
    dataFile: path.join(tempDir, "db.json"),
    uploadDir: path.join(tempDir, "uploads"),
    adminPanelToken: ADMIN_TOKEN,
    jwtSecret: "ui-test-secret",
  });

  server = http.createServer(context.app);
  attachRealtime(server, context.services);
  context.setNotifier(() => {});
  const address = await listen(server);
  baseUrl = `http://127.0.0.1:${address.port}`;
  api = request(server);

  await seedSmokeData();

  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  await context?.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}, 60_000);

describe("iphone ui smoke", () => {
  it("opens main iphone flows and key buttons without runtime errors", async () => {
    const pageErrors = [];
    const contextBrowser = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 3,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
    const page = await contextBrowser.newPage();

    page.on("pageerror", (error) => {
      pageErrors.push(String(error?.message || error));
    });
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.addInitScript(({ token }) => {
      globalThis.__YOOH_ENABLE_TEST_HOOKS__ = true;
      localStorage.setItem("yooh_token", token);
      localStorage.setItem("yooh_platform", "iphone");
      localStorage.setItem("yooh_lang", "ru");
      localStorage.setItem("yooh_theme", "night");
    }, {
      token: primaryUser.token,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const swipePointer = async (locator, { dx = 0, dy = 0, startRatioX = 0.5, startRatioY = 0.5, steps = 8 } = {}) => {
      const box = await locator.boundingBox();
      expect(box).toBeTruthy();
      const startX = box.x + box.width * startRatioX;
      const startY = box.y + box.height * startRatioY;
      const endX = startX + dx;
      const endY = startY + dy;
      await locator.evaluate((node, payload) => {
        const fire = (type, x, y) => {
          node.dispatchEvent(
            new globalThis.PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              clientX: x,
              clientY: y,
            }),
          );
        };
        fire("pointerdown", payload.startX, payload.startY);
        for (let index = 1; index <= payload.steps; index += 1) {
          const progress = index / payload.steps;
          fire(
            "pointermove",
            payload.startX + (payload.endX - payload.startX) * progress,
            payload.startY + (payload.endY - payload.startY) * progress,
          );
        }
        fire("pointerup", payload.endX, payload.endY);
      }, { startX, startY, endX, endY, steps });
    };

    await page.waitForSelector("#app-view:not(.hidden)");
    await page.waitForSelector("body[data-platform='iphone']");
    await page.waitForSelector("#chat-list .chat-item");
    await page.waitForSelector("#iphone-stories-strip:not(.hidden)");

    await swipePointer(page.locator("#iphone-stories-strip"), { dy: 96, startRatioX: 0.8, startRatioY: 0.35 });
    await page.waitForFunction(() =>
      globalThis.document.getElementById("iphone-stories-strip")?.classList.contains("expanded"),
    );
    await swipePointer(page.locator("#iphone-stories-strip"), { dy: -96, startRatioX: 0.8, startRatioY: 0.7 });
    await page.waitForFunction(() =>
      !globalThis.document.getElementById("iphone-stories-strip")?.classList.contains("expanded"),
    );

    await page.click("#iphone-menu-btn");
    await page.waitForSelector("#drawer-panel:not(.hidden).drawer-menu-mode");
    await page.click(".drawer-nav-btn[data-drawer-tab='calls']");
    await page.waitForSelector("#drawer-panel.drawer-fullscreen-mode[data-drawer-tab='calls']");
    await page.click("#calls-filter-missed-btn");
    await page.click("#calls-filter-all-btn");
    await page.click("#drawer-back-btn");
    await page.waitForFunction(() => {
      const panel = globalThis.document.getElementById("drawer-panel");
      return Boolean(panel && (panel.classList.contains("hidden") || panel.classList.contains("drawer-menu-mode")));
    });
    if (await page.locator("#drawer-panel.hidden").count()) {
      await page.click("#iphone-menu-btn");
      await page.waitForSelector("#drawer-panel:not(.hidden).drawer-menu-mode");
    }
    await page.click(".drawer-nav-btn[data-drawer-tab='settings']");
    await page.waitForSelector("#drawer-panel.drawer-fullscreen-mode[data-drawer-tab='settings']");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    for (let index = 0; index < 10; index += 1) {
      await page.click("#settings-home-toolbar", { position: { x: 120, y: 18 } });
    }
    await page.waitForSelector("#settings-developer-reindex-btn");
    await page.click("#settings-developer-reindex-btn");
    await page.click("#settings-developer-reset-notifications-btn");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");

    await page.click("[data-settings-action='notifications']");
    await page.waitForSelector("#settings-detail-card:not(.hidden)");
    await page.click("#settings-notify-private-open");
    await page.waitForSelector("#settings-notification-type-enabled");
    await page.selectOption("#settings-notification-type-banner-style", "persistent");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-notification-calls-open");
    await page.click("#settings-notification-calls-open");
    await page.waitForSelector("#settings-notify-ringtone");
    await page.selectOption("#settings-notify-ringtone", "iphone-5");
    await page.waitForFunction(() => globalThis.document.getElementById("settings-notify-ringtone")?.value === "iphone-5");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-notification-calls-open");
    await page.waitForFunction(() => {
      const row = globalThis.document.getElementById("settings-notification-calls-open");
      return String(row?.textContent || "").includes("iPhone 5");
    });
    await page.waitForSelector("#settings-notification-badges-open");
    await page.click("#settings-notification-badges-open");
    await page.waitForSelector("#settings-notify-badge-mode");
    await page.selectOption("#settings-notify-badge-mode", "chats");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-notification-system-open");
    await page.click("#settings-notification-system-open");
    await page.waitForSelector("#settings-system-notify-allow");
    await page.uncheck("#settings-system-notify-badges");
    await page.check("#settings-system-notify-badges");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-notification-exceptions-open");
    await page.click("#settings-notification-exceptions-open");
    await page.waitForSelector("#settings-notification-add-exception-btn");
    await page.click("#settings-notification-add-exception-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", { label: "Smoke Group" });
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#settings-chat-notification-sound");
    await page.click("#settings-chat-notification-reset-btn");
    await page.waitForSelector("#settings-notification-add-exception-btn");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-notification-exceptions-open");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("[data-settings-action='privacy']");
    await page.waitForSelector("#privacy-open-passcode");
    await page.click("#privacy-open-passcode");
    await page.waitForSelector("#privacy-passcode-set-btn");
    await page.click("#privacy-passcode-set-btn");
    await page.waitForSelector("#dialog-input:not(.hidden)");
    await page.fill("#dialog-input", "2468");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#privacy-passcode-faceid:not([disabled])");
    await page.check("#privacy-passcode-faceid");
    await page.click("#privacy-passcode-autolock-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", "5");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#privacy-passcode-autolock-btn");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#privacy-open-passkeys");
    await page.click("#privacy-open-passkeys");
    await page.waitForSelector("#privacy-create-passkey-btn");
    await page.click("#privacy-create-passkey-btn");
    await page.waitForSelector("#dialog-input:not(.hidden)");
    await page.fill("#dialog-input", "Smoke iPhone");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector(".settings-privacy-passkey-remove");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#privacy-open-cloud-password");
    await page.click("#privacy-open-cloud-password");
    await page.waitForSelector("#privacy-cloud-password-set-btn");
    await page.click("#privacy-cloud-password-set-btn");
    await page.waitForSelector("#dialog-input:not(.hidden)");
    await page.fill("#dialog-input", "smoke-cloud-pass");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#privacy-cloud-password-hint-btn");
    await page.click("#privacy-cloud-password-hint-btn");
    await page.waitForSelector("#dialog-input:not(.hidden)");
    await page.fill("#dialog-input", "smoke hint");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#privacy-cloud-password-disable-btn");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#privacy-open-passcode");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("[data-settings-action='data-storage']");
    await page.waitForSelector("#settings-storage-clean-btn");
    await page.selectOption("#settings-storage-keep-media", "week");
    await page.waitForSelector("#settings-storage-video-quality");
    await page.selectOption("#settings-storage-video-quality", "high");
    await page.waitForSelector("#settings-storage-local-files-btn");
    await page.click("#settings-storage-local-files-btn");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.click("#dialog-cancel-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("app-dialog")?.classList.contains("hidden"));
    await page.click("#settings-storage-clean-btn");
    await page.waitForSelector("#settings-storage-clean-btn");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("[data-settings-action='stickers']");
    await page.waitForSelector("#settings-stickers-emoji-status");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("#drawer-back-btn");
    await page.waitForFunction(() => {
      const panel = globalThis.document.getElementById("drawer-panel");
      return Boolean(panel && panel.classList.contains("hidden"));
    });

    await page.waitForSelector("#iphone-stories-strip .iphone-story-btn");
    await page.click("#iphone-stories-strip .iphone-story-btn.is-self-story");
    await page.waitForSelector("#story-editor:not(.hidden)");
    await page.fill("#story-editor-caption-input", "Smoke story");
    await page.click("#story-editor-submit-btn");
    await page.waitForSelector("#story-editor-publish-step:not(.hidden)");
    await page.selectOption("#story-editor-privacy-select", "selected");
    await page.fill("#story-editor-selected-users-input", "@ui_peer");
    await page.check("#story-editor-live-toggle");
    await page.fill("#story-editor-live-price-input", "2");
    await page.click("#story-editor-submit-btn");
    await page.waitForSelector("#story-viewer:not(.hidden)");
    await page.waitForSelector("#story-viewer-live-badge:not(.hidden)");
    await page.click("#story-viewer-views-btn");
    await page.waitForSelector("#drawer-panel.drawer-fullscreen-mode[data-drawer-tab='settings']");
    await page.waitForSelector("#settings-story-viewers-filter");
    await page.click("#drawer-back-btn");
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("#drawer-back-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("drawer-panel")?.classList.contains("hidden"));

    await page.click("#iphone-compose-btn");
    await page.waitForSelector("#drawer-panel.drawer-fullscreen-mode.drawer-sheet-mode[data-drawer-tab='contacts']");
    await page.waitForSelector("#contacts-list");
    await page.click("#contacts-add-btn");
    await page.waitForSelector("#contact-create-panel:not(.hidden)");
    await page.click("#contact-create-cancel-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("contact-create-panel")?.classList.contains("hidden"));
    await page.waitForSelector("#contacts-list .contact-item");
    await page.locator("#contacts-list .contact-item:visible").first().click();
    await page.waitForSelector("body.iphone-chat-open");
    await page.waitForFunction(() => {
      const panel = globalThis.document.getElementById("drawer-panel");
      return Boolean(panel && panel.classList.contains("hidden"));
    });
    await page.click("#chat-back-btn");
    await page.waitForSelector("body:not(.iphone-chat-open)");

    await page.click("#iphone-compose-btn");
    await page.waitForSelector("#drawer-panel.drawer-fullscreen-mode.drawer-sheet-mode[data-drawer-tab='contacts']");
    await swipePointer(page.locator("#contacts-list .contact-item").first(), { dx: 120, startRatioX: 0.3, startRatioY: 0.5 });
    await page.waitForSelector("body.iphone-chat-open");
    await page.click("#chat-back-btn");
    await page.waitForSelector("body:not(.iphone-chat-open)");

    await page.locator("#chat-list .chat-item").filter({ hasText: "Smoke Group" }).first().click();
    await page.waitForSelector("body.iphone-chat-open");
    await page.click("#chat-more-btn");
    await page.waitForSelector("#entity-panel:not(.hidden)");
    await page.click("#entity-chat-notifications-open-btn");
    await page.waitForSelector("#entity-chat-notify-sound-btn");
    await page.click("#entity-chat-notify-sound-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", "smartphone");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#entity-chat-notify-mute-btn");
    await page.click("#entity-chat-notify-mute-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", "1h");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#entity-chat-notify-mute-btn");
    await page.click("#entity-panel-back-btn");
    await page.waitForSelector("#entity-chat-notifications-open-btn");
    if (await page.locator("#entity-panel-back-btn").isVisible().catch(() => false)) {
      await page.click("#entity-panel-back-btn");
    } else {
      await page.click("#entity-panel-close-btn");
    }
    await page.waitForFunction(() => globalThis.document.getElementById("entity-panel")?.classList.contains("hidden"));
    await page.click("#chat-back-btn");
    await page.waitForSelector("body:not(.iphone-chat-open)");

    await page.click("#iphone-search-shortcut-btn");
    await page.fill("#global-search-input", "ui_peer");
    await page.click("#iphone-search-voice-btn");
    await page.waitForTimeout(300);

    await page.locator("#iphone-stories-strip .iphone-story-btn:not(.is-self-story)").first().click();
    await page.waitForSelector("#story-viewer:not(.hidden)");
    await page.waitForSelector("#story-viewer-live-badge:not(.hidden)");
    await page.fill("#story-viewer-reply-input", "live comment smoke");
    await page.waitForFunction(() => {
      const input = globalThis.document.getElementById("story-viewer-reply-input");
      const submit = globalThis.document.getElementById("story-viewer-reply-send-btn");
      return (
        Boolean(input) &&
        String(input.value || "").trim() === "live comment smoke" &&
        Boolean(submit) &&
        !submit.disabled
      );
    });
    await page.click("#story-viewer-reply-send-btn");
    await page.waitForFunction(() => {
      const liveCommentExists = Array.from(globalThis.document.querySelectorAll(".story-viewer-live-comment")).some((node) =>
        String(node.textContent || "").includes("live comment smoke"),
      );
      const notificationShown = Array.from(globalThis.document.querySelectorAll(".toast, .notification, .in-app-notification"))
        .some((node) => String(node.textContent || "").includes("live comment smoke"));
      const input = globalThis.document.getElementById("story-viewer-reply-input");
      return liveCommentExists || (Boolean(input) && String(input.value || "").trim() === "") || notificationShown;
    });
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".story-viewer-live-comment")).some((node) =>
        String(node.textContent || "").includes("live comment smoke"),
      ),
    );
    await swipePointer(page.locator("#story-viewer-stage"), { dy: 140, startRatioX: 0.5, startRatioY: 0.45 });
    await page.waitForFunction(() => globalThis.document.getElementById("story-viewer")?.classList.contains("hidden"));
    await page.locator("#iphone-stories-strip .iphone-story-btn:not(.is-self-story)").nth(1).click();
    await page.waitForSelector("#story-viewer:not(.hidden)");
    await page.waitForSelector("#story-viewer-live-badge:not(.hidden)");
    await page.dblclick("#story-viewer-stage");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".story-viewer-reaction-btn")).some((node) =>
        node.classList.contains("active"),
      ),
    );
    await swipePointer(page.locator("#story-viewer-stage"), { dy: 140, startRatioX: 0.5, startRatioY: 0.45 });
    await page.waitForFunction(() => globalThis.document.getElementById("story-viewer")?.classList.contains("hidden"));
    await page.locator("#iphone-stories-strip .iphone-story-btn:not(.is-self-story)").first().click();
    await page.waitForSelector("#story-viewer:not(.hidden)");
    await page.waitForFunction(() =>
      globalThis.document.getElementById("story-viewer-live-badge")?.classList.contains("hidden"),
    );
    await page.fill("#story-viewer-reply-input", "story reply smoke");
    await page.click("#story-viewer-reply-send-btn");
    await page.waitForFunction(() => {
      const messageInput = globalThis.document.getElementById("message-input");
      return (
        Boolean(messageInput) &&
        !messageInput.classList.contains("hidden") &&
        Boolean(globalThis.document.querySelector(".message-row .message"))
      );
    });
    await page.waitForSelector(".message-row .message");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".message-body")).some((node) =>
        String(node.textContent || "").includes("story reply smoke"),
      ),
    );
    await page.locator(".message-row .message").first().dispatchEvent("dblclick");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".message-reaction-btn")).some((node) =>
        String(node.textContent || "").trim().length > 0,
      ),
    );
    await page.click(".message-reaction-btn");
    await page.waitForFunction(
      () => !Array.from(globalThis.document.querySelectorAll(".message-reaction-btn")).some((node) => node.classList.contains("active")),
    );

    await swipePointer(page.locator(".message-row").first(), { dx: 116, dy: 8, startRatioX: 0.15, startRatioY: 0.55 });
    await page.waitForSelector("#composer-reply-preview:not(.hidden)");

    await page.click(".message-row .message-time");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.click("#dialog-close-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("app-dialog")?.classList.contains("hidden"));

    await page.click("#emoji-toggle-btn");
    await page.waitForSelector("#emoji-panel:not(.hidden)");
    await page.click("#emoji-tab-stickers-btn");
    await page.waitForFunction(() => globalThis.document.querySelector("#emoji-panel-body .emoji-panel-item-sticker"));
    await page.click("#emoji-tab-gif-btn");
    await page.waitForFunction(() => globalThis.document.querySelector("#emoji-panel-body .emoji-panel-item-gif"));
    await page.click("#emoji-tab-emoji-btn");
    await page.click("#emoji-panel .emoji-btn");
    await page.waitForFunction(() => {
      const input = globalThis.document.getElementById("message-input");
      return Boolean(input && input.value.length > 0);
    });

    await page.click("#file-label");
    await page.waitForSelector("#attachment-sheet:not(.hidden)");
    await page.click("#attachment-sheet-poll-btn");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.fill("#dialog-input", "Smoke poll question");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#dialog-input:not(.hidden)");
    await page.fill("#dialog-input", "Alpha\nBeta");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", "public");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector("#dialog-select:not(.hidden)");
    await page.selectOption("#dialog-select", "single");
    await page.click("#dialog-submit-btn");
    await page.waitForSelector(".message-poll");
    await page.click(".message-poll-option");
    await page.waitForSelector(".message-poll-option.active");
    await page.click(".message-poll-action-btn");
    await page.waitForFunction(() => !globalThis.document.querySelector(".message-poll-option.active"));
    await page.click(".message-poll-option");
    await page.waitForSelector(".message-poll-option.active");
    await page.click(".message-poll-option", { button: "right" });
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.click("#dialog-close-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("app-dialog")?.classList.contains("hidden"));

    await page.click("#file-label");
    await page.waitForSelector("#attachment-sheet:not(.hidden)");
    await page.click("#attachment-sheet-location-btn");
    await page.waitForSelector(".message-location-card");

    await page.click("#file-label");
    await page.waitForSelector("#attachment-sheet:not(.hidden)");
    await page.click("#attachment-sheet-contact-btn");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.selectOption("#dialog-select", secondaryUser.user.id);
    await page.click("#dialog-submit-btn");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".message-body")).some((node) =>
        String(node.textContent || "").includes("Контакт:"),
      ),
    );

    await page.click("#chat-more-btn");
    await page.waitForSelector("#entity-panel:not(.hidden)");
    if (await page.locator("#entity-panel-back-btn").isVisible().catch(() => false)) {
      await page.click("#entity-panel-back-btn");
    } else {
      await page.click("#entity-panel-close-btn");
    }
    await page.waitForFunction(() => {
      const panel = globalThis.document.getElementById("entity-panel");
      return Boolean(panel && panel.classList.contains("hidden"));
    });

    await page.evaluate(async () => {
      const hooks = globalThis.__yoohTest;
      const groupChat = hooks?.state?.chats?.find((entry) => entry.type === "group");
      if (!groupChat) {
        throw new Error("Group chat was not seeded for call smoke.");
      }
      await hooks.openChat(groupChat.id, false);
      hooks.setConnectedCall(groupChat.id);
    });
    await page.waitForSelector("#call-panel:not(.hidden)");
    await swipePointer(page.locator("#call-card"), { dy: -140, startRatioX: 0.5, startRatioY: 0.78 });
    await page.waitForSelector("#call-extra-panel:not(.hidden)");
    await page.waitForSelector("#call-verification-strip:not(.hidden)");
    expect(await page.locator("#call-verification-emojis .call-verification-emoji").count()).toBe(4);
    await page.click("#call-keypad-btn");
    await page.waitForSelector("#call-keypad-panel:not(.hidden)");
    await page.click(".call-keypad-digit[data-digit='5']");
    await page.waitForFunction(() => globalThis.document.getElementById("call-keypad-display")?.textContent?.includes("5"));
    await page.click("#call-add-btn");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.selectOption("#dialog-select", tertiaryUser.user.id);
    await page.click("#dialog-submit-btn");
    await page.waitForFunction((expectedUserId) => {
      const hooks = globalThis.__yoohTest;
      const activeChat = hooks?.state?.chats?.find((entry) => entry.id === hooks?.state?.activeChatId);
      return Boolean(activeChat?.members?.some((member) => String(member.userId) === String(expectedUserId)));
    }, tertiaryUser.user.id);
    await page.evaluate(() => {
      globalThis.__yoohTest?.resetCall();
    });
    await page.waitForFunction(() => globalThis.document.getElementById("call-panel")?.classList.contains("hidden"));

    await page.evaluate(() => {
      const hooks = globalThis.__yoohTest;
      const directChat = hooks?.state?.chats?.find((entry) => entry.type === "direct");
      if (!directChat) {
        throw new Error("Direct chat was not seeded for incoming call smoke.");
      }
      hooks.setIncomingCall(directChat.id, "audio");
    });
    await page.waitForSelector("#call-panel:not(.hidden)");
    await page.waitForFunction(() => globalThis.document.getElementById("call-card")?.classList.contains("incoming-mode"));
    await page.click("#call-decline-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("call-panel")?.classList.contains("hidden"));

    await swipePointer(page.locator(".chat-main"), { dx: 130, dy: 12, startRatioX: 0.02, startRatioY: 0.5 });
    await page.waitForSelector("body:not(.iphone-chat-open)");

    await swipePointer(page.locator("#chat-list"), { dx: 6, dy: 110, startRatioX: 0.5, startRatioY: 0.08 });
    await page.waitForFunction(() => globalThis.document.activeElement?.id === "global-search-input");
    await page.click("#iphone-search-cancel-btn");

    await swipePointer(page.locator("#chat-list .chat-item").first(), { dx: 116, dy: 10, startRatioX: 0.25, startRatioY: 0.5 });
    await page.waitForSelector("#chat-list .chat-item .chat-item-unread:not(.hidden)");

    await page.click("#iphone-compose-btn");
    await page.waitForSelector("#drawer-panel.drawer-sheet-mode[data-drawer-tab='contacts']");
    await swipePointer(page.locator("#drawer-panel"), { dx: 8, dy: 140, startRatioX: 0.5, startRatioY: 0.18 });
    await page.waitForFunction(() => globalThis.document.getElementById("drawer-panel")?.classList.contains("hidden"));

    const regularPeerChatsBeforeSecret = await page.locator("#chat-list .chat-item:not(.chat-item-secret)").filter({ hasText: "UI Peer" }).count();
    expect(regularPeerChatsBeforeSecret).toBeGreaterThanOrEqual(1);

    await page.locator("#chat-list .chat-item").filter({ hasText: "UI Peer" }).first().click();
    await page.waitForSelector("body.iphone-chat-open");
    await page.click("#chat-more-btn");
    await page.waitForSelector("#entity-panel:not(.hidden)");
    await page.click("#entity-start-secret-chat-btn");
    await page.waitForFunction(() => globalThis.document.body.classList.contains("secret-chat-active"));

    await page.click("#chat-more-btn");
    await page.waitForSelector("#entity-secret-timer-btn");
    await page.click("#entity-secret-timer-btn");
    await page.waitForSelector("#app-dialog:not(.hidden)");
    await page.selectOption("#dialog-select", "1");
    await page.click("#dialog-submit-btn");
    if (await page.locator("#entity-panel-back-btn").isVisible().catch(() => false)) {
      await page.click("#entity-panel-back-btn");
    } else {
      await page.click("#entity-panel-close-btn");
    }
    await page.waitForFunction(() => globalThis.document.getElementById("entity-panel")?.classList.contains("hidden"));

    await page.fill("#message-input", "secret smoke expiry");
    await page.click("#send-message-btn");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".message-body")).some((node) =>
        String(node.textContent || "").includes("secret smoke expiry"),
      ),
    );
    await page.waitForFunction(
      () =>
        !Array.from(globalThis.document.querySelectorAll(".message-body")).some((node) =>
          String(node.textContent || "").includes("secret smoke expiry"),
        ),
      null,
      { timeout: 4_000 },
    );

    await swipePointer(page.locator(".chat-main"), { dx: 130, dy: 12, startRatioX: 0.02, startRatioY: 0.5 });
    await page.waitForSelector("body:not(.iphone-chat-open)");
    const regularPeerChatsAfterSecret = await page.locator("#chat-list .chat-item:not(.chat-item-secret)").filter({ hasText: "UI Peer" }).count();
    const secretPeerChatsAfterSecret = await page.locator("#chat-list .chat-item.chat-item-secret").filter({ hasText: "UI Peer" }).count();
    expect(regularPeerChatsAfterSecret).toBeGreaterThanOrEqual(1);
    expect(secretPeerChatsAfterSecret).toBeGreaterThanOrEqual(1);

    await contextBrowser.close();

    expect(pageErrors).toEqual([]);
  }, 60_000);
});

describe("desktop ui smoke", () => {
  it("opens desktop flows, settings, stories and call controls without runtime errors", async () => {
    const pageErrors = [];
    const contextBrowser = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 1,
    });
    const page = await contextBrowser.newPage();

    page.on("pageerror", (error) => {
      pageErrors.push(String(error?.message || error));
    });
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.addInitScript(({ token }) => {
      globalThis.__YOOH_ENABLE_TEST_HOOKS__ = true;
      localStorage.setItem("yooh_token", token);
      localStorage.setItem("yooh_platform", "pc");
      localStorage.setItem("yooh_lang", "ru");
      localStorage.setItem("yooh_theme", "classic");
    }, {
      token: tertiaryUser.token,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.waitForSelector("#app-view:not(.hidden)");
    await page.waitForSelector("body[data-platform='pc']");
    await page.waitForSelector("#chat-list .chat-item");
    await page.waitForSelector("#desktop-stories-panel:not(.hidden)");

    await page.click("#desktop-stories-strip .desktop-story-btn.is-self-story");
    await page.waitForSelector("#story-editor:not(.hidden)");
    await page.fill("#story-editor-caption-input", "Desktop story smoke");
    await page.click("#story-editor-submit-btn");
    await page.waitForSelector("#story-editor-publish-step:not(.hidden)");
    await page.click("#story-editor-submit-btn");
    await page.waitForSelector("#story-viewer:not(.hidden)");
    await page.click("#story-viewer-close-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("story-viewer")?.classList.contains("hidden"));

    await page.evaluate(() => {
      globalThis.document.querySelector(".drawer-nav-btn[data-drawer-tab='profile']")?.click();
    });
    await page.waitForSelector("#profile-form");
    await page.fill("#settings-about", "Desktop profile smoke");
    await page.click("#profile-form button[type='submit']");

    await page.evaluate(() => {
      globalThis.document.querySelector(".drawer-nav-btn[data-drawer-tab='contacts']")?.click();
    });
    await page.waitForSelector("#contacts-list .contact-item");

    await page.evaluate(() => {
      globalThis.document.querySelector(".drawer-nav-btn[data-drawer-tab='calls']")?.click();
    });
    await page.waitForSelector("#calls-filter-all-btn");
    await page.click("#calls-filter-missed-btn");
    await page.click("#calls-filter-all-btn");

    await page.evaluate(() => {
      globalThis.document.querySelector(".drawer-nav-btn[data-drawer-tab='settings']")?.click();
    });
    await page.waitForSelector("#settings-home-card:not(.hidden)");
    await page.click("[data-settings-action='notifications']");
    await page.waitForSelector("#settings-detail-card:not(.hidden)");
    await page.waitForSelector("#settings-notify-preview");
    await page.check("#settings-notify-preview");
    await page.check("#settings-notify-sounds");

    await page.evaluate(async () => {
      const hooks = globalThis.__yoohTest;
      const selfUserId = String(hooks?.state?.user?.id ?? "");
      const directChat = hooks?.state?.chats?.find(
        (entry) =>
          entry.type === "direct" &&
          !String(entry.id || "").startsWith("secret:") &&
          Array.isArray(entry.members) &&
          entry.members.some((member) => String(member?.userId ?? "") !== selfUserId && !member?.isBot),
      );
      if (!directChat) {
        throw new Error("Desktop smoke did not find non-bot direct chat.");
      }
      await hooks.openChat(directChat.id, false);
    });
    await page.waitForSelector("#message-input");
    await page.click("#emoji-toggle-btn");
    await page.waitForSelector("#emoji-panel:not(.hidden)");
    await page.click("#emoji-tab-stickers-btn");
    await page.waitForFunction(() => globalThis.document.querySelector("#emoji-panel-body .emoji-panel-item-sticker"));
    await page.click("#emoji-tab-gif-btn");
    await page.waitForFunction(() => globalThis.document.querySelector("#emoji-panel-body .emoji-panel-item-gif"));
    await page.click("#emoji-tab-emoji-btn");
    await page.click("#emoji-panel .emoji-btn");
    await page.fill("#message-input", " desktop smoke");
    await page.click("#send-message-btn");
    await page.waitForFunction(() =>
      Array.from(globalThis.document.querySelectorAll(".message-body")).some((node) =>
        String(node.textContent || "").includes("desktop smoke"),
      ),
    );

    await page.evaluate(async () => {
      const hooks = globalThis.__yoohTest;
      const selfUserId = String(hooks?.state?.user?.id ?? "");
      const directChat = hooks?.state?.chats?.find(
        (entry) =>
          entry.type === "direct" &&
          !String(entry.id || "").startsWith("secret:") &&
          Array.isArray(entry.members) &&
          entry.members.some((member) => String(member?.userId ?? "") !== selfUserId),
      );
      if (!directChat) {
        throw new Error("Desktop smoke did not find peer direct chat for secret chat flow.");
      }
      await hooks.openChat(directChat.id, false);
    });
    await page.waitForSelector("#active-chat-title-btn");
    await page.click("#active-chat-title-btn");
    await page.waitForSelector("#entity-panel:not(.hidden)");
    await page.evaluate(async () => {
      const hooks = globalThis.__yoohTest;
      const selfUserId = String(hooks?.state?.user?.id ?? "");
      const directChat = hooks?.state?.chats?.find(
        (entry) =>
          entry.type === "direct" &&
          !String(entry.id || "").startsWith("secret:") &&
          Array.isArray(entry.members) &&
          entry.members.some((member) => String(member?.userId ?? "") !== selfUserId),
      );
      const peer = directChat?.members?.find((member) => String(member?.userId ?? "") !== selfUserId);
      if (!peer) {
        throw new Error("Desktop smoke did not resolve direct peer for secret chat creation.");
      }
      await hooks.ensureSecretChatWithUser({
        id: peer.userId,
        userId: peer.userId,
        username: peer.username,
        displayName: peer.displayName,
        avatar: peer.avatar,
      });
    });
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll("#chat-list .chat-item.chat-item-secret").length > 0,
    );
    if (await page.locator("#entity-secret-timer-btn").count()) {
      await page.click("#entity-secret-timer-btn");
      await page.waitForSelector("#app-dialog:not(.hidden)");
      await page.selectOption("#dialog-select", "5");
      await page.click("#dialog-submit-btn");
    }
    await page.click("#entity-panel-close-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("entity-panel")?.classList.contains("hidden"));

    await page.evaluate(() => {
      const hooks = globalThis.__yoohTest;
      const directChat = hooks?.state?.chats?.find((entry) => entry.type === "direct");
      if (!directChat) {
        throw new Error("Direct chat missing for desktop call smoke.");
      }
      hooks.openChat(directChat.id, false);
      hooks.setConnectedCall(directChat.id, "video");
    });
    await page.waitForSelector("#call-panel:not(.hidden)");
    await page.click("#call-mute-btn");
    await page.click("#call-speaker-btn");
    await page.click("#call-camera-btn");
    await page.click("#call-screen-btn");
    if (await page.locator("#call-mini-btn:visible").count()) {
      await page.click("#call-mini-btn");
    }
    if (await page.locator("#call-fullscreen-btn:visible").count()) {
      await page.click("#call-fullscreen-btn");
    }
    await page.click("#call-hangup-btn");
    await page.waitForFunction(() => globalThis.document.getElementById("call-panel")?.classList.contains("hidden"));

    await contextBrowser.close();

    expect(pageErrors).toEqual([]);
  }, 60_000);
});
