import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppContext } from "../src/server/app.js";

const ADMIN_TOKEN = "test-admin-token";

const STRESS_USERS = Math.max(12, Number.parseInt(process.env.YOOH_STRESS_USERS ?? "18", 10) || 18);
const STRESS_MESSAGES = Math.max(80, Number.parseInt(process.env.YOOH_STRESS_MESSAGES ?? "180", 10) || 180);
const PLAYMODE_USERS = Math.max(6, Number.parseInt(process.env.YOOH_STRESS_PLAYMODE_USERS ?? "10", 10) || 10);
const QR_BURST = Math.max(4, Number.parseInt(process.env.YOOH_STRESS_QR_BURST ?? "8", 10) || 8);
const BATCH_SIZE = Math.max(4, Number.parseInt(process.env.YOOH_STRESS_BATCH ?? "20", 10) || 20);

let tempDir;
let context;
let api;

function makePhone(index, offset = 0) {
  const value = String(index + offset).padStart(6, "0");
  return `+79999${value}`;
}

function makeUsername(prefix, index) {
  return `${prefix}_${index.toString(36)}`.slice(0, 32);
}

async function getOtpCode(target, purpose, channel = "sms") {
  const response = await api.get("/api/admin/auth-codes").set("x-admin-token", ADMIN_TOKEN);
  expect(response.status).toBe(200);
  const code = response.body.codes.find(
    (entry) => (entry.target ?? entry.phone) === target && entry.purpose === purpose && (entry.channel ?? "sms") === channel,
  );
  expect(code).toBeTruthy();
  return code.code;
}

async function registerUser(phone, profile = {}) {
  const requestCode = await api.post("/api/auth/register/request-code").send({ phone });
  expect(requestCode.status).toBe(200);

  const code = await getOtpCode(phone, "register");
  const verify = await api.post("/api/auth/register/verify-code").send({
    phone,
    code,
    displayName: profile.displayName ?? `User ${phone.slice(-4)}`,
    username: profile.username ?? `user_${phone.slice(-4)}`,
    locale: "ru",
  });
  expect(verify.status).toBe(200);
  return verify.body;
}

async function grantPremium(target) {
  const response = await api
    .post("/api/admin/users/entitlements")
    .set("x-admin-token", ADMIN_TOKEN)
    .send({
      target,
      isPremium: true,
      premiumUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  expect(response.status).toBe(200);
  expect(response.body.user?.isPremium).toBe(true);
}

async function runInBatches(items, batchSize, handler) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const slice = items.slice(index, index + batchSize);
    const chunk = await Promise.all(slice.map((item) => handler(item)));
    results.push(...chunk);
  }
  return results;
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yooh-stress-"));
  context = await createAppContext({
    dataFile: path.join(tempDir, "db.json"),
    uploadDir: path.join(tempDir, "uploads"),
    adminPanelToken: ADMIN_TOKEN,
    jwtSecret: "stress-test-secret",
    monthLimitBytes: 1024 * 1024 * 10,
    fileLimitBytes: 1024 * 1024,
    fileRetentionDays: 30,
    webrtcIceServers: [{ urls: ["stun:stun.test.local:3478"] }],
  });
  api = request(context.app);
});

afterAll(async () => {
  await context.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe.sequential("stress and resilience", () => {
  it("keeps playmode profile independent from main profile", async () => {
    const user = await registerUser(makePhone(1, 7000), {
      displayName: "Main Stress",
      username: "stress_bridge",
    });
    await grantPremium(user.user.id);

    const sessionA = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(sessionA.status).toBe(200);
    const playmodeTokenA = String(sessionA.body.token || "").trim();
    expect(playmodeTokenA.length).toBeGreaterThan(20);

    const patchPlaymode = await api
      .patch("/playmode-api/profiles/me")
      .set("authorization", `Bearer ${playmodeTokenA}`)
      .send({
        displayName: "Game Nick",
        bio: "Game bio",
        statusText: "In game",
        avatarUrl: "data:image/png;base64,PLAYMODE",
        bannerUrl: "data:image/png;base64,BANNER",
      });
    expect(patchPlaymode.status).toBe(200);

    const mainBefore = await api
      .get("/api/me")
      .set("authorization", `Bearer ${user.token}`);
    expect(mainBefore.status).toBe(200);
    expect(mainBefore.body.user.displayName).toBe("Main Stress");
    expect(mainBefore.body.user.about).toBe("");
    expect(mainBefore.body.user.avatar).toBe("");

    const patchMain = await api
      .patch("/api/me/profile")
      .set("authorization", `Bearer ${user.token}`)
      .send({
        displayName: "Main Updated",
        about: "Main about",
        avatar: "data:image/png;base64,MAIN",
      });
    expect(patchMain.status).toBe(200);

    const sessionB = await api
      .post("/api/playmode/session")
      .set("authorization", `Bearer ${user.token}`)
      .send({});
    expect(sessionB.status).toBe(200);

    const bootstrapB = await api
      .get("/playmode-api/bootstrap")
      .set("authorization", `Bearer ${sessionB.body.token}`);
    expect(bootstrapB.status).toBe(200);
    expect(String(bootstrapB.body.user?.username || "")).toMatch(/^stress_bridge(?:\..+)?$/);
    expect(bootstrapB.body.user?.profile?.displayName).toBe("Game Nick");
    expect(bootstrapB.body.user?.profile?.bio).toBe("Game bio");
    expect(bootstrapB.body.user?.profile?.avatarUrl).toContain("data:image/png");
  });

  it("handles concurrent playmode session bootstrap for many accounts", async () => {
    const users = [];
    for (let index = 0; index < PLAYMODE_USERS; index += 1) {
      users.push(
        await registerUser(makePhone(index, 7100), {
          displayName: `Playmode ${index}`,
          username: makeUsername("pmuser", index),
        }),
      );
    }
    for (const user of users) {
      await grantPremium(user.user.id);
    }

    const sessions = await runInBatches(users, BATCH_SIZE, async (entry) =>
      api
        .post("/api/playmode/session")
        .set("authorization", `Bearer ${entry.token}`)
        .send({}),
    );

    expect(sessions.every((response) => response.status === 200)).toBe(true);

    const tokens = sessions.map((response) => String(response.body.token || "").trim()).filter(Boolean);
    expect(tokens.length).toBe(PLAYMODE_USERS);
    expect(new Set(tokens).size).toBe(PLAYMODE_USERS);

    const bootstraps = await runInBatches(tokens, BATCH_SIZE, async (token) =>
      api
        .get("/playmode-api/bootstrap")
        .set("authorization", `Bearer ${token}`),
    );

    expect(bootstraps.every((response) => response.status === 200)).toBe(true);
    expect(bootstraps.every((response) => typeof response.body.user?.id === "string")).toBe(true);

    const health = await api.get("/api/playmode/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });

  it("sustains high-volume messaging and settings updates", async () => {
    const users = [];
    for (let index = 0; index < STRESS_USERS; index += 1) {
      users.push(
        await registerUser(makePhone(index, 7200), {
          displayName: `Stress ${index}`,
          username: makeUsername("stress", index),
        }),
      );
    }

    const owner = users[0];
    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Stress Group",
      });
    expect(group.status).toBe(201);
    const chatId = group.body.chat.id;

    const addMemberResponses = await runInBatches(users.slice(1), BATCH_SIZE, async (entry) =>
      api
        .post(`/api/chats/${chatId}/members`)
        .set("authorization", `Bearer ${owner.token}`)
        .send({ memberUsername: `@${entry.user.username}` }),
    );
    expect(addMemberResponses.every((response) => response.status === 201)).toBe(true);

    const participants = users.slice(0, Math.min(users.length, 12));
    const messageIndices = Array.from({ length: STRESS_MESSAGES }, (_, index) => index);
    const messageResponses = await runInBatches(messageIndices, BATCH_SIZE, async (index) => {
      const sender = participants[index % participants.length];
      return api
        .post(`/api/chats/${chatId}/messages`)
        .set("authorization", `Bearer ${sender.token}`)
        .send({ text: `stress-message-${index}` });
    });
    expect(messageResponses.every((response) => response.status === 201)).toBe(true);

    const channel = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "channel",
        title: "Stress Channel",
        memberIds: users.slice(1).map((entry) => entry.user.id),
      });
    expect(channel.status).toBe(201);
    const channelId = channel.body.chat.id;

    const commentIndices = Array.from({ length: Math.floor(STRESS_MESSAGES / 2) }, (_, index) => index);
    const commentResponses = await runInBatches(commentIndices, BATCH_SIZE, async (index) => {
      const sender = participants[(index + 1) % participants.length];
      return api
        .post(`/api/chats/${channelId}/comments`)
        .set("authorization", `Bearer ${sender.token}`)
        .send({ text: `stress-comment-${index}` });
    });
    expect(commentResponses.every((response) => response.status === 201)).toBe(true);

    const expectedMessages = Math.min(STRESS_MESSAGES, 200);
    const messages = await api
      .get(`/api/chats/${chatId}/messages`)
      .query({ limit: 200 })
      .set("authorization", `Bearer ${owner.token}`);
    expect(messages.status).toBe(200);
    expect(messages.body.messages.length).toBeGreaterThanOrEqual(expectedMessages);

    const expectedComments = Math.min(Math.floor(STRESS_MESSAGES / 2), 200);
    const comments = await api
      .get(`/api/chats/${channelId}/comments`)
      .query({ limit: 200 })
      .set("authorization", `Bearer ${owner.token}`);
    expect(comments.status).toBe(200);
    expect(comments.body.messages.length).toBeGreaterThanOrEqual(expectedComments);

    const settingsOps = Array.from({ length: STRESS_USERS * 3 }, (_, index) => index);
    const settingsResponses = await runInBatches(settingsOps, BATCH_SIZE, async (index) => {
      const target = users[index % users.length];
      return api
        .patch("/api/me/settings")
        .set("authorization", `Bearer ${target.token}`)
        .send({
          language: index % 2 === 0 ? "ru" : "en",
          notifications: { privateChats: index % 3 !== 0 },
          appearance: {
            theme: index % 3 === 0 ? "night" : "classic",
            fontSize: 14 + (index % 8),
          },
        });
    });
    expect(settingsResponses.every((response) => response.status === 200)).toBe(true);

    const callsChecks = await runInBatches(users.slice(0, 6), 6, async (entry) =>
      api
        .get("/api/calls")
        .set("authorization", `Bearer ${entry.token}`),
    );
    expect(callsChecks.every((response) => response.status === 200)).toBe(true);
  });

  it("handles auth + QR burst without losing session consistency", async () => {
    const user = await registerUser(makePhone(1, 7300), {
      displayName: "QR Burst",
      username: "qr_burst_user",
    });

    const setCloudPassword = await api
      .post("/api/auth/cloud-password")
      .set("authorization", `Bearer ${user.token}`)
      .send({ password: "1234" });
    expect(setCloudPassword.status).toBe(200);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loginRequest = await api.post("/api/auth/login/request-code").send({ phone: makePhone(1, 7300) });
      expect(loginRequest.status).toBe(200);

      const loginCode = await getOtpCode(makePhone(1, 7300), "login");
      const verifyCode = await api.post("/api/auth/login/verify-code").send({
        phone: makePhone(1, 7300),
        code: loginCode,
        locale: "ru",
      });
      expect(verifyCode.status).toBe(200);
      expect(verifyCode.body.requiresCloudPassword).toBe(true);

      const verifyCloud = await api.post("/api/auth/login/verify-cloud-password").send({
        loginTicket: verifyCode.body.loginTicket,
        password: "1234",
        locale: "ru",
      });
      expect(verifyCloud.status).toBe(200);
      expect(typeof verifyCloud.body.token).toBe("string");
    }

    const qrTokens = [];
    for (let index = 0; index < QR_BURST; index += 1) {
      const createQr = await api.post("/api/auth/qr/create").send({});
      expect(createQr.status).toBe(201);
      qrTokens.push(createQr.body.token);
    }

    const linkResponses = await runInBatches(qrTokens, BATCH_SIZE, async (token) =>
      api
        .post("/api/auth/sessions/link-device")
        .set("authorization", `Bearer ${user.token}`)
        .send({ token }),
    );
    expect(linkResponses.every((response) => response.status === 200)).toBe(true);

    const statusResponses = await runInBatches(qrTokens, BATCH_SIZE, async (token) =>
      api.get(`/api/auth/qr/status?token=${encodeURIComponent(token)}`),
    );
    expect(statusResponses.every((response) => response.status === 200)).toBe(true);
    expect(statusResponses.every((response) => response.body.status === "authorized")).toBe(true);

    const sessions = await api
      .get("/api/auth/sessions")
      .set("authorization", `Bearer ${user.token}`);
    expect(sessions.status).toBe(200);
    expect(Array.isArray(sessions.body.sessions?.others)).toBe(true);
    expect(sessions.body.sessions.others.length).toBeGreaterThanOrEqual(1);
  });

  it("sustains concurrent call log creation for direct, group and server chats", async () => {
    const CALL_USERS = Math.max(8, Math.min(STRESS_USERS, 14));
    const users = [];
    for (let index = 0; index < CALL_USERS; index += 1) {
      users.push(
        await registerUser(makePhone(index, 7400), {
          displayName: `Call ${index}`,
          username: makeUsername("callstress", index),
        }),
      );
    }

    const owner = users[0];
    const peer = users[1];

    const direct = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "direct",
        memberId: peer.user.id,
      });
    expect(direct.status).toBe(201);

    const group = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "group",
        title: "Stress Calls Group",
      });
    expect(group.status).toBe(201);

    const serverChat = await api
      .post("/api/chats")
      .set("authorization", `Bearer ${owner.token}`)
      .send({
        type: "server",
        interfaceMode: "game",
        title: "Stress Calls Server",
      });
    expect(serverChat.status).toBe(201);

    const sharedMembers = users.slice(1);
    const memberAdds = [];
    for (const entry of sharedMembers) {
      memberAdds.push(
        api
          .post(`/api/chats/${group.body.chat.id}/members`)
          .set("authorization", `Bearer ${owner.token}`)
          .send({ memberUsername: `@${entry.user.username}` }),
      );
      memberAdds.push(
        api
          .post(`/api/chats/${serverChat.body.chat.id}/members`)
          .set("authorization", `Bearer ${owner.token}`)
          .send({ memberUsername: `@${entry.user.username}` }),
      );
    }
    const addResponses = await Promise.all(memberAdds);
    expect(addResponses.every((response) => response.status === 201)).toBe(true);

    const statuses = ["completed", "busy", "no_answer", "canceled"];
    const modes = ["audio", "video"];
    const callPayloads = [];

    for (let index = 0; index < 12; index += 1) {
      callPayloads.push({
        chatId: direct.body.chat.id,
        callerId: owner.user.id,
        calleeId: peer.user.id,
        status: statuses[index % statuses.length],
        mode: modes[index % modes.length],
        durationSeconds: index % 2 === 0 ? 45 + index : 0,
      });
    }

    for (let index = 0; index < sharedMembers.length; index += 1) {
      const entry = sharedMembers[index];
      callPayloads.push({
        chatId: group.body.chat.id,
        callerId: owner.user.id,
        calleeId: entry.user.id,
        status: statuses[index % statuses.length],
        mode: modes[index % modes.length],
        durationSeconds: 20 + index,
      });
      callPayloads.push({
        chatId: serverChat.body.chat.id,
        callerId: entry.user.id,
        calleeId: owner.user.id,
        status: statuses[(index + 1) % statuses.length],
        mode: modes[(index + 1) % modes.length],
        durationSeconds: 15 + index,
      });
    }

    const callResults = await runInBatches(callPayloads, BATCH_SIZE, async (payload) =>
      context.services.chatService.recordCallStatus(payload),
    );
    expect(callResults).toHaveLength(callPayloads.length);
    expect(callResults.every((entry) => entry.callLog && entry.message)).toBe(true);

    const ownerCalls = await api.get("/api/calls?limit=500").set("authorization", `Bearer ${owner.token}`);
    expect(ownerCalls.status).toBe(200);
    expect(ownerCalls.body.calls.length).toBeGreaterThanOrEqual(callPayloads.length);
    expect(ownerCalls.body.calls.some((entry) => entry.mode === "audio")).toBe(true);
    expect(ownerCalls.body.calls.some((entry) => entry.mode === "video")).toBe(true);
    expect(ownerCalls.body.calls.some((entry) => entry.status === "completed")).toBe(true);
    expect(ownerCalls.body.calls.some((entry) => entry.status === "busy")).toBe(true);

    const peerChecks = await runInBatches(users.slice(0, 6), 6, async (entry) =>
      api.get("/api/calls?limit=200").set("authorization", `Bearer ${entry.token}`),
    );
    expect(peerChecks.every((response) => response.status === 200)).toBe(true);

    const removableIds = ownerCalls.body.calls.slice(0, 8).map((entry) => entry.id).filter(Boolean);
    const deleteResults = await runInBatches(removableIds, BATCH_SIZE, async (callId) =>
      api.delete(`/api/calls/${callId}`).set("authorization", `Bearer ${owner.token}`),
    );
    expect(deleteResults.every((response) => response.status === 200)).toBe(true);
  });
});
