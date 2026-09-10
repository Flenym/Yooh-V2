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
    locale: "en",
  });
  expect(verify.status).toBe(200);
  return verify.body;
}

async function makeGroup(token, title = "Test group") {
  const res = await api.post("/api/chats").set("authorization", `Bearer ${token}`).send({ type: "group", title });
  expect(res.status).toBe(201);
  return res.body.chat;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yooh-additions-"));
  context = await createAppContext({
    dataFile: path.join(tempDir, "db.json"),
    uploadDir: path.join(tempDir, "uploads"),
    adminPanelToken: ADMIN_TOKEN,
    jwtSecret: "test-secret",
  });
  api = request(context.app);
});

afterEach(async () => {
  await context.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("message search", () => {
  it("finds text matches newest-first and requires membership", async () => {
    const user = await registerUser("+79990001101", { username: "search_user1" });
    const chat = await makeGroup(user.token);
    const auth = (r) => r.set("authorization", `Bearer ${user.token}`);
    await auth(api.post(`/api/chats/${chat.id}/messages`)).send({ text: "hello world" });
    await auth(api.post(`/api/chats/${chat.id}/messages`)).send({ text: "something else" });

    const found = await auth(api.get(`/api/chats/${chat.id}/messages/search?q=hello`));
    expect(found.status).toBe(200);
    expect(found.body.messages).toHaveLength(1);
    expect(found.body.messages[0].text).toContain("hello");

    const short = await auth(api.get(`/api/chats/${chat.id}/messages/search?q=x`));
    expect(short.status).toBe(200);
    expect(short.body.messages).toEqual([]);

    const outsider = await registerUser("+79990001102", { username: "search_user2" });
    const denied = await api
      .get(`/api/chats/${chat.id}/messages/search?q=hello`)
      .set("authorization", `Bearer ${outsider.token}`);
    expect(denied.status).not.toBe(200);
  });
});

describe("scheduled messages", () => {
  it("hides future messages until due, then publishes them", async () => {
    const user = await registerUser("+79990001201", { username: "sched_user1" });
    const chat = await makeGroup(user.token);
    const auth = (r) => r.set("authorization", `Bearer ${user.token}`);
    const future = new Date(Date.now() + 34_000).toISOString();

    const send = await auth(api.post(`/api/chats/${chat.id}/messages`)).send({
      text: "later gator",
      scheduledAt: future,
    });
    expect(send.status).toBe(201);
    expect(send.body.message.scheduledAt).toBeTruthy();

    const history = await auth(api.get(`/api/chats/${chat.id}/messages?limit=50`));
    expect(history.body.messages.some((m) => m.id === send.body.message.id)).toBe(false);

    const pending = await auth(api.get(`/api/chats/${chat.id}/messages/scheduled`));
    expect(pending.status).toBe(200);
    expect(pending.body.messages.some((m) => m.id === send.body.message.id)).toBe(true);

    const badPast = await auth(api.post(`/api/chats/${chat.id}/messages`)).send({
      text: "nope",
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(badPast.status).toBe(400);

    const badFormat = await auth(api.post(`/api/chats/${chat.id}/messages`)).send({
      text: "nope",
      scheduledAt: "someday",
    });
    expect(badFormat.status).toBe(400);
  }, 60_000);

  it("publishes due messages via the collector", async () => {
    const user = await registerUser("+79990001202", { username: "sched_user2" });
    const chat = await makeGroup(user.token);
    const auth = (r) => r.set("authorization", `Bearer ${user.token}`);
    const future = new Date(Date.now() + 33_000).toISOString();
    const send = await auth(api.post(`/api/chats/${chat.id}/messages`)).send({
      text: "due soon",
      scheduledAt: future,
    });
    expect(send.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 36_000));
    const published = await context.services.chatService.collectDueScheduledMessages();
    expect(published.some((entry) => entry.message.id === send.body.message.id)).toBe(true);

    const history = await auth(api.get(`/api/chats/${chat.id}/messages?limit=50`));
    expect(history.body.messages.some((m) => m.id === send.body.message.id)).toBe(true);
  }, 90_000);
});

describe("contacts phones", () => {
  it("matches mutual raw phone numbers like hashes do", async () => {
    const a = await registerUser("+79990001301", { username: "contact_user_a" });
    const b = await registerUser("+79990001302", { username: "contact_user_b" });

    const first = await api
      .post("/api/me/contacts")
      .set("authorization", `Bearer ${a.token}`)
      .send({ phones: ["+79990001302"] });
    expect(first.status).toBe(200);
    expect(first.body.matches).toEqual([]);

    const second = await api
      .post("/api/me/contacts")
      .set("authorization", `Bearer ${b.token}`)
      .send({ phones: ["+79990001301"] });
    expect(second.status).toBe(200);
    expect(second.body.matches).toContain(a.user.id);
    expect(second.body.created.length).toBeGreaterThan(0);
  });
});

describe("profile birthday", () => {
  it("stores, returns and clears a birthday", async () => {
    const user = await registerUser("+79990001401", { username: "bday_user1" });
    const auth = (r) => r.set("authorization", `Bearer ${user.token}`);

    const set = await auth(api.patch("/api/me/profile")).send({ birthday: "1990-05-01" });
    expect(set.status).toBe(200);
    expect(set.body.user.birthday).toBe("1990-05-01");

    const me = await auth(api.get("/api/me"));
    expect(me.body.user.birthday).toBe("1990-05-01");

    const bad = await auth(api.patch("/api/me/profile")).send({ birthday: "not-a-date" });
    expect(bad.status).toBe(400);

    const clear = await auth(api.patch("/api/me/profile")).send({ birthday: "" });
    expect(clear.status).toBe(200);
    expect(clear.body.user.birthday).toBe("");
  });
});
