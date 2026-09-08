const API = process.env.API || 'http://127.0.0.1:4000/api';
const USERS = Math.max(1, Number(process.env.USERS || 8));
const MSGS_PER_USER = Math.max(1, Number(process.env.MSGS || 40));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 12));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, {method = 'GET', token = '', body} = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${path} ${data?.error || ''}`.trim());
  }
  return data;
}

async function ensureUser(index) {
  const suffix = `${Date.now()}_${index}`;
  const payload = {
    name: `Load User ${index}`,
    username: `load_user_${suffix}`,
    email: `load_${suffix}@local.metior`,
    password: '12345678'
  };
  const reg = await request('/auth/register', {method: 'POST', body: payload});
  const boot = await request('/bootstrap', {token: reg.token});
  const server = boot.servers?.[0];
  const channel = server?.channels?.find((x) => (x.kind || 'text') === 'text') || server?.channels?.[0];
  if (!channel?.id) throw new Error('No default text channel');
  return {token: reg.token, channelId: channel.id, username: payload.username};
}

async function runOneUser(user, messages, beginAt) {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < messages; i += 1) {
    try {
      await request(`/channels/${user.channelId}/messages`, {
        method: 'POST',
        token: user.token,
        body: {
          content: `stress ${user.username} #${i} @ ${Date.now() - beginAt}ms`
        }
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return {ok, fail};
}

async function pool(items, worker, concurrency = 8) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({length: concurrency}).map(async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`[stress] API=${API}`);
  console.log(`[stress] users=${USERS}, msgs/user=${MSGS_PER_USER}, concurrency=${CONCURRENCY}`);

  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    users.push(await ensureUser(i + 1));
    await sleep(20);
  }

  const startedAt = Date.now();
  const results = await pool(
    users,
    async (user) => runOneUser(user, MSGS_PER_USER, startedAt),
    Math.min(CONCURRENCY, USERS)
  );

  const elapsed = Date.now() - startedAt;
  const totalOk = results.reduce((acc, x) => acc + (x?.ok || 0), 0);
  const totalFail = results.reduce((acc, x) => acc + (x?.fail || 0), 0);
  const rps = (totalOk / Math.max(1, elapsed / 1000)).toFixed(2);

  console.log(`[stress] done in ${elapsed}ms`);
  console.log(`[stress] sent ok=${totalOk}, fail=${totalFail}, approx req/s=${rps}`);
  if (totalFail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[stress] fatal:', err.message || err);
  process.exitCode = 1;
});
