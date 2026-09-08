import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppContext } from "../src/server/app.js";

const ADMIN_TOKEN = "test-admin-token";

let tempDir;
let context;
let api;

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

async function loginUser(phone) {
  const requestCode = await api.post("/api/auth/login/request-code").send({ phone });
  expect(requestCode.status).toBe(200);

  const code = await getOtpCode(phone, "login");
  const verify = await api.post("/api/auth/login/verify-code").send({
    phone,
    code,
    locale: "ru",
  });

  expect(verify.status).toBe(200);
  return verify.body;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yooh-test-"));
  context = await createAppContext({
    dataFile: path.join(tempDir, "db.json"),
    uploadDir: path.join(tempDir, "uploads"),
    adminPanelToken: ADMIN_TOKEN,
    jwtSecret: "test-secret",
    monthLimitBytes: 1024 * 1024,
    fileLimitBytes: 512 * 1024,
    fileRetentionDays: 30,
    webrtcIceServers: [
      {
        urls: ["stun:stun.test.local:3478"],
      },
    ],
  });
  api = request(context.app);
});

afterEach(async () => {
  await context.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("web routes", () => {
  it("serves main app html and dedicated game mode html", async () => {
    const root = await api.get("/");
    expect(root.status).toBe(200);
    expect(root.text).toContain('id="app-view"');
    expect(root.text).toContain('id="game-mode-btn"');

    const game = await api.get("/game");
    expect(game.status).toBe(200);
    expect(game.text).toContain('id="game-mode-iframe"');
    expect(game.text).toContain("/playmode/");
  });

  it("serves app shell for y.ooh public links", async () => {
    const linked = await api.get("/y.ooh/test_public_room");
    expect(linked.status).toBe(200);
    expect(linked.text).toContain('id="app-view"');
  });

  it("returns app runtime version for desktop auto-refresh", async () => {
    const response = await api.get("/api/app-version");
    expect(response.status).toBe(200);
    expect(typeof response.body.runtimeId).toBe("string");
    expect(response.body.runtimeId.length).toBeGreaterThan(3);
    expect(typeof response.body.startedAt).toBe("string");
    expect(typeof response.body.startedAtMs).toBe("number");
    expect(String(response.headers["cache-control"] ?? "")).toContain("no-store");
  });
});

describe("playmode bridge", () => {
  it("blocks playmode session for users without premium", async () => {
    const user = await registerUser("+79990000990", { displayName: "No Premium", username: "nopremium_play" });

    const session = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(session.status).toBe(403);
    expect(String(session.body.error ?? "")).toContain("Plus");
  });

  it("proxies playmode API via main backend and creates synced playmode session", async () => {
    const user = await registerUser("+79990000991", { displayName: "Play User", username: "play_user" });
    const grantPremium = await api
      .post("/api/admin/users/entitlements")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: user.user.id,
        isPremium: true,
        premiumUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(grantPremium.status).toBe(200);
    expect(grantPremium.body.user.isPremium).toBe(true);

    const session = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(session.status).toBe(200);
    expect(typeof session.body.token).toBe("string");
    expect(session.body.token.length).toBeGreaterThan(20);

    const health = await api.get("/playmode-api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const bootstrap = await api
      .get("/playmode-api/bootstrap")
      .set("authorization", `Bearer ${session.body.token}`);
    expect(bootstrap.status).toBe(200);
    expect(String(bootstrap.body.user?.username || "")).toMatch(/^play_user(?:\..+)?$/);
  });

  it("syncs main username to playmode session without syncing other profile fields", async () => {
    const user = await registerUser("+79990000992", { displayName: "Sync User", username: "sync_user_main" });
    const grantPremium = await api
      .post("/api/admin/users/entitlements")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: user.user.id,
        isPremium: true,
        premiumUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(grantPremium.status).toBe(200);

    const renameMain = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${user.token}`)
      .send({
        username: "sync_user_renamed",
        displayName: "Main Display Name",
        about: "Main about",
      });
    expect(renameMain.status).toBe(200);
    expect(renameMain.body.user.username).toBe("sync_user_renamed");

    const session = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(session.status).toBe(200);

    const bootstrap = await api
      .get("/playmode-api/bootstrap")
      .set("authorization", `Bearer ${session.body.token}`);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.user?.username).toBe("sync_user_renamed");

    const setPlaymodeProfile = await api
      .patch("/playmode-api/profiles/me")
      .set("authorization", `Bearer ${session.body.token}`)
      .send({
        displayName: "Game Display Name",
      });
    expect(setPlaymodeProfile.status).toBe(200);

    const renameMainAgain = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${user.token}`)
      .send({
        displayName: "Main Display Name 2",
      });
    expect(renameMainAgain.status).toBe(200);

    const sessionAfterRename = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(sessionAfterRename.status).toBe(200);

    const bootstrapAfterRename = await api
      .get("/playmode-api/bootstrap")
      .set("authorization", `Bearer ${sessionAfterRename.body.token}`);
    expect(bootstrapAfterRename.status).toBe(200);
    expect(bootstrapAfterRename.body.user?.username).toBe("sync_user_renamed");
    expect(String(bootstrapAfterRename.body.user?.profile?.displayName || "")).toBe("Game Display Name");
  });
});

describe("auth and profile", () => {
  it("handles separate register/login flows and immutable numeric chat id", async () => {
    const firstPhone = "+79990000001";
    const first = await registerUser(firstPhone, { displayName: "Alice", username: "alice_one" });

    expect(String(first.user.chatId)).toMatch(/^\d{10}$/);

    const duplicatePhoneRequest = await api.post("/api/auth/register/request-code").send({ phone: firstPhone });
    expect(duplicatePhoneRequest.status).toBe(409);

    const secondPhone = "+79990000002";
    const secondRequest = await api.post("/api/auth/register/request-code").send({ phone: secondPhone });
    expect(secondRequest.status).toBe(200);
    const secondCode = await getOtpCode(secondPhone, "register");

    const duplicateUsernameVerify = await api.post("/api/auth/register/verify-code").send({
      phone: secondPhone,
      code: secondCode,
      displayName: "Bob",
      username: "alice_one",
      locale: "ru",
    });
    expect(duplicateUsernameVerify.status).toBe(409);
    expect(duplicateUsernameVerify.body.error).toBe("Такой юзернейм уже занят");

    const unknownLogin = await api.post("/api/auth/login/request-code").send({ phone: "+79990000099" });
    expect(unknownLogin.status).toBe(404);

    const loginSession = await loginUser(firstPhone);
    expect(loginSession.user.id).toBe(first.user.id);
    expect(loginSession.user.chatId).toBe(first.user.chatId);
  });

  it("reuses active otp code for repeated register requests", async () => {
    const phone = "+79990000015";

    const firstRequest = await api.post("/api/auth/register/request-code").send({ phone });
    expect(firstRequest.status).toBe(200);
    const firstCode = await getOtpCode(phone, "register");

    const secondRequest = await api.post("/api/auth/register/request-code").send({ phone });
    expect(secondRequest.status).toBe(200);
    const secondCode = await getOtpCode(phone, "register");

    expect(secondCode).toBe(firstCode);
  });

  it("recovers registration flow from stale store lock file", async () => {
    const staleLockPath = path.join(tempDir, "db.json.lock");
    await fs.writeFile(staleLockPath, "stale-lock", "utf8");
    const staleDate = new Date(Date.now() - 60_000);
    await fs.utimes(staleLockPath, staleDate, staleDate);

    const response = await api.post("/api/auth/register/request-code").send({ phone: "+79990000018" });
    expect(response.status).toBe(200);
  });

  it("updates profile username and settings", async () => {
    const first = await registerUser("+79990000011", { displayName: "Alpha", username: "alpha_one" });
    const second = await registerUser("+79990000012", { displayName: "Beta", username: "beta_two" });

    const currentUsernameCheck = await api
      .get("/api/me/username-availability")
      .set("authorization", `Bearer ${first.token}`)
      .query({ username: "alpha_one" });
    expect(currentUsernameCheck.status).toBe(200);
    expect(currentUsernameCheck.body.available).toBe(true);
    expect(currentUsernameCheck.body.isCurrent).toBe(true);

    const takenUsernameCheck = await api
      .get("/api/me/username-availability")
      .set("authorization", `Bearer ${first.token}`)
      .query({ username: "beta_two" });
    expect(takenUsernameCheck.status).toBe(200);
    expect(takenUsernameCheck.body.available).toBe(false);
    expect(takenUsernameCheck.body.isCurrent).toBe(false);

    const usernameTaken = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${first.token}`)
      .send({ username: "beta_two" });
    expect(usernameTaken.status).toBe(409);
    expect(usernameTaken.body.error).toBe("Такой юзернейм уже занят");

    const updateProfile = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        username: "alpha_renamed",
        displayName: "Alpha Renamed",
        about: "About alpha",
        avatar: "data:image/png;base64,AAAA",
        banner: "data:image/png;base64,BBBB",
      });
    expect(updateProfile.status).toBe(200);
    expect(updateProfile.body.user.username).toBe("alpha_renamed");
    expect(updateProfile.body.user.chatId).toBe(first.user.chatId);
    expect(updateProfile.body.user.about).toBe("About alpha");
    expect(updateProfile.body.user.avatar).toContain("data:image/png");
    expect(updateProfile.body.user.banner).toContain("data:image/png");

    const updateSettings = await api
      .patch("/api/me/settings")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        language: "en",
        notifications: {
          privateChats: false,
        },
        appearance: {
          theme: "night",
          fontSize: 18,
        },
      });
    expect(updateSettings.status).toBe(200);
    expect(updateSettings.body.settings.language).toBe("en");
    expect(updateSettings.body.settings.notifications.privateChats).toBe(false);
    expect(updateSettings.body.settings.appearance.theme).toBe("night");

    const getSettings = await api.get("/api/me/settings").set("authorization", `Bearer ${first.token}`);
    expect(getSettings.status).toBe(200);
    expect(getSettings.body.settings.appearance.fontSize).toBe(18);

    expect(second.user.username).toBe("beta_two");
  });

  it("grants yooh plus, stars and business entitlements via admin api", async () => {
    const session = await registerUser("+79990000016", { displayName: "Premium User", username: "premium_user" });

    const grant = await api
      .post("/api/admin/users/entitlements")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: session.user.username,
        isPremium: true,
        premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        starsBalance: 250,
        emojiStatus: "⭐",
        businessEnabled: true,
        business: {
          location: "Moscow",
          businessHours: "09:00-18:00",
          welcomeMessage: "Welcome to Yooh",
        },
      });
    expect(grant.status).toBe(200);
    expect(grant.body.user.isPremium).toBe(true);
    expect(grant.body.user.starsBalance).toBe(250);
    expect(grant.body.user.business.enabled).toBe(true);

    const me = await api.get("/api/me").set("authorization", `Bearer ${session.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.isPremium).toBe(true);
    expect(me.body.user.isPlus).toBe(true);
    expect(me.body.user.starsBalance).toBe(250);
    expect(me.body.user.emojiStatus).toBe("⭐");
    expect(me.body.user.business.enabled).toBe(true);
    expect(me.body.user.yoohPlusLimits.maxBioLength).toBe(140);
    expect(me.body.user.yoohPlusLimits.maxFolders).toBe(20);

    const premiumBadgeProfile = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${session.token}`)
      .send({
        premiumBadge: {
          type: "star",
          star: "✨",
          bgColor: "#33cc99",
          size: 18,
          offsetX: 2,
          offsetY: -1,
        },
      });
    expect(premiumBadgeProfile.status).toBe(200);
    expect(premiumBadgeProfile.body.user.premiumBadge.type).toBe("star");
    expect(premiumBadgeProfile.body.user.premiumBadge.star).toBe("✨");
    expect(premiumBadgeProfile.body.user.premiumBadge.bgColor).toBe("#33cc99");

    const viewer = await registerUser("+79990000888", { displayName: "Viewer", username: "premium_viewer" });
    const premiumSearch = await api
      .get("/api/users/search?q=%40premium_user")
      .set("authorization", `Bearer ${viewer.token}`);
    expect(premiumSearch.status).toBe(200);
    const publicPremium = premiumSearch.body.users.find((entry) => entry.username === "premium_user");
    expect(Boolean(publicPremium?.isPremium)).toBe(true);
    expect(publicPremium?.premiumBadge?.star).toBe("✨");
    expect(publicPremium?.premiumBadge?.bgColor).toBe("#33cc99");

    const premiumAbout = "P".repeat(120);
    const premiumProfile = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${session.token}`)
      .send({ about: premiumAbout });
    expect(premiumProfile.status).toBe(200);
    expect(premiumProfile.body.user.about).toHaveLength(120);

    const revoke = await api
      .post("/api/admin/users/entitlements")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: session.user.id,
        isPremium: false,
        premiumUntil: null,
      });
    expect(revoke.status).toBe(200);
    expect(revoke.body.user.isPremium).toBe(false);

    const freeAbout = "F".repeat(120);
    const freeProfile = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${session.token}`)
      .send({ about: freeAbout });
    expect(freeProfile.status).toBe(200);
    expect(freeProfile.body.user.about).toHaveLength(70);
  });

  it("returns webrtc config only for authenticated users", async () => {
    const first = await registerUser("+79990000013", { displayName: "Gamma", username: "gamma_three" });

    const blocked = await api.get("/api/webrtc/config");
    expect(blocked.status).toBe(401);

    const allowed = await api.get("/api/webrtc/config").set("authorization", `Bearer ${first.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.iceServers).toEqual([
      {
        urls: ["stun:stun.test.local:3478"],
      },
    ]);
  });

  it("returns call history for authenticated users", async () => {
    const first = await registerUser("+79990000014", { displayName: "Delta", username: "delta_four" });

    const blocked = await api.get("/api/calls");
    expect(blocked.status).toBe(401);

    const allowed = await api.get("/api/calls").set("authorization", `Bearer ${first.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.calls).toEqual([]);
  });

  it("supports cloud password, qr login and active sessions management", async () => {
    const first = await registerUser("+79990000019", { displayName: "Cloud User", username: "cloud_user" });

    const setCloudPassword = await api
      .post("/api/auth/cloud-password")
      .set("authorization", `Bearer ${first.token}`)
      .send({ password: "1234" });
    expect(setCloudPassword.status).toBe(200);
    expect(setCloudPassword.body.enabled).toBe(true);

    const loginRequest = await api.post("/api/auth/login/request-code").send({ phone: "+79990000019" });
    expect(loginRequest.status).toBe(200);
    const loginCode = await getOtpCode("+79990000019", "login");

    const verifyWithCloudChallenge = await api.post("/api/auth/login/verify-code").send({
      phone: "+79990000019",
      code: loginCode,
      locale: "ru",
    });
    expect(verifyWithCloudChallenge.status).toBe(200);
    expect(verifyWithCloudChallenge.body.requiresCloudPassword).toBe(true);
    expect(verifyWithCloudChallenge.body.loginTicket).toBeTruthy();

    const verifyCloudPassword = await api.post("/api/auth/login/verify-cloud-password").send({
      loginTicket: verifyWithCloudChallenge.body.loginTicket,
      password: "1234",
      locale: "ru",
    });
    expect(verifyCloudPassword.status).toBe(200);
    expect(verifyCloudPassword.body.token).toBeTruthy();

    const beforeQrSessions = await api
      .get("/api/auth/sessions")
      .set("authorization", `Bearer ${verifyCloudPassword.body.token}`);
    expect(beforeQrSessions.status).toBe(200);
    expect(beforeQrSessions.body.sessions.current).toBeTruthy();
    expect(Array.isArray(beforeQrSessions.body.sessions.others)).toBe(true);
    const beforeOthersCount = beforeQrSessions.body.sessions.others.length;

    const createQr = await api.post("/api/auth/qr/create").send({});
    expect(createQr.status).toBe(201);
    expect(createQr.body.token).toBeTruthy();
    const qrPayload = `https://yooh.local/?yooh_qr_login=${encodeURIComponent(createQr.body.token)}`;
    const qrImage = await api.get(`/api/auth/qr/image?data=${encodeURIComponent(qrPayload)}&size=380`);
    expect(qrImage.status).toBe(200);
    expect(qrImage.headers["content-type"]).toContain("image/svg+xml");
    const qrSvg = typeof qrImage.text === "string" && qrImage.text
      ? qrImage.text
      : Buffer.isBuffer(qrImage.body)
        ? qrImage.body.toString("utf8")
        : String(qrImage.body ?? "");
    expect(qrSvg).toContain("<svg");

    const linkQr = await api
      .post("/api/auth/sessions/link-device")
      .set("authorization", `Bearer ${verifyCloudPassword.body.token}`)
      .send({ token: createQr.body.token });
    expect(linkQr.status).toBe(200);
    expect(linkQr.body.linked).toBe(true);

    const qrStatus = await api.get(`/api/auth/qr/status?token=${encodeURIComponent(createQr.body.token)}`);
    expect(qrStatus.status).toBe(200);
    expect(qrStatus.body.status).toBe("authorized");
    expect(qrStatus.body.token).toBeTruthy();
    expect(qrStatus.body.user.id).toBe(first.user.id);

    const afterQrSessions = await api
      .get("/api/auth/sessions")
      .set("authorization", `Bearer ${verifyCloudPassword.body.token}`);
    expect(afterQrSessions.status).toBe(200);
    expect(afterQrSessions.body.sessions.others.length).toBeGreaterThanOrEqual(beforeOthersCount);

    const terminateOthers = await api
      .post("/api/auth/sessions/terminate-others")
      .set("authorization", `Bearer ${verifyCloudPassword.body.token}`)
      .send({});
    expect(terminateOthers.status).toBe(200);
    expect(terminateOthers.body.removed).toBeGreaterThanOrEqual(1);

    const afterTerminateSessions = await api
      .get("/api/auth/sessions")
      .set("authorization", `Bearer ${verifyCloudPassword.body.token}`);
    expect(afterTerminateSessions.status).toBe(200);
    expect(afterTerminateSessions.body.sessions.others).toEqual([]);
  });

  it("allows deleting call history entries for a participant", async () => {
    const first = await registerUser("+79990000016", { displayName: "Echo", username: "echo_five" });
    const second = await registerUser("+79990000017", { displayName: "Foxtrot", username: "fox_six" });

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        type: "direct",
        memberId: second.user.id,
      });
    expect(direct.status).toBe(201);

    await context.services.chatService.recordCallStatus({
      chatId: direct.body.chat.id,
      callerId: first.user.id,
      calleeId: second.user.id,
      status: "completed",
      durationSeconds: 12,
      mode: "audio",
    });

    const beforeDelete = await api.get("/api/calls").set("authorization", `Bearer ${first.token}`);
    expect(beforeDelete.status).toBe(200);
    expect(beforeDelete.body.calls.length).toBe(1);
    const callId = beforeDelete.body.calls[0].id;

    const deleted = await api.delete(`/api/calls/${callId}`).set("authorization", `Bearer ${first.token}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.removed).toBe(true);

    const afterDelete = await api.get("/api/calls").set("authorization", `Bearer ${first.token}`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.calls.length).toBe(0);
  });

  it("supports login by email code when login email is configured", async () => {
    const user = await registerUser("+79990000181", { displayName: "Mail User", username: "mail_user" });
    const loginEmail = "mail.user@example.com";

    const saveEmail = await api
      .patch("/api/me/settings")
      .set("authorization", `Bearer ${user.token}`)
      .send({
        privacy: {
          loginEmail,
        },
      });
    expect(saveEmail.status).toBe(200);
    expect(saveEmail.body.settings.privacy.loginEmail).toBe(loginEmail);

    const requestEmailCode = await api.post("/api/auth/login/request-code").send({ email: loginEmail });
    expect(requestEmailCode.status).toBe(200);
    expect(requestEmailCode.body.channel).toBe("email");

    const code = await getOtpCode(loginEmail, "login", "email");
    const verifyByEmail = await api.post("/api/auth/login/verify-code").send({
      email: loginEmail,
      code,
      locale: "ru",
    });
    expect(verifyByEmail.status).toBe(200);
    expect(verifyByEmail.body.token).toBeTruthy();
    expect(verifyByEmail.body.user.id).toBe(user.user.id);
  });

  it("prevents reusing the same login email across accounts", async () => {
    const first = await registerUser("+79990000191", { displayName: "Mail A", username: "mail_a" });
    const second = await registerUser("+79990000192", { displayName: "Mail B", username: "mail_b" });
    const sharedEmail = "same@example.com";

    const firstSet = await api
      .patch("/api/me/settings")
      .set("authorization", `Bearer ${first.token}`)
      .send({ privacy: { loginEmail: sharedEmail } });
    expect(firstSet.status).toBe(200);

    const secondSet = await api
      .patch("/api/me/settings")
      .set("authorization", `Bearer ${second.token}`)
      .send({ privacy: { loginEmail: sharedEmail } });
    expect(secondSet.status).toBe(409);
    expect(secondSet.body.error).toBe("Email is already linked to another account");
  });

  it("enforces privacy rules for last seen, direct messages, calls and invites", async () => {
    const owner = await registerUser("+79990000201", { displayName: "Owner Privacy", username: "owner_privacy" });
    const viewer = await registerUser("+79990000202", { displayName: "Viewer Privacy", username: "viewer_privacy" });

    const ownerProfile = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        about: "secret about",
        avatar: "data:image/png;base64,PRIVACY",
      });
    expect(ownerProfile.status).toBe(200);

    const ownerPrivacy = await api
      .patch("/api/me/settings")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        privacy: {
          rules: {
            lastSeen: {
              whoCanSee: "nobody",
              alwaysShowIds: [viewer.user.id],
            },
            messages: {
              whoCanSend: "nobody",
            },
            calls: {
              whoCanCall: "nobody",
            },
            profilePhotos: {
              whoCanSee: "nobody",
            },
            profileVisibility: {
              about: "nobody",
              invites: "nobody",
            },
          },
        },
      });
    expect(ownerPrivacy.status).toBe(200);

    const canSeeLastSeen = await context.services.authService.canViewerSeeLastSeenByUserIds(viewer.user.id, owner.user.id);
    expect(canSeeLastSeen).toBe(true);

    const canCall = await context.services.authService.canViewerCallTargetByUserIds(viewer.user.id, owner.user.id);
    expect(canCall).toBe(false);

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${viewer.token}`)
      .send({
        type: "direct",
        memberId: owner.user.id,
      });
    expect(direct.status).toBe(201);
    const directId = direct.body.chat.id;

    const deniedMessage = await api
      .post(`/api/chats/${directId}/messages`)
      .set("authorization", `Bearer ${viewer.token}`)
      .send({ text: "hidden message" });
    expect(deniedMessage.status).toBe(403);

    const viewerChats = await api.get("/api/chats").set("authorization", `Bearer ${viewer.token}`);
    expect(viewerChats.status).toBe(200);
    const viewerDirect = viewerChats.body.chats.find((entry) => entry.id === directId);
    expect(viewerDirect).toBeTruthy();
    const ownerMember = viewerDirect.members.find((entry) => entry.userId === owner.user.id);
    expect(ownerMember).toBeTruthy();
    expect(ownerMember.about).toBe("");
    expect(ownerMember.avatar).toBe("");
    expect(ownerMember.privacy?.aboutHidden).toBe(true);
    expect(ownerMember.privacy?.avatarHidden).toBe(true);

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${viewer.token}`)
      .send({
        type: "group",
        title: "Invite Privacy Group",
      });
    expect(group.status).toBe(201);

    const deniedInvite = await api
      .post(`/api/chats/${group.body.chat.id}/members`)
      .set("authorization", `Bearer ${viewer.token}`)
      .send({ memberId: owner.user.id });
    expect(deniedInvite.status).toBe(403);
  });
});

describe("system bot", () => {
  it("does not deliver login code to support chat by default", async () => {
    const phone = "+79990000201";
    const user = await registerUser(phone, { displayName: "Bot Inbox", username: "bot_inbox_user" });

    const requestLoginCode = await api.post("/api/auth/login/request-code").send({ phone });
    expect(requestLoginCode.status).toBe(200);
    expect(requestLoginCode.body.delivery).toBe("sms");
    const loginCode = await getOtpCode(phone, "login");

    const chats = await api.get("/api/chats").set("authorization", `Bearer ${user.token}`);
    expect(chats.status).toBe(200);
    const supportChat = chats.body.chats.find(
      (chat) =>
        chat.type === "direct" &&
        Array.isArray(chat.members) &&
        chat.members.some((member) => String(member.username ?? "").startsWith("yooh_support_bot")),
    );
    if (supportChat) {
      const messages = await api
        .get(`/api/chats/${supportChat.id}/messages`)
        .set("authorization", `Bearer ${user.token}`);
      expect(messages.status).toBe(200);
      const hasCodeMessage = messages.body.messages.some((entry) => String(entry.text ?? "").includes(loginCode));
      expect(hasCodeMessage).toBe(false);
    }
  });

  it("supports admin broadcast and targeted support messages", async () => {
    const first = await registerUser("+79990000211", { displayName: "First Bot", username: "first_bot_user" });
    const second = await registerUser("+79990000212", { displayName: "Second Bot", username: "second_bot_user" });

    const forbiddenEveryoneStory = await api
      .post("/api/stories")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        caption: "User global story should be blocked",
        privacy: "everyone",
        background: "sunset",
      });
    expect(forbiddenEveryoneStory.status).toBe(403);

    const stateResponse = await api.get("/api/admin/system-bot").set("x-admin-token", ADMIN_TOKEN);
    expect(stateResponse.status).toBe(200);
    expect(stateResponse.body.state?.bot?.username).toBeTruthy();

    const broadcastText = "Platform update: maintenance at 23:00 UTC";
    const broadcast = await api
      .post("/api/admin/system-bot/broadcast")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ text: broadcastText });
    expect(broadcast.status).toBe(201);
    expect(broadcast.body.delivered).toBeGreaterThanOrEqual(2);

    const storyText = "Global maintenance notice story";
    const storyBroadcast = await api
      .post("/api/admin/system-bot/stories")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ text: storyText });
    expect(storyBroadcast.status).toBe(201);
    expect(storyBroadcast.body.storyId).toBeTruthy();

    const targetedText = "Support ping for first user";
    const targeted = await api
      .post("/api/admin/system-bot/message")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: first.user.id,
        text: targetedText,
      });
    expect(targeted.status).toBe(201);
    expect(targeted.body.targetUserId).toBe(first.user.id);

    const firstChats = await api.get("/api/chats").set("authorization", `Bearer ${first.token}`);
    const secondChats = await api.get("/api/chats").set("authorization", `Bearer ${second.token}`);
    expect(firstChats.status).toBe(200);
    expect(secondChats.status).toBe(200);

    const firstSupportChat = firstChats.body.chats.find(
      (chat) =>
        chat.type === "direct" &&
        Array.isArray(chat.members) &&
        chat.members.some((member) => String(member.username ?? "").startsWith("yooh_support_bot")),
    );
    const secondSupportChat = secondChats.body.chats.find(
      (chat) =>
        chat.type === "direct" &&
        Array.isArray(chat.members) &&
        chat.members.some((member) => String(member.username ?? "").startsWith("yooh_support_bot")),
    );
    expect(firstSupportChat).toBeTruthy();
    expect(secondSupportChat).toBeTruthy();

    const firstMessages = await api
      .get(`/api/chats/${firstSupportChat.id}/messages`)
      .set("authorization", `Bearer ${first.token}`);
    const secondMessages = await api
      .get(`/api/chats/${secondSupportChat.id}/messages`)
      .set("authorization", `Bearer ${second.token}`);
    expect(firstMessages.status).toBe(200);
    expect(secondMessages.status).toBe(200);
    expect(firstMessages.body.messages.some((entry) => entry.text === broadcastText)).toBe(true);
    expect(secondMessages.body.messages.some((entry) => entry.text === broadcastText)).toBe(true);
    expect(firstMessages.body.messages.some((entry) => entry.text === targetedText)).toBe(true);

    const firstStories = await api.get("/api/stories").set("authorization", `Bearer ${first.token}`);
    const secondStories = await api.get("/api/stories").set("authorization", `Bearer ${second.token}`);
    expect(firstStories.status).toBe(200);
    expect(secondStories.status).toBe(200);
    expect(firstStories.body.peerStories.some((entry) => entry.id === storyBroadcast.body.storyId)).toBe(true);
    expect(secondStories.body.peerStories.some((entry) => entry.id === storyBroadcast.body.storyId)).toBe(true);
  });

  it("allows clearing story reaction with empty payload", async () => {
    const viewer = await registerUser("+79990000213", {
      displayName: "Story Viewer",
      username: "story_viewer_user",
    });

    const storyText = "Reaction clear smoke";
    const storyBroadcast = await api
      .post("/api/admin/system-bot/stories")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ text: storyText });
    expect(storyBroadcast.status).toBe(201);
    const storyId = String(storyBroadcast.body.storyId || "");
    expect(storyId).toBeTruthy();

    const addReaction = await api
      .post(`/api/stories/${storyId}/reaction`)
      .set("authorization", `Bearer ${viewer.token}`)
      .send({ emoji: "❤️" });
    expect(addReaction.status).toBe(200);
    expect(addReaction.body.story?.myReaction).toBe("❤️");

    const clearReaction = await api
      .post(`/api/stories/${storyId}/reaction`)
      .set("authorization", `Bearer ${viewer.token}`)
      .send({});
    expect(clearReaction.status).toBe(200);
    expect(clearReaction.body.story?.myReaction).toBe("");
  });

  it("returns only bot accounts for bot search mode", async () => {
    const user = await registerUser("+79990000221", { displayName: "Bot Search", username: "bot_search_user" });

    const botsSearch = await api
      .get("/api/users/search?q=yooh&bot=1")
      .set("authorization", `Bearer ${user.token}`);
    expect(botsSearch.status).toBe(200);
    expect(Array.isArray(botsSearch.body.users)).toBe(true);
    expect(botsSearch.body.users.some((entry) => entry.isBot === true)).toBe(true);

    const regularSearch = await api
      .get("/api/users/search?q=yooh")
      .set("authorization", `Bearer ${user.token}`);
    expect(regularSearch.status).toBe(200);
    expect(regularSearch.body.users.some((entry) => entry.isBot === true)).toBe(false);
  });
});

describe("direct, groups and channels", () => {
  it("supports direct by username and public group discovery/join", async () => {
    const first = await registerUser("+79990000021", { displayName: "Owner", username: "owner_one" });
    const second = await registerUser("+79990000022", { displayName: "Member", username: "member_two" });

    const userSearch = await api
      .get("/api/users/search?q=%40member_two")
      .set("authorization", `Bearer ${first.token}`);
    expect(userSearch.status).toBe(200);
    expect(userSearch.body.users.some((entry) => entry.username === "member_two")).toBe(true);

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        type: "direct",
        memberUsername: "@member_two",
      });
    expect(direct.status).toBe(201);

    const publicGroup = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        type: "group",
        title: "Yooh Club",
        isPublic: true,
        handle: "yooh_club",
      });
    expect(publicGroup.status).toBe(201);

    const discovery = await api
      .get("/api/chats/discovery?q=yooh")
      .set("authorization", `Bearer ${second.token}`);
    expect(discovery.status).toBe(200);
    expect(discovery.body.chats.map((entry) => entry.handle)).toContain("yooh_club");

    const discoveryByHandle = await api
      .get("/api/chats/discovery?q=%40yooh_club")
      .set("authorization", `Bearer ${second.token}`);
    expect(discoveryByHandle.status).toBe(200);
    expect(discoveryByHandle.body.chats.some((entry) => entry.handle === "yooh_club")).toBe(true);

    const joined = await api
      .post("/api/chats/join")
      .set("authorization", `Bearer ${second.token}`)
      .send({ handle: "yooh_club" });
    expect(joined.status).toBe(200);

    const secondChats = await api.get("/api/chats").set("authorization", `Bearer ${second.token}`);
    expect(secondChats.status).toBe(200);
    expect(secondChats.body.chats.some((entry) => entry.id === publicGroup.body.chat.id)).toBe(true);
  });

  it("shows groups when owner adds user by username", async () => {
    const owner = await registerUser("+79990000025", { displayName: "Owner 3", username: "owner_three" });
    const invited = await registerUser("+79990000026", { displayName: "Invited", username: "invite_me" });

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Invite Group",
        isPublic: false,
      });
    expect(group.status).toBe(201);

    const addMember = await api
      .post(`/api/chats/${group.body.chat.id}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "@invite_me" });
    expect(addMember.status).toBe(201);

    const invitedChats = await api.get("/api/chats").set("authorization", `Bearer ${invited.token}`);
    expect(invitedChats.status).toBe(200);
    expect(invitedChats.body.chats.some((entry) => entry.id === group.body.chat.id)).toBe(true);
  });

  it("allows chat management and discovery without query", async () => {
    const owner = await registerUser("+79990000023", { displayName: "Owner 2", username: "owner_two" });
    const member = await registerUser("+79990000024", { displayName: "Member 2", username: "member_four" });

    const publicGroup = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Yooh Public",
        isPublic: true,
        handle: "yooh_public",
      });
    expect(publicGroup.status).toBe(201);
    const chatId = publicGroup.body.chat.id;

    const discoveryAll = await api
      .get("/api/chats/discovery?q=")
      .set("authorization", `Bearer ${member.token}`);
    expect(discoveryAll.status).toBe(200);
    expect(discoveryAll.body.chats.some((entry) => entry.id === chatId)).toBe(true);

    const renamed = await api
      .patch(`/api/chats/${chatId}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ title: "Yooh Renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.chat.title).toBe("Yooh Renamed");

    const makePrivate = await api
      .patch(`/api/chats/${chatId}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ isPublic: false, handle: null });
    expect(makePrivate.status).toBe(200);
    expect(makePrivate.body.chat.isPublic).toBe(false);
    expect(makePrivate.body.chat.handle).toBe(null);

    const forbiddenDelete = await api
      .delete(`/api/chats/${chatId}`)
      .set("authorization", `Bearer ${member.token}`);
    expect(forbiddenDelete.status).toBe(403);

    const deleted = await api
      .delete(`/api/chats/${chatId}`)
      .set("authorization", `Bearer ${owner.token}`);
    expect(deleted.status).toBe(200);

    const ownerChats = await api.get("/api/chats").set("authorization", `Bearer ${owner.token}`);
    expect(ownerChats.status).toBe(200);
    expect(ownerChats.body.chats.some((entry) => entry.id === chatId)).toBe(false);
  });

  it("validates group titles and allows prefixed public handles only for groups", async () => {
    const owner = await registerUser("+79990000027", { displayName: "Owner 4", username: "owner_four" });
    const member = await registerUser("+79990000028", { displayName: "Member 4", username: "member_five" });

    const invalidGroup = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Bad!!!",
      });
    expect(invalidGroup.status).toBe(400);
    expect(invalidGroup.body.error).toBe("Group title contains unsupported symbols");

    const validGroup = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Команда [A] (1) -_=+/?<> 😀",
        isPublic: true,
        handle: "&team_room",
      });
    expect(validGroup.status).toBe(201);
    expect(validGroup.body.chat.handle).toBe("team_room");

    const invalidPublicChannel = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "channel",
        title: "News Feed",
        isPublic: true,
        handle: "%news_room",
      });
    expect(invalidPublicChannel.status).toBe(403);

    const joinGroupByPrefix = await api
      .post("/api/chats/join")
      .set("authorization", `Bearer ${member.token}`)
      .send({ handle: "&team_room" });
    expect(joinGroupByPrefix.status).toBe(200);

    const discoveryByChannelPrefix = await api
      .get("/api/chats/discovery?q=%25news_room")
      .set("authorization", `Bearer ${member.token}`);
    expect(discoveryByChannelPrefix.status).toBe(200);
    expect(discoveryByChannelPrefix.body.chats.some((entry) => entry.handle === "news_room")).toBe(false);
  });

  it("keeps channel comments in dedicated stream and protects posts", async () => {
    const owner = await registerUser("+79990000031", { username: "channel_owner", displayName: "Owner" });
    const member = await registerUser("+79990000032", { username: "channel_member", displayName: "Member" });

    const channel = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "channel",
        title: "News",
        memberIds: [member.user.id],
      });
    expect(channel.status).toBe(201);
    const chatId = channel.body.chat.id;

    const ownerPost = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ text: "main post" });
    expect(ownerPost.status).toBe(201);

    const memberPost = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "member post" });
    expect(memberPost.status).toBe(403);

    const comment = await api
      .post(`/api/chats/${chatId}/comments`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "comment" });
    expect(comment.status).toBe(201);

    const posts = await api.get(`/api/chats/${chatId}/messages`).set("authorization", `Bearer ${member.token}`);
    expect(posts.status).toBe(200);
    expect(posts.body.messages.map((entry) => entry.text)).toEqual(["main post"]);

    const comments = await api
      .get(`/api/chats/${chatId}/comments`)
      .set("authorization", `Bearer ${member.token}`);
    expect(comments.status).toBe(200);
    expect(comments.body.messages.map((entry) => entry.text)).toEqual(["comment"]);
  });

  it("keeps servers private and preserves channel-like stream permissions", async () => {
    const owner = await registerUser("+79990000033", { username: "server_owner", displayName: "Server Owner" });
    const member = await registerUser("+79990000034", { username: "server_member", displayName: "Server Member" });

    const invalidPublicServer = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "server",
        interfaceMode: "game",
        title: "Dev Server",
        isPublic: true,
        handle: "$dev_server_room",
      });
    expect(invalidPublicServer.status).toBe(403);

    const serverChat = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "server",
        interfaceMode: "game",
        title: "Dev Server",
        memberIds: [member.user.id],
      });
    expect(serverChat.status).toBe(201);
    expect(serverChat.body.chat.type).toBe("server");
    expect(serverChat.body.chat.handle).toBe(null);
    const chatId = serverChat.body.chat.id;

    const ownerPost = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ text: "server post" });
    expect(ownerPost.status).toBe(201);

    const memberPost = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "member post in server" });
    expect(memberPost.status).toBe(403);

    const memberComment = await api
      .post(`/api/chats/${chatId}/comments`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "server comment" });
    expect(memberComment.status).toBe(201);

    const posts = await api.get(`/api/chats/${chatId}/messages`).set("authorization", `Bearer ${member.token}`);
    expect(posts.status).toBe(200);
    expect(posts.body.messages.map((entry) => entry.text)).toEqual(["server post"]);

    const comments = await api
      .get(`/api/chats/${chatId}/comments`)
      .set("authorization", `Bearer ${member.token}`);
    expect(comments.status).toBe(200);
    expect(comments.body.messages.map((entry) => entry.text)).toEqual(["server comment"]);
  });

  it("allows creating server chats only in game mode", async () => {
    const owner = await registerUser("+79990000035", { username: "server_gate", displayName: "Server Gate" });

    const denied = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "server",
        title: "Denied Server",
      });
    expect(denied.status).toBe(403);

    const allowed = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "server",
        interfaceMode: "game",
        title: "Allowed Server",
      });
    expect(allowed.status).toBe(201);
    expect(allowed.body.chat.type).toBe("server");
  });
});

describe("moderation", () => {
  it("supports report, ban and mute flows", async () => {
    const first = await registerUser("+79990000041", { username: "mod_first", displayName: "First" });
    const second = await registerUser("+79990000042", { username: "mod_second", displayName: "Second" });

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        type: "direct",
        memberId: second.user.id,
      });
    expect(direct.status).toBe(201);
    const chatId = direct.body.chat.id;

    const secondMessage = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${second.token}`)
      .send({ text: "toxic" });
    expect(secondMessage.status).toBe(201);

    const report = await api
      .post(`/api/chats/${chatId}/messages/${secondMessage.body.message.id}/report`)
      .set("authorization", `Bearer ${first.token}`)
      .send({ reason: "abuse" });
    expect(report.status).toBe(201);

    const moderation = await api.get("/api/admin/moderation").set("x-admin-token", ADMIN_TOKEN);
    expect(moderation.status).toBe(200);
    expect(moderation.body.moderation.reports.length).toBe(1);
    const reportId = moderation.body.moderation.reports[0].id;

    const removeReport = await api.delete(`/api/admin/reports/${reportId}`).set("x-admin-token", ADMIN_TOKEN);
    expect(removeReport.status).toBe(200);
    expect(removeReport.body.removed).toBe(1);

    const moderationAfterReportDelete = await api.get("/api/admin/moderation").set("x-admin-token", ADMIN_TOKEN);
    expect(moderationAfterReportDelete.status).toBe(200);
    expect(moderationAfterReportDelete.body.moderation.reports.length).toBe(0);

    const ban = await api.post("/api/admin/bans").set("x-admin-token", ADMIN_TOKEN).send({
      userId: second.user.id,
      reason: "banned",
    });
    expect(ban.status).toBe(201);

    const bannedSend = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${second.token}`)
      .send({ text: "cannot send while banned" });
    expect(bannedSend.status).toBe(403);

    const unban = await api.delete(`/api/admin/bans/${second.user.id}`).set("x-admin-token", ADMIN_TOKEN);
    expect(unban.status).toBe(200);

    const mute = await api.post("/api/admin/mutes").set("x-admin-token", ADMIN_TOKEN).send({
      chatId,
      userId: second.user.id,
      reason: "temporary mute",
    });
    expect(mute.status).toBe(201);

    const mutedSend = await api
      .post(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${second.token}`)
      .send({ text: "cannot send while muted" });
    expect(mutedSend.status).toBe(403);

    const unmute = await api
      .delete(`/api/admin/mutes/${chatId}/${second.user.id}`)
      .set("x-admin-token", ADMIN_TOKEN);
    expect(unmute.status).toBe(200);
  });

  it("supports feedback tickets, filtering source data and feedback blocking", async () => {
    const reporter = await registerUser("+79990000044", { username: "feedback_user", displayName: "Feedback User" });

    const createFeedback = await api
      .post("/api/feedback")
      .set("authorization", `Bearer ${reporter.token}`)
      .send({
        category: "bug",
        message: "There is a rendering issue in the iPhone interface",
      });
    expect(createFeedback.status).toBe(201);
    expect(createFeedback.body.ticket.category).toBe("bug");

    const adminFeedback = await api.get("/api/admin/feedback").set("x-admin-token", ADMIN_TOKEN);
    expect(adminFeedback.status).toBe(200);
    expect(Array.isArray(adminFeedback.body.tickets)).toBe(true);
    const targetTicket = adminFeedback.body.tickets.find((entry) => entry.id === createFeedback.body.ticket.id);
    expect(targetTicket).toBeTruthy();
    expect(targetTicket.user?.username).toBe("feedback_user");

    const blockFeedback = await api
      .post("/api/admin/users/entitlements")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        target: reporter.user.id,
        feedbackBlocked: true,
      });
    expect(blockFeedback.status).toBe(200);
    expect(blockFeedback.body.user.feedbackBlocked).toBe(true);

    const blockedFeedback = await api
      .post("/api/feedback")
      .set("authorization", `Bearer ${reporter.token}`)
      .send({
        category: "wish",
        message: "This must be rejected while blocked",
      });
    expect(blockedFeedback.status).toBe(403);

    const deleteFeedback = await api
      .delete(`/api/admin/feedback/${createFeedback.body.ticket.id}`)
      .set("x-admin-token", ADMIN_TOKEN);
    expect(deleteFeedback.status).toBe(200);
    expect(deleteFeedback.body.removed).toBe(1);
  });

  it("supports chat-level mutes and bans in groups and channels", async () => {
    const owner = await registerUser("+79990000045", { username: "chat_mod_owner", displayName: "Owner" });
    const admin = await registerUser("+79990000046", { username: "chat_mod_admin", displayName: "Admin" });
    const member = await registerUser("+79990000047", { username: "chat_mod_member", displayName: "Member" });

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Moderated Group",
      });
    expect(group.status).toBe(201);
    const groupId = group.body.chat.id;

    const addAdmin = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_admin" });
    expect(addAdmin.status).toBe(201);

    const addMember = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_member" });
    expect(addMember.status).toBe(201);

    const promoteAdmin = await api
      .patch(`/api/chats/${groupId}/members/${admin.user.id}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" });
    expect(promoteAdmin.status).toBe(200);
    expect(promoteAdmin.body.member.role).toBe("admin");

    const muteMember = await api
      .post(`/api/chats/${groupId}/moderation/mutes`)
      .set("authorization", `Bearer ${admin.token}`)
      .send({
        userId: member.user.id,
        reason: "Slow down",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    expect(muteMember.status).toBe(201);

    const mutedGroupSend = await api
      .post(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "This should not be sent" });
    expect(mutedGroupSend.status).toBe(403);

    const unmuteMember = await api
      .delete(`/api/chats/${groupId}/moderation/mutes/${member.user.id}`)
      .set("authorization", `Bearer ${admin.token}`);
    expect(unmuteMember.status).toBe(200);

    const banAdmin = await api
      .post(`/api/chats/${groupId}/moderation/bans`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        userId: admin.user.id,
        reason: "Temporary removal",
      });
    expect(banAdmin.status).toBe(201);

    const bannedAdminSend = await api
      .post(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${admin.token}`)
      .send({ text: "Should fail due to chat ban" });
    expect(bannedAdminSend.status).toBe(403);

    const readdBannedAdmin = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_admin" });
    expect(readdBannedAdmin.status).toBe(403);

    const unbanAdmin = await api
      .delete(`/api/chats/${groupId}/moderation/bans/${admin.user.id}`)
      .set("authorization", `Bearer ${owner.token}`);
    expect(unbanAdmin.status).toBe(200);

    const readdAfterUnban = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_admin" });
    expect(readdAfterUnban.status).toBe(201);

    const channel = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "channel",
        title: "Moderated Channel",
      });
    expect(channel.status).toBe(201);
    const channelId = channel.body.chat.id;

    const addAdminToChannel = await api
      .post(`/api/chats/${channelId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_admin" });
    expect(addAdminToChannel.status).toBe(201);

    const addMemberToChannel = await api
      .post(`/api/chats/${channelId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_member" });
    expect(addMemberToChannel.status).toBe(201);

    const promoteChannelAdmin = await api
      .patch(`/api/chats/${channelId}/members/${admin.user.id}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" });
    expect(promoteChannelAdmin.status).toBe(200);

    const muteChannelMember = await api
      .post(`/api/chats/${channelId}/moderation/mutes`)
      .set("authorization", `Bearer ${admin.token}`)
      .send({
        userId: member.user.id,
        reason: "No comments",
      });
    expect(muteChannelMember.status).toBe(201);

    const banChannelAdmin = await api
      .post(`/api/chats/${channelId}/moderation/bans`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        userId: admin.user.id,
        reason: "Channel cleanup",
      });
    expect(banChannelAdmin.status).toBe(201);

    const readdChannelAdmin = await api
      .post(`/api/chats/${channelId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "chat_mod_admin" });
    expect(readdChannelAdmin.status).toBe(403);
  });

  it("collects client error logs and exposes them in admin panel", async () => {
    const user = await registerUser("+79990000043", { username: "error_user", displayName: "Error User" });

    const clientLog = await api
      .post("/api/client-errors")
      .set("authorization", `Bearer ${user.token}`)
      .send({
        message: "Android runtime crash",
        endpoint: "/api/auth/register/verify-code",
        statusCode: 503,
        platform: "android",
        stack: "RuntimeError: x",
      });
    expect(clientLog.status).toBe(201);
    expect(clientLog.body.logged).toBe(true);

    const logsResponse = await api.get("/api/admin/error-logs?limit=50").set("x-admin-token", ADMIN_TOKEN);
    expect(logsResponse.status).toBe(200);
    expect(Array.isArray(logsResponse.body.logs)).toBe(true);
    const targetLog = logsResponse.body.logs.find((entry) => entry.message === "Android runtime crash");
    expect(targetLog).toBeTruthy();
    expect(targetLog.user?.id).toBe(user.user.id);

    const removeLog = await api
      .delete(`/api/admin/error-logs/${targetLog.id}`)
      .set("x-admin-token", ADMIN_TOKEN);
    expect(removeLog.status).toBe(200);
    expect(removeLog.body.removed).toBe(1);
  });
});

describe("message and member management", () => {
  it("supports chat settings, roles, member removal, message edit/delete and forward", async () => {
    const owner = await registerUser("+79990000061", { username: "own_msg", displayName: "Owner Msg" });
    const member = await registerUser("+79990000062", { username: "mem_msg", displayName: "Member Msg" });
    const third = await registerUser("+79990000063", { username: "third_msg", displayName: "Third Msg" });

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Manage Group",
        description: "Before",
        settings: {
          allowMemberInvites: true,
          reactionsEnabled: true,
        },
      });
    expect(group.status).toBe(201);
    const groupId = group.body.chat.id;

    const addMember = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ memberUsername: "@mem_msg" });
    expect(addMember.status).toBe(201);

    const updateGroup = await api
      .patch(`/api/chats/${groupId}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        title: "Manage Group 2",
        description: "After",
        isPublic: true,
        handle: "&manage_group_room",
        settings: {
          allowMemberInvites: true,
          reactionsEnabled: false,
          allowedReactions: ["🔥", "👍"],
          hideParticipants: true,
          joinRequestsEnabled: true,
          restrictContentSaving: true,
          stylePreset: "green",
          wallpaperPreset: "linen-blue",
          permissions: {
            sendMessages: true,
            addMembers: true,
            pinMessages: false,
            changeChatProfile: false,
            slowModeSeconds: 30,
            media: {
              photos: true,
              videos: false,
              videoMessages: false,
              music: true,
              voiceMessages: true,
              files: true,
              stickersGifs: true,
              linkPreviews: false,
              polls: true,
            },
          },
        },
      });
    expect(updateGroup.status).toBe(200);
    expect(updateGroup.body.chat.description).toBe("After");
    expect(updateGroup.body.chat.settings.reactionsEnabled).toBe(false);
    expect(updateGroup.body.chat.handle).toBe("manage_group_room");
    expect(updateGroup.body.chat.settings.allowedReactions).toEqual(["🔥", "👍"]);
    expect(updateGroup.body.chat.settings.hideParticipants).toBe(true);
    expect(updateGroup.body.chat.settings.joinRequestsEnabled).toBe(true);
    expect(updateGroup.body.chat.settings.restrictContentSaving).toBe(true);
    expect(updateGroup.body.chat.settings.stylePreset).toBe("green");
    expect(updateGroup.body.chat.settings.wallpaperPreset).toBe("linen-blue");
    expect(updateGroup.body.chat.settings.permissions.slowModeSeconds).toBe(30);
    expect(updateGroup.body.chat.settings.permissions.media.videos).toBe(false);
    expect(updateGroup.body.chat.settings.permissions.media.linkPreviews).toBe(false);

    const send = await api
      .post(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "hello team" });
    expect(send.status).toBe(201);
    const messageId = send.body.message.id;

    const edit = await api
      .patch(`/api/chats/${groupId}/messages/${messageId}`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ text: "hello team edited" });
    expect(edit.status).toBe(200);
    expect(edit.body.message.text).toBe("hello team edited");
    expect(edit.body.message.editedAt).toBeTruthy();

    const deleteDenied = await api
      .delete(`/api/chats/${groupId}/messages/${messageId}`)
      .set("authorization", `Bearer ${third.token}`);
    expect(deleteDenied.status).toBe(403);

    const role = await api
      .patch(`/api/chats/${groupId}/members/${member.user.id}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" });
    expect(role.status).toBe(200);
    expect(role.body.member.role).toBe("admin");

    const addThirdByAdmin = await api
      .post(`/api/chats/${groupId}/members`)
      .set("authorization", `Bearer ${member.token}`)
      .send({ memberUsername: "third_msg" });
    expect(addThirdByAdmin.status).toBe(201);

    const removeThird = await api
      .delete(`/api/chats/${groupId}/members/${third.user.id}`)
      .set("authorization", `Bearer ${member.token}`);
    expect(removeThird.status).toBe(200);
    expect(removeThird.body.removed).toBe(true);

    const deleteByAdmin = await api
      .delete(`/api/chats/${groupId}/messages/${messageId}`)
      .set("authorization", `Bearer ${member.token}`);
    expect(deleteByAdmin.status).toBe(200);

    const afterDelete = await api
      .get(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${owner.token}`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.messages.some((entry) => entry.id === messageId)).toBe(false);

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "direct",
        memberId: member.user.id,
      });
    expect(direct.status).toBe(201);
    const directId = direct.body.chat.id;

    const source = await api
      .post(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ text: "forward this" });
    expect(source.status).toBe(201);

    const forward = await api
      .post(`/api/chats/${groupId}/messages/${source.body.message.id}/forward`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ targetChatId: directId });
    expect(forward.status).toBe(201);
    expect(forward.body.message.text).toBe("forward this");

    const directMessages = await api
      .get(`/api/chats/${directId}/messages`)
      .set("authorization", `Bearer ${member.token}`);
    expect(directMessages.status).toBe(200);
    expect(directMessages.body.messages.some((entry) => entry.text === "forward this")).toBe(true);

    const publicLink = await api.get("/y.ooh/manage_group_room");
    expect(publicLink.status).toBe(200);
    expect(publicLink.text).toContain('id="app-view"');
  });

  it("persists channel signatures and selected reactions settings", async () => {
    const owner = await registerUser("+79990000066", { username: "channel_settings_owner", displayName: "Channel Owner" });

    const channel = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "channel",
        title: "Settings Channel",
        description: "Channel before",
      });
    expect(channel.status).toBe(201);
    const channelId = channel.body.chat.id;

    const updated = await api
      .patch(`/api/chats/${channelId}`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        title: "Settings Channel Updated",
        description: "Channel after",
        isPublic: true,
        handle: "%settings_channel_room",
        settings: {
          commentsEnabled: true,
          signMessages: true,
          reactionsEnabled: true,
          allowedReactions: ["🔥", "❤️"],
          stylePreset: "pink",
          wallpaperPreset: "mist-violet",
        },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.chat.handle).toBe("settings_channel_room");
    expect(updated.body.chat.settings.commentsEnabled).toBe(true);
    expect(updated.body.chat.settings.signMessages).toBe(true);
    expect(updated.body.chat.settings.allowedReactions).toEqual(["🔥", "❤️"]);
    expect(updated.body.chat.settings.stylePreset).toBe("pink");
    expect(updated.body.chat.settings.wallpaperPreset).toBe("mist-violet");

    const chats = await api.get("/api/chats").set("authorization", `Bearer ${owner.token}`);
    expect(chats.status).toBe(200);
    const persisted = chats.body.chats.find((entry) => entry.id === channelId);
    expect(persisted).toBeTruthy();
    expect(persisted.settings.signMessages).toBe(true);
    expect(persisted.settings.allowedReactions).toEqual(["🔥", "❤️"]);
  });

  it("supports self-chat location delivery and poll voting flow", async () => {
    const owner = await registerUser("+79990000064", { username: "self_loc_owner", displayName: "Owner Self" });
    const member = await registerUser("+79990000065", { username: "poll_member", displayName: "Poll Member" });

    const saved = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "direct",
        memberId: owner.user.id,
      });
    expect(saved.status).toBe(201);
    const savedChatId = saved.body.chat.id;

    const sendLocation = await api
      .post(`/api/chats/${savedChatId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        kind: "location",
        text: "Геопозиция",
        clientMessageId: "test-location-self-0001",
        location: {
          lat: 55.751244,
          lng: 37.618423,
          title: "Москва",
          address: "Россия",
          mapUrl: "https://www.openstreetmap.org/?mlat=55.751244&mlon=37.618423#map=15/55.751244/37.618423",
        },
      });
    expect(sendLocation.status).toBe(201);
    expect(sendLocation.body.message.type).toBe("location");
    expect(sendLocation.body.message.location?.title).toBe("Москва");

    const sendText = await api
      .post(`/api/chats/${savedChatId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ text: "self chat text message" });
    expect(sendText.status).toBe(201);
    expect(sendText.body.message.type).toBe("text");

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Poll Group",
        memberIds: [member.user.id],
      });
    expect(group.status).toBe(201);
    const groupId = group.body.chat.id;

    const pollMessage = await api
      .post(`/api/chats/${groupId}/messages`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        kind: "poll",
        text: "Опрос",
        clientMessageId: "test-poll-group-0001",
        poll: {
          question: "Лучший мессенджер?",
          options: ["Yooh", "Другой"],
          anonymous: false,
          multiple: false,
          quiz: false,
        },
      });
    expect(pollMessage.status).toBe(201);
    expect(pollMessage.body.message.type).toBe("poll");
    const pollId = pollMessage.body.message.id;
    const firstOptionId = pollMessage.body.message.poll?.options?.[0]?.id;
    expect(firstOptionId).toBeTruthy();

    const vote = await api
      .post(`/api/chats/${groupId}/messages/${pollId}/poll-vote`)
      .set("authorization", `Bearer ${member.token}`)
      .send({
        optionIds: [firstOptionId],
      });
    expect(vote.status).toBe(200);
    expect(vote.body.message.poll?.totalVotes).toBe(1);
    const votedOption = vote.body.message.poll?.options?.find((entry) => entry.id === firstOptionId);
    expect(votedOption?.count).toBe(1);
    expect(votedOption?.mine).toBe(true);
  });
});

describe("file messages", () => {
  it("returns inline image endpoint and allows token query auth for file access", async () => {
    const first = await registerUser("+79990000051", { username: "file_sender", displayName: "Sender" });
    const second = await registerUser("+79990000052", { username: "file_receiver", displayName: "Receiver" });

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${first.token}`)
      .send({
        type: "direct",
        memberId: second.user.id,
      });
    expect(direct.status).toBe(201);
    const chatId = direct.body.chat.id;

    const upload = await api
      .post(`/api/chats/${chatId}/files`)
      .set("authorization", `Bearer ${first.token}`)
      .field("text", "Vacation")
      .field("stream", "main")
      .attach("file", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        filename: "photo.png",
        contentType: "image/png",
      });
    expect(upload.status).toBe(201);
    expect(upload.body.message.type).toBe("file");
    expect(upload.body.message.file.mimeType).toBe("image/png");

    const fileId = upload.body.message.file.id;
    expect(fileId).toBeTruthy();

    const list = await api
      .get(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${second.token}`);
    expect(list.status).toBe(200);
    expect(list.body.messages.some((entry) => entry.file?.id === fileId)).toBe(true);

    const blockedInline = await api.get(`/api/files/${fileId}/inline`);
    expect(blockedInline.status).toBe(401);

    const inline = await api.get(`/api/files/${fileId}/inline?token=${encodeURIComponent(second.token)}`);
    expect(inline.status).toBe(200);
    expect(inline.headers["content-type"]).toContain("image/png");

    const download = await api.get(`/api/files/${fileId}/download?token=${encodeURIComponent(second.token)}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
  });

  it("keeps utf-8 filenames readable and serves inline/download on mobile-safe headers", async () => {
    const sender = await registerUser("+79990000053", { username: "file_utf_sender", displayName: "Sender UTF" });
    const receiver = await registerUser("+79990000054", { username: "file_utf_receiver", displayName: "Receiver UTF" });

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${sender.token}`)
      .send({
        type: "direct",
        memberId: receiver.user.id,
      });
    expect(direct.status).toBe(201);
    const chatId = direct.body.chat.id;

    const fileName = "Пример файла 2026.txt";
    const upload = await api
      .post(`/api/chats/${chatId}/files`)
      .set("authorization", `Bearer ${sender.token}`)
      .field("stream", "main")
      .attach("file", Buffer.from("yooh-utf8-test"), {
        filename: fileName,
        contentType: "text/plain; charset=utf-8",
      });
    expect(upload.status).toBe(201);
    expect(upload.body.message.file.originalName).toBe(fileName);

    const fileId = upload.body.message.file.id;
    expect(fileId).toBeTruthy();

    const list = await api
      .get(`/api/chats/${chatId}/messages`)
      .set("authorization", `Bearer ${receiver.token}`);
    expect(list.status).toBe(200);
    const listedFile = list.body.messages.find((entry) => entry.file?.id === fileId)?.file;
    expect(listedFile?.originalName).toBe(fileName);

    const inline = await api.get(`/api/files/${fileId}/inline?token=${encodeURIComponent(receiver.token)}`);
    expect(inline.status).toBe(200);
    expect(inline.headers["content-type"]).toContain("text/plain");
    expect(inline.headers["content-disposition"]).toContain("inline");
    expect(inline.headers["content-disposition"]).toContain("filename*=");

    const download = await api.get(`/api/files/${fileId}/download?token=${encodeURIComponent(receiver.token)}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["content-disposition"]).toContain("filename*=");
    expect(download.headers["content-disposition"]).toContain(encodeURIComponent(fileName));
  });
});
