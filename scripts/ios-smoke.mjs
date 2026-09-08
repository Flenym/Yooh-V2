#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the iOS client contract.
 * Talks to a RUNNING Yooh backend (start.bat) using only Node builtins.
 *
 *   BASE=http://127.0.0.1:1111 ADMIN_TOKEN=yooh-admin-local node scripts/ios-smoke.mjs
 *
 * Covers exactly what Yooh iOS uses: health, OTP register/login, /me,
 * chats CRUD, messages (send/list/edit/react/poll/forward/delete) and the
 * raw Engine.IO realtime channel (handshake, auth, join, typing, read ack,
 * live chat:message push) — no socket.io-client dependency needed.
 */
const BASE = (process.env.BASE ?? "http://127.0.0.1:1111").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "yooh-admin-local";
const PHONE = process.env.SMOKE_PHONE ?? "+79990001111";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function api(method, path, { token, body, admin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers["x-admin-token"] = ADMIN_TOKEN;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** Split an Engine.IO polling body into raw packets.
 *  engine.io-parser v6 joins packets with ASCII RS (\x1e); the handshake
 *  is a single bare packet. (Length-prefix framing was protocol v3.) */
function splitPackets(text) {
  if (!text) return [];
  return text.split("").filter((p) => p.length > 0);
}

async function eioPost(sid, packet) {
  const res = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: packet,
  });
  const text = await res.text();
  return { status: res.status, packets: splitPackets(text) };
}

async function eioPoll(sid) {
  const res = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${sid}`);
  const text = await res.text();
  return { status: res.status, packets: splitPackets(text) };
}

async function main() {
  console.log(`BASE=${BASE}`);

  console.log("[1] health");
  {
    const res = await fetch(`${BASE}/health`);
    const json = await res.json().catch(() => null);
    check("GET /health 200 + service=yooh", res.status === 200 && json?.service === "yooh");
  }

  console.log("[2] auth (register-or-login via admin-visible OTP)");
  let token;
  {
    let r = await api("POST", "/api/auth/register/request-code", { body: { phone: PHONE } });
    let purpose = "register";
    if (r.status === 409) {
      r = await api("POST", "/api/auth/login/request-code", { body: { phone: PHONE } });
      purpose = "login";
    }
    check("request-code 200", r.status === 200, JSON.stringify(r.json)?.slice(0, 160));
    const codes = await api("GET", "/api/admin/auth-codes", { admin: true });
    const rec = codes.json?.codes?.find((e) => (e.target ?? e.phone) === PHONE && e.purpose === purpose);
    check("OTP visible via admin API (dev flow)", !!rec?.code);
    const v = purpose === "register"
      ? await api("POST", "/api/auth/register/verify-code", {
          body: { phone: PHONE, code: rec.code, displayName: "iOS Smoke", username: "ios_smoke01", locale: "en" },
        })
      : await api("POST", "/api/auth/login/verify-code", { body: { phone: PHONE, code: rec.code, locale: "en" } });
    check("verify-code 200 + token", v.status === 200 && !!v.json?.token, `status=${v.status}`);
    token = v.json?.token;
  }
  if (!token) { console.log("auth failed, aborting"); process.exit(1); }

  console.log("[3] me + chats");
  {
    const me = await api("GET", "/api/me", { token });
    check("GET /api/me", me.status === 200 && !!me.json?.user?.id, `status=${me.status}`);
    var myId = me.json?.user?.id;
    const chats = await api("GET", "/api/chats", { token });
    check("GET /api/chats", chats.status === 200 && Array.isArray(chats.json?.chats), `status=${chats.status}`);
  }

  console.log("[4] messages lifecycle");
  var chatId, msgId;
  {
    const c = await api("POST", "/api/chats", { token, body: { type: "group", title: "ios smoke" } });
    check("create group 201", c.status === 201 && !!c.json?.chat?.id, `status=${c.status}`);
    chatId = c.json?.chat?.id;
    const s = await api("POST", `/api/chats/${chatId}/messages`, {
      token, body: { text: "ios smoke hello", clientMessageId: `ios-${Date.now()}` },
    });
    check("send text 201", s.status === 201 && s.json?.message?.text === "ios smoke hello", `status=${s.status}`);
    msgId = s.json?.message?.id;
    const list = await api("GET", `/api/chats/${chatId}/messages?limit=50`, { token });
    check("history contains message", list.status === 200 && list.json?.messages?.some((m) => m.id === msgId));
    const e = await api("PATCH", `/api/chats/${chatId}/messages/${msgId}`, { token, body: { text: "ios smoke edited" } });
    check("edit 200", e.status === 200 && e.json?.message?.text === "ios smoke edited", `status=${e.status}`);
    const r = await api("POST", `/api/chats/${chatId}/messages/${msgId}/reactions`, { token, body: { emoji: "❤️" } });
    check("reaction 200", r.status === 200 && r.json?.message?.reactions?.some((x) => x.emoji === "❤️"), `status=${r.status}`);
    const p = await api("POST", `/api/chats/${chatId}/messages`, {
      token, body: { kind: "poll", poll: { question: "smoke?", options: ["yes", "no"] } },
    });
    check("poll 201", p.status === 201 && !!p.json?.message?.poll, `status=${p.status}`);
    const pollId = p.json?.message?.id;
    const optId = p.json?.message?.poll?.options?.[0]?.id;
    const v = await api("POST", `/api/chats/${chatId}/messages/${pollId}/poll-vote`, { token, body: { optionIds: [optId] } });
    check("poll vote 200", v.status === 200, `status=${v.status}`);
  }

  console.log("[5] realtime over raw Engine.IO (no client lib)");
  {
    const hs = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling`);
    const hsPackets = splitPackets(await hs.text());
    const open = hsPackets.find((p) => p.startsWith("0"));
    const sid = open ? JSON.parse(open.slice(1)).sid : null;
    check("EIO handshake + sid", hs.status === 200 && !!sid);
    if (sid) {
      const conn = await eioPost(sid, `40{"token":"${token}"}`);
      check("namespace CONNECT accepted", conn.status === 200);
      const first = await eioPoll(sid);
      check("server confirms CONNECT (40)", first.packets.some((p) => p.startsWith("40")));
      const join = await eioPost(sid, `42["chat:join","${chatId}"]`);
      check("chat:join accepted", join.status === 200);
      const typing = await eioPost(sid, `42["chat:typing",{"chatId":"${chatId}","active":true,"action":"text"}]`);
      check("chat:typing accepted", typing.status === 200);

      // Live push: hang a poll, send via REST, then drain polls until
      // the chat:message arrives (presence frames may interleave).
      const seen = [];
      const hanging = eioPoll(sid).then((r) => seen.push(...r.packets));
      await new Promise((r) => setTimeout(r, 400));
      const live = await api("POST", `/api/chats/${chatId}/messages`, {
        token, body: { text: "ios smoke realtime", clientMessageId: `ios-rt-${Date.now()}` },
      });
      await hanging;
      for (let i = 0; i < 4 && !seen.some((p) => p.startsWith("42[\"chat:message\"")); i++) {
        const more = await eioPoll(sid);
        seen.push(...more.packets);
      }
      const gotMsg = seen.some((p) => p.startsWith("42[\"chat:message\""));
      check("live chat:message pushed", live.status === 201 && gotMsg, seen.join("|").slice(0, 200));

      // Acked read: server answers 43<id>[...]; drain polls until it shows.
      const readMsg = live.json?.message?.id;
      const ackSeen = [];
      const read = await eioPost(sid, `421["chat:read",{"chatId":"${chatId}","stream":"main","messageId":"${readMsg}"}]`);
      ackSeen.push(...read.packets);
      for (let i = 0; i < 4 && !ackSeen.some((p) => p.startsWith("431[")); i++) {
        const more = await eioPoll(sid);
        ackSeen.push(...more.packets);
      }
      const ack = ackSeen.some((p) => p.startsWith("431["));
      check("chat:read ack (431)", read.status === 200 && ack);
    }
  }

  console.log("[6] forward + delete + users search");
  {
    const c2 = await api("POST", "/api/chats", { token, body: { type: "group", title: "ios smoke 2" } });
    const chat2 = c2.json?.chat?.id;
    const f = await api("POST", `/api/chats/${chatId}/messages/${msgId}/forward`, {
      token, body: { targetChatId: chat2 },
    });
    check("forward 201", f.status === 201 && !!f.json?.message?.id, `status=${f.status}`);
    const d = await api("DELETE", `/api/chats/${chatId}/messages/${msgId}`, { token });
    check("delete 200", d.status === 200, `status=${d.status}`);
    const u = await api("GET", `/api/users/search?q=ios_smoke`, { token });
    check("users search", u.status === 200 && Array.isArray(u.json?.users), `status=${u.status}`);
    void myId;
  }

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("smoke crashed:", e); process.exit(2); });
