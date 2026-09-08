import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {v4 as uuid} from 'uuid';
import {DatabaseSync} from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.YOOH_PLAYMODE_DATA_DIR
  ? path.resolve(process.env.YOOH_PLAYMODE_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SQLITE_PATH = process.env.YOOH_PLAYMODE_SQLITE_PATH
  ? path.resolve(process.env.YOOH_PLAYMODE_SQLITE_PATH)
  : path.join(DATA_DIR, 'yooh-playmode.sqlite');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATE_TABLES = {
  users: 'state_users',
  servers: 'state_servers',
  channels: 'state_channels',
  messages: 'state_messages',
  dmChannels: 'state_dm_channels',
  dmMessages: 'state_dm_messages',
  friendRequests: 'state_friend_requests',
  friendships: 'state_friendships',
  serverRoles: 'state_server_roles',
  serverMemberRoles: 'state_server_member_roles',
  serverInvites: 'state_server_invites',
  serverEvents: 'state_server_events',
  userServerPrefs: 'state_user_server_prefs',
  serverAuditLogs: 'state_server_audit_logs',
  serverBans: 'state_server_bans',
  serverIntegrations: 'state_server_integrations',
  serverEmojiPacks: 'state_server_emoji_packs'
};

const DEFAULT_PERMISSIONS = {
  manageServer: false,
  manageChannels: false,
  manageMembers: false,
  manageRoles: false,
  manageInvites: false
};

const ADMIN_PERMISSIONS = {
  manageServer: true,
  manageChannels: true,
  manageMembers: true,
  manageRoles: true,
  manageInvites: true
};

let sqlite = null;

function initialState() {
  return Object.keys(STATE_TABLES).reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function ensureServerProfile(server) {
  if (typeof server.tag !== 'string') server.tag = '';
  if (typeof server.description !== 'string') server.description = '';
  if (typeof server.iconUrl !== 'string') server.iconUrl = '';
  if (typeof server.bannerUrl !== 'string') server.bannerUrl = '';
  if (typeof server.bannerColor !== 'string') server.bannerColor = '#1f2937';
}

function buildDefaultRoles(serverId) {
  return [
    {
      id: uuid(),
      serverId,
      name: '@everyone',
      color: '#949ba4',
      permissions: {...DEFAULT_PERMISSIONS},
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: uuid(),
      serverId,
      name: 'admin',
      color: '#f23f43',
      permissions: {...ADMIN_PERMISSIONS},
      isDefault: false,
      createdAt: new Date().toISOString()
    }
  ];
}

function ensureServerRoleEntry(db, serverId, userId, fallbackRoleId) {
  let entry = db.serverMemberRoles.find((item) => item.serverId === serverId && item.userId === userId);
  if (!entry) {
    entry = {
      id: uuid(),
      serverId,
      userId,
      roleIds: fallbackRoleId ? [fallbackRoleId] : [],
      createdAt: new Date().toISOString()
    };
    db.serverMemberRoles.push(entry);
  }
  if (!Array.isArray(entry.roleIds)) entry.roleIds = [];
  if (fallbackRoleId && !entry.roleIds.includes(fallbackRoleId)) entry.roleIds.push(fallbackRoleId);
  return entry;
}

function ensureServerDefaults(db, server) {
  ensureServerProfile(server);
  let roles = db.serverRoles.filter((role) => role.serverId === server.id);
  if (!roles.length) {
    roles = buildDefaultRoles(server.id);
    db.serverRoles.push(...roles);
  }

  const everyoneRole = roles.find((role) => role.isDefault) || roles[0];
  const adminRole = roles.find((role) => role.name.toLowerCase() === 'admin') || roles[0];

  for (const memberId of server.memberIds || []) {
    const entry = ensureServerRoleEntry(db, server.id, memberId, everyoneRole?.id);
    if (memberId === server.ownerId && adminRole && !entry.roleIds.includes(adminRole.id)) entry.roleIds.push(adminRole.id);
  }

  for (const channel of db.channels.filter((item) => item.serverId === server.id)) {
    if (typeof channel.isPrivate !== 'boolean') channel.isPrivate = false;
    if (!Array.isArray(channel.allowedRoleIds)) channel.allowedRoleIds = [];
    if (typeof channel.createdByUserId !== 'string' || !channel.createdByUserId.trim()) {
      channel.createdByUserId = server.ownerId || '';
    }
    if (channel.kind !== 'voice' && channel.kind !== 'text') channel.kind = 'text';
    if (typeof channel.section !== 'string' || !channel.section.trim()) {
      channel.section = channel.kind === 'voice' ? 'VOICE CHANNELS' : 'TEXT CHANNELS';
    }
  }
}

function ensureSqlite() {
  if (sqlite) return sqlite;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  sqlite = new DatabaseSync(SQLITE_PATH);
  sqlite.exec('PRAGMA journal_mode=WAL;');
  sqlite.exec('DROP TABLE IF EXISTS app_state;');
  for (const table of Object.values(STATE_TABLES)) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.length && !cols.some((c) => c.name === 'rowKey')) {
      sqlite.exec(`DROP TABLE IF EXISTS ${table};`);
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        rowKey TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }
  return sqlite;
}

function readState() {
  const db = ensureSqlite();
  const state = initialState();
  for (const [key, table] of Object.entries(STATE_TABLES)) {
    const rows = db.prepare(`SELECT data FROM ${table} ORDER BY rowid ASC`).all();
    const arr = [];
    for (const row of rows) {
      try {
        arr.push(JSON.parse(String(row?.data || 'null')));
      } catch {
        // skip bad row
      }
    }
    state[key] = arr;
  }
  return state;
}

function writeState(state) {
  const db = ensureSqlite();
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    for (const [key, table] of Object.entries(STATE_TABLES)) {
      db.prepare(`DELETE FROM ${table}`).run();
      const items = Array.isArray(state[key]) ? state[key] : [];
      const insert = db.prepare(`INSERT INTO ${table} (rowKey, data, updatedAt) VALUES (?, ?, ?)`);
      const usedKeys = new Set();
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const rawKey = (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
          ? item.id.trim()
          : `${i}`;
        let rowKey = rawKey;
        let n = 1;
        while (usedKeys.has(rowKey)) {
          n += 1;
          rowKey = `${rawKey}:${n}`;
        }
        usedKeys.add(rowKey);
        insert.run(rowKey, JSON.stringify(item), new Date().toISOString());
      }
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function safeEmailLocal(value) {
  return String(value || 'user')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24) || 'user';
}

function makeUniqueEmail(base, used) {
  let i = 0;
  let candidate = `${base}@local.metior`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${base}${i}@local.metior`;
  }
  used.add(candidate);
  return candidate;
}

export function readDb() {
  const parsed = readState();
  let changed = false;

  for (const key of Object.keys(STATE_TABLES)) {
    if (!Array.isArray(parsed[key])) {
      parsed[key] = [];
      changed = true;
    }
  }

  const usedEmails = new Set();
  for (const user of parsed.users) {
    if (typeof user.name !== 'string' || user.name.trim().length < 2) {
      user.name = String(user.profile?.displayName || user.username || '').trim().slice(0, 64) || 'User';
      changed = true;
    }
    const cleanUsername = String(user.username || '').trim().replace(/^@+/, '').toLowerCase();
    if (!cleanUsername) {
      user.username = `user${String(user.id || '').slice(0, 6)}`;
      changed = true;
    } else if (cleanUsername !== user.username) {
      user.username = cleanUsername;
      changed = true;
    }
    if (typeof user.email !== 'string') {
      user.email = '';
      changed = true;
    }
    const normalizedEmail = String(user.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail) || usedEmails.has(normalizedEmail)) {
      const base = safeEmailLocal(user.username || user.id);
      const nextEmail = makeUniqueEmail(base, usedEmails);
      if (nextEmail !== user.email) {
        user.email = nextEmail;
        changed = true;
      }
    } else {
      if (normalizedEmail !== user.email) {
        user.email = normalizedEmail;
        changed = true;
      }
      usedEmails.add(normalizedEmail);
    }
    if (!user.profile || typeof user.profile !== 'object') {
      user.profile = {
        displayName: user.username,
        bio: '',
        location: '',
        statusText: '',
        avatarColor: '#5865f2',
        bannerColor: '#1e1f22',
        avatarUrl: '',
        bannerUrl: ''
      };
      changed = true;
    }
    if (typeof user.profile.location !== 'string') {
      user.profile.location = '';
      changed = true;
    }
    if (typeof user.profile.avatarUrl !== 'string') {
      user.profile.avatarUrl = '';
      changed = true;
    }
    if (typeof user.profile.bannerUrl !== 'string') {
      user.profile.bannerUrl = '';
      changed = true;
    }
  }

  for (const channel of parsed.channels) {
    if (typeof channel.topic !== 'string') {
      channel.topic = '';
      changed = true;
    }
    if (typeof channel.color !== 'string') {
      channel.color = '#949ba4';
      changed = true;
    }
    if (typeof channel.isPrivate !== 'boolean') {
      channel.isPrivate = false;
      changed = true;
    }
    if (!Array.isArray(channel.allowedRoleIds)) {
      channel.allowedRoleIds = [];
      changed = true;
    }
    if (channel.kind !== 'voice' && channel.kind !== 'text') {
      channel.kind = 'text';
      changed = true;
    }
    if (typeof channel.section !== 'string' || !channel.section.trim()) {
      channel.section = channel.kind === 'voice' ? 'VOICE CHANNELS' : 'TEXT CHANNELS';
      changed = true;
    }
  }

  for (const message of parsed.messages) {
    if (!Array.isArray(message.attachments)) {
      message.attachments = [];
      changed = true;
    }
    if (!message.reactions || typeof message.reactions !== 'object') {
      message.reactions = {};
      changed = true;
    }
    if (typeof message.replyToId !== 'string') {
      message.replyToId = '';
      changed = true;
    }
    if (!message.forwardedFrom || typeof message.forwardedFrom !== 'object') {
      message.forwardedFrom = null;
      changed = true;
    }
    if (!Array.isArray(message.deletedFor)) {
      message.deletedFor = [];
      changed = true;
    } else {
      const next = Array.from(new Set(message.deletedFor
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
      if (JSON.stringify(next) !== JSON.stringify(message.deletedFor)) {
        message.deletedFor = next;
        changed = true;
      }
    }
  }

  for (const message of parsed.dmMessages) {
    if (!Array.isArray(message.attachments)) {
      message.attachments = [];
      changed = true;
    }
    if (!message.reactions || typeof message.reactions !== 'object') {
      message.reactions = {};
      changed = true;
    }
    if (typeof message.replyToId !== 'string') {
      message.replyToId = '';
      changed = true;
    }
    if (!message.forwardedFrom || typeof message.forwardedFrom !== 'object') {
      message.forwardedFrom = null;
      changed = true;
    }
    if (!Array.isArray(message.deletedFor)) {
      message.deletedFor = [];
      changed = true;
    } else {
      const next = Array.from(new Set(message.deletedFor
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
      if (JSON.stringify(next) !== JSON.stringify(message.deletedFor)) {
        message.deletedFor = next;
        changed = true;
      }
    }
  }

  for (const server of parsed.servers) {
    const beforeServer = JSON.stringify({
      tag: server.tag,
      description: server.description,
      iconUrl: server.iconUrl,
      bannerUrl: server.bannerUrl,
      bannerColor: server.bannerColor
    });
    const beforeRoles = parsed.serverRoles.length;
    const beforeMemberRoles = parsed.serverMemberRoles.length;
    ensureServerDefaults(parsed, server);
    const afterServer = JSON.stringify({
      tag: server.tag,
      description: server.description,
      iconUrl: server.iconUrl,
      bannerUrl: server.bannerUrl,
      bannerColor: server.bannerColor
    });
    if (parsed.serverRoles.length !== beforeRoles || parsed.serverMemberRoles.length !== beforeMemberRoles) changed = true;
    if (beforeServer !== afterServer) changed = true;
  }

  for (const pack of parsed.serverEmojiPacks) {
    if (typeof pack.name !== 'string') {
      pack.name = 'Набор';
      changed = true;
    } else {
      const nextName = pack.name.trim().slice(0, 60);
      if (nextName !== pack.name) {
        pack.name = nextName || 'Набор';
        changed = true;
      }
    }
    if (!Array.isArray(pack.emojis)) {
      pack.emojis = [];
      changed = true;
    } else {
      const next = Array.from(new Set(pack.emojis
        .map((item) => String(item || '').trim().slice(0, 32))
        .filter(Boolean)))
        .slice(0, 120);
      if (JSON.stringify(next) !== JSON.stringify(pack.emojis)) {
        pack.emojis = next;
        changed = true;
      }
    }
    if (typeof pack.serverId !== 'string') {
      pack.serverId = '';
      changed = true;
    }
    if (typeof pack.createdAt !== 'string') {
      pack.createdAt = new Date().toISOString();
      changed = true;
    }
    if (typeof pack.updatedAt !== 'string') {
      pack.updatedAt = pack.createdAt;
      changed = true;
    }
  }

  if (changed) writeDb(parsed);
  return parsed;
}

export function writeDb(next) {
  writeState(next);
}

export function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  for (const server of db.servers) ensureServerDefaults(db, server);
  writeDb(db);
  return result;
}

export function createServerWithDefaults(db, ownerId, name) {
  const server = {
    id: uuid(),
    name,
    tag: '',
    description: '',
    iconUrl: '',
    bannerUrl: '',
    bannerColor: '#1f2937',
    ownerId,
    memberIds: [ownerId],
    createdAt: new Date().toISOString()
  };
  const channel = {
    id: uuid(),
    serverId: server.id,
    name: 'general',
    topic: 'General discussion',
    color: '#949ba4',
    kind: 'text',
    section: 'TEXT CHANNELS',
    isPrivate: false,
    allowedRoleIds: [],
    createdAt: new Date().toISOString()
  };
  db.servers.push(server);
  db.channels.push(channel);
  ensureServerDefaults(db, server);
  return {server, channel};
}

export function createDefaultServerForUser(ownerId, ownerUsername) {
  return withDb((db) => createServerWithDefaults(db, ownerId, `${ownerUsername}'s Server`));
}

export function getOrCreateDmChannel(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return null;
  const sorted = [userAId, userBId].sort();
  return withDb((db) => {
    const existing = db.dmChannels.find((dm) => {
      const ids = [...dm.userIds].sort();
      return ids.length === 2 && ids[0] === sorted[0] && ids[1] === sorted[1];
    });
    if (existing) return existing;
    const next = {id: uuid(), userIds: sorted, createdAt: new Date().toISOString()};
    db.dmChannels.push(next);
    return next;
  });
}

export function areFriends(db, userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return false;
  return db.friendships.some((friendship) => {
    const ids = [...friendship.userIds].sort();
    const target = [userAId, userBId].sort();
    return ids[0] === target[0] && ids[1] === target[1];
  });
}

export function createFriendship(db, userAId, userBId) {
  if (areFriends(db, userAId, userBId)) {
    return db.friendships.find((friendship) => {
      const ids = [...friendship.userIds].sort();
      const target = [userAId, userBId].sort();
      return ids[0] === target[0] && ids[1] === target[1];
    });
  }
  const friendship = {id: uuid(), userIds: [userAId, userBId].sort(), createdAt: new Date().toISOString()};
  db.friendships.push(friendship);
  return friendship;
}

export function getServerRoles(db, serverId) {
  return db.serverRoles.filter((role) => role.serverId === serverId);
}

export function getMemberRoleIds(db, serverId, userId) {
  const entry = db.serverMemberRoles.find((item) => item.serverId === serverId && item.userId === userId);
  return entry?.roleIds || [];
}

export function userHasServerPermission(db, serverId, userId, permissionKey) {
  const server = db.servers.find((item) => item.id === serverId);
  if (!server) return false;
  if (server.ownerId === userId) return true;
  const roles = getServerRoles(db, serverId);
  const roleIds = getMemberRoleIds(db, serverId, userId);
  for (const roleId of roleIds) {
    const role = roles.find((item) => item.id === roleId);
    if (role?.permissions?.[permissionKey]) return true;
  }
  return false;
}

export function userHasChannelAccess(db, userId, channelId) {
  const channel = db.channels.find((item) => item.id === channelId);
  if (!channel) return false;
  const server = db.servers.find((item) => item.id === channel.serverId);
  if (!server) return false;
  if (!server.memberIds.includes(userId)) return false;
  if (!channel.isPrivate) return true;
  if (server.ownerId === userId) return true;
  const roleIds = getMemberRoleIds(db, server.id, userId);
  return roleIds.some((roleId) => channel.allowedRoleIds.includes(roleId));
}

export function addMemberToServer(db, serverId, userId) {
  const server = db.servers.find((item) => item.id === serverId);
  if (!server) return null;
  if (!server.memberIds.includes(userId)) server.memberIds.push(userId);
  ensureServerDefaults(db, server);
  return server;
}

export function getServerPref(db, userId, serverId) {
  return db.userServerPrefs.find((item) => item.userId === userId && item.serverId === serverId) || {
    id: '',
    userId,
    serverId,
    muted: false,
    mentionsOnly: false,
    desktopEnabled: true,
    soundEnabled: true,
    createdAt: '',
    updatedAt: ''
  };
}

export function upsertServerPref(db, userId, serverId, partial) {
  let pref = db.userServerPrefs.find((item) => item.userId === userId && item.serverId === serverId);
  if (!pref) {
    pref = {
      id: uuid(),
      userId,
      serverId,
      muted: false,
      mentionsOnly: false,
      desktopEnabled: true,
      soundEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.userServerPrefs.push(pref);
  }
  pref.muted = typeof partial.muted === 'boolean' ? partial.muted : pref.muted;
  pref.mentionsOnly = typeof partial.mentionsOnly === 'boolean' ? partial.mentionsOnly : pref.mentionsOnly;
  pref.desktopEnabled = typeof partial.desktopEnabled === 'boolean' ? partial.desktopEnabled : pref.desktopEnabled;
  pref.soundEnabled = typeof partial.soundEnabled === 'boolean' ? partial.soundEnabled : pref.soundEnabled;
  pref.updatedAt = new Date().toISOString();
  return pref;
}

export function getServerEvents(db, serverId) {
  return db.serverEvents
    .filter((event) => event.serverId === serverId)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function getServerBans(db, serverId) {
  return (db.serverBans || [])
    .filter((item) => item.serverId === serverId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function isUserBannedInServer(db, serverId, userId) {
  return getServerBans(db, serverId).some((item) => item.userId === userId);
}

export function getServerIntegrations(db, serverId) {
  return (db.serverIntegrations || [])
    .filter((item) => item.serverId === serverId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getServerEmojiPacks(db, serverId) {
  return (db.serverEmojiPacks || [])
    .filter((item) => item.serverId === serverId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function addAuditLog(db, payload) {
  const entry = {
    id: uuid(),
    serverId: payload.serverId,
    actorUserId: payload.actorUserId,
    action: payload.action,
    details: payload.details || '',
    createdAt: new Date().toISOString()
  };
  db.serverAuditLogs.push(entry);
  return entry;
}
