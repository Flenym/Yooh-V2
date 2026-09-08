import path from "node:path";
import { promises as fs } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

function defaultState() {
  return {
    users: [],
    authCodes: [],
    sessions: [],
    loginTickets: [],
    qrLogins: [],
    chats: [],
    memberships: [],
    messages: [],
    files: [],
    stories: [],
    callLogs: [],
    bans: [],
    mutes: [],
    chatBans: [],
    reports: [],
    feedbackTickets: [],
    supportTickets: [],
    supportTicketSeq: 0,
    errorLogs: [],
    pushSubscriptions: [],
    stickerPacks: [],
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    users: Array.isArray(state.users) ? state.users : [],
    authCodes: Array.isArray(state.authCodes) ? state.authCodes : [],
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    loginTickets: Array.isArray(state.loginTickets) ? state.loginTickets : [],
    qrLogins: Array.isArray(state.qrLogins) ? state.qrLogins : [],
    chats: Array.isArray(state.chats) ? state.chats : [],
    memberships: Array.isArray(state.memberships) ? state.memberships : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    files: Array.isArray(state.files) ? state.files : [],
    stories: Array.isArray(state.stories) ? state.stories : [],
    callLogs: Array.isArray(state.callLogs) ? state.callLogs : [],
    bans: Array.isArray(state.bans) ? state.bans : [],
    mutes: Array.isArray(state.mutes) ? state.mutes : [],
    chatBans: Array.isArray(state.chatBans) ? state.chatBans : [],
    reports: Array.isArray(state.reports) ? state.reports : [],
    feedbackTickets: Array.isArray(state.feedbackTickets) ? state.feedbackTickets : [],
    supportTickets: Array.isArray(state.supportTickets) ? state.supportTickets : [],
    supportTicketSeq:
      Number.isFinite(Number.parseInt(state.supportTicketSeq, 10)) && Number.parseInt(state.supportTicketSeq, 10) > 0
        ? Number.parseInt(state.supportTicketSeq, 10)
        : 0,
    errorLogs: Array.isArray(state.errorLogs) ? state.errorLogs : [],
    pushSubscriptions: Array.isArray(state.pushSubscriptions) ? state.pushSubscriptions : [],
    stickerPacks: Array.isArray(state.stickerPacks) ? state.stickerPacks : [],
  };
}

const RETRYABLE_FS_CODES = new Set([
  "EBUSY",
  "EPERM",
  "EACCES",
  "EIO",
  "ETIMEDOUT",
  "EMFILE",
  "ENFILE",
  "EEXIST",
  "ENOENT",
  "ENOTEMPTY",
]);
const STORE_WRITE_RETRY_ATTEMPTS = 24;
const STORE_WRITE_RETRY_BASE_DELAY_MS = 45;
const STORE_WRITE_RETRY_MAX_DELAY_MS = 1500;
const STORE_LOCK_STALE_MS = 8_000;

function isRetryableFsError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  return RETRYABLE_FS_CODES.has(code);
}

async function withRetry(operation, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 1;
  const baseDelayMs =
    Number.isFinite(options.baseDelayMs) && Number(options.baseDelayMs) > 0
      ? Number(options.baseDelayMs)
      : STORE_WRITE_RETRY_BASE_DELAY_MS;
  const maxDelayMs =
    Number.isFinite(options.maxDelayMs) && Number(options.maxDelayMs) > 0
      ? Number(options.maxDelayMs)
      : STORE_WRITE_RETRY_MAX_DELAY_MS;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableFsError(error) || attempt >= attempts) {
        throw error;
      }

      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Store retry operation failed");
}

async function withFileLock(lockPath, operation) {
  let lockHandle = null;

  try {
    lockHandle = await withRetry(async () => {
      try {
        return await fs.open(lockPath, "wx");
      } catch (error) {
        if (String(error?.code ?? "").toUpperCase() === "EEXIST") {
          try {
            const stat = await fs.stat(lockPath);
            if (Date.now() - stat.mtimeMs > STORE_LOCK_STALE_MS) {
              await fs.unlink(lockPath).catch(() => {
                // Ignore stale lock cleanup races.
              });
            }
          } catch {
            // Ignore lock stat/read races.
          }
        }
        throw error;
      }
    }, { attempts: STORE_WRITE_RETRY_ATTEMPTS });

    return await operation();
  } finally {
    if (lockHandle) {
      try {
        await lockHandle.close();
      } catch {
        // Ignore lock file close errors.
      }
    }
    await fs.unlink(lockPath).catch(() => {
      // Ignore lock cleanup errors.
    });
  }
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = defaultState();
    this.initialized = false;
    this.writeQueue = Promise.resolve();
    this.txQueue = Promise.resolve();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      if (!raw.trim()) {
        this.state = defaultState();
        await this.persist();
      } else {
        try {
          this.state = normalizeState(JSON.parse(raw));
        } catch {
          const backupPath = `${this.filePath}.corrupt.${Date.now()}.json`;
          await fs.writeFile(backupPath, raw, "utf8");
          this.state = defaultState();
          await this.persist();
        }
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.state = defaultState();
        await this.persist();
      } else {
        throw error;
      }
    }

    this.initialized = true;
  }

  async read(reader) {
    await this.init();
    return reader(this.state);
  }

  async transact(mutator) {
    await this.init();

    const runTx = async () => {
      const snapshot = structuredClone(this.state);
      const result = mutator(this.state);
      try {
        await this.persist();
        return result;
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
    };

    const operation = this.txQueue.catch(() => undefined).then(runTx);
    this.txQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async persist() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const lockPath = `${this.filePath}.lock`;
      await withFileLock(lockPath, async () => {
        await withRetry(async () => {
          const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
          try {
            await fs.writeFile(tempPath, payload, "utf8");
            await fs.rename(tempPath, this.filePath);
          } catch (error) {
            if (isRetryableFsError(error)) {
              await fs.writeFile(this.filePath, payload, "utf8");
            } else {
              throw error;
            }
          } finally {
            await fs.unlink(tempPath).catch(() => {
              // Ignore temp file cleanup errors.
            });
          }
        }, { attempts: STORE_WRITE_RETRY_ATTEMPTS });
      });
    });
    await this.writeQueue;
  }
}
