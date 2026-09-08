import http from 'node:http';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import {v4 as uuid} from 'uuid';
import {Server as SocketIOServer} from 'socket.io';
import {authMiddleware, signToken, verifyToken} from './auth.js';
import {
  addMemberToServer,
  addAuditLog,
  areFriends,
  createDefaultServerForUser,
  createServerWithDefaults,
  createFriendship,
  getServerBans,
  getServerEmojiPacks,
  getServerEvents,
  getServerIntegrations,
  getServerPref,
  isUserBannedInServer,
  getMemberRoleIds,
  getServerRoles,
  getOrCreateDmChannel,
  readDb,
  upsertServerPref,
  userHasChannelAccess,
  userHasServerPermission,
  withDb
} from './db.js';

const PORT = Number(process.env.PORT || 4000);
const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({limit: '100mb'}));

function clampText(value, max = 140) {
  return String(value || '').trim().slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeAttachment(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || '').trim().slice(0, 1500000);
  if (!url) return null;
  const name = clampText(item.name || 'file', 120) || 'file';
  const type = clampText(item.type || '', 120);
  const size = Number.isFinite(Number(item.size)) ? Number(item.size) : 0;
  let kind = String(item.kind || '').trim().toLowerCase();
  if (!kind) {
    if (type.startsWith('image/')) kind = 'image';
    else if (type.startsWith('audio/')) kind = 'audio';
    else kind = 'file';
  }
  if (!['image', 'audio', 'file'].includes(kind)) kind = 'file';
  return {
    id: uuid(),
    name,
    type,
    size,
    kind,
    url
  };
}

function sanitizeForwardedFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const messageId = clampText(raw.messageId || '', 120);
  const userId = clampText(raw.userId || '', 120);
  const username = clampText(raw.username || '', 80);
  if (!messageId) return null;
  return {messageId, userId, username};
}

function sanitizeMessageInput(raw) {
  const content = clampText(raw?.content, 4000);
  const attachments = asArray(raw?.attachments).map(sanitizeAttachment).filter(Boolean).slice(0, 6);
  const replyToId = clampText(raw?.replyToId || '', 120);
  const forwardedFrom = sanitizeForwardedFrom(raw?.forwardedFrom);
  if (!content && !attachments.length) return null;
  return {
    content,
    attachments,
    replyToId: replyToId || '',
    forwardedFrom
  };
}

function parseEmojiTokens(input) {
  if (Array.isArray(input)) {
    return Array.from(new Set(input
      .map((item) => String(item || '').trim().slice(0, 32))
      .filter(Boolean)))
      .slice(0, 120);
  }
  const text = String(input || '').trim();
  if (!text) return [];
  const hasSeparators = /[\s,;|]/.test(text);
  const raw = hasSeparators ? text.split(/[\s,;|]+/g) : Array.from(text);
  return Array.from(new Set(raw
    .map((item) => String(item || '').trim().slice(0, 32))
    .filter(Boolean)))
    .slice(0, 120);
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return message;
  if (!Array.isArray(message.attachments)) message.attachments = [];
  if (!message.reactions || typeof message.reactions !== 'object') message.reactions = {};
  if (typeof message.replyToId !== 'string') message.replyToId = '';
  if (!message.forwardedFrom || typeof message.forwardedFrom !== 'object') message.forwardedFrom = null;
  if (!Array.isArray(message.deletedFor)) message.deletedFor = [];
  return message;
}

function isMessageDeletedForUser(message, userId) {
  if (!message || !userId) return false;
  normalizeMessage(message);
  return message.deletedFor.includes(userId);
}

function toggleReaction(message, userId, emoji) {
  const cleanEmoji = clampText(emoji || '', 20);
  if (!cleanEmoji) return message;
  normalizeMessage(message);
  const current = Array.isArray(message.reactions[cleanEmoji]) ? message.reactions[cleanEmoji] : [];
  const has = current.includes(userId);
  const next = has ? current.filter((id) => id !== userId) : [...current, userId];
  if (next.length) message.reactions[cleanEmoji] = next;
  else delete message.reactions[cleanEmoji];
  return message;
}

const USERNAME_RE = /^[a-z0-9._]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUsernameInput(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeEmailInput(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUser(user) {
  return {
    id: user.id,
    name: user.name || user.profile?.displayName || user.username,
    username: user.username,
    createdAt: user.createdAt,
    profile: {
      displayName: user.profile?.displayName || user.username,
      bio: user.profile?.bio || '',
      location: user.profile?.location || '',
      statusText: user.profile?.statusText || '',
      avatarColor: user.profile?.avatarColor || '#5865f2',
      bannerColor: user.profile?.bannerColor || '#1e1f22',
      avatarUrl: user.profile?.avatarUrl || '',
      bannerUrl: user.profile?.bannerUrl || ''
    }
  };
}

function isLegacyDemoUser(user) {
  const username = String(user?.username || '').trim().toLowerCase();
  const email = String(user?.email || '').trim().toLowerCase();
  if (!username && !email) return false;
  if (/^demo_[0-9]{4,}_[0-9]+$/.test(username)) return true;
  return email.endsWith('@local.yooh') && username.startsWith('demo_');
}

function purgeLegacyDemoUsers() {
  return withDb((db) => {
    const demoIds = new Set((db.users || []).filter((entry) => isLegacyDemoUser(entry)).map((entry) => entry.id));
    if (!demoIds.size) return 0;

    db.users = (db.users || []).filter((entry) => !demoIds.has(entry.id));
    db.friendRequests = (db.friendRequests || []).filter(
      (entry) => !demoIds.has(entry.fromUserId) && !demoIds.has(entry.toUserId)
    );
    db.friendships = (db.friendships || []).filter((entry) => {
      const userIds = Array.isArray(entry.userIds) ? entry.userIds : [];
      return userIds.every((userId) => !demoIds.has(userId));
    });

    db.messages = (db.messages || []).filter((entry) => !demoIds.has(entry.userId));
    db.dmMessages = (db.dmMessages || []).filter((entry) => !demoIds.has(entry.userId));
    db.dmChannels = (db.dmChannels || []).filter((entry) => {
      const userIds = Array.isArray(entry.userIds) ? entry.userIds : [];
      return userIds.every((userId) => !demoIds.has(userId));
    });

    db.servers = (db.servers || []).filter((server) => {
      const nextMemberIds = Array.isArray(server.memberIds)
        ? server.memberIds.filter((memberId) => !demoIds.has(memberId))
        : [];
      if (!nextMemberIds.length) {
        return false;
      }
      server.memberIds = nextMemberIds;
      if (demoIds.has(server.ownerId) || !nextMemberIds.includes(server.ownerId)) {
        server.ownerId = nextMemberIds[0];
      }
      return true;
    });

    db.serverMemberRoles = (db.serverMemberRoles || []).filter((entry) => !demoIds.has(entry.userId));
    db.serverBans = (db.serverBans || []).filter((entry) => !demoIds.has(entry.userId) && !demoIds.has(entry.actorUserId));
    db.serverInvites = (db.serverInvites || []).filter((entry) => !demoIds.has(entry.createdByUserId));
    db.serverEvents = (db.serverEvents || []).filter((entry) => !demoIds.has(entry.createdByUserId));
    db.serverAuditLogs = (db.serverAuditLogs || []).filter((entry) => !demoIds.has(entry.actorUserId));
    db.userServerPrefs = (db.userServerPrefs || []).filter((entry) => !demoIds.has(entry.userId));
    db.serverIntegrations = (db.serverIntegrations || []).filter((entry) => !demoIds.has(entry.createdByUserId));
    db.serverEmojiPacks = (db.serverEmojiPacks || []).filter((entry) => !demoIds.has(entry.createdByUserId));

    return demoIds.size;
  });
}

function isLegacyDemoServer(server) {
  const name = String(server?.name || '').trim().toLowerCase();
  const tag = String(server?.tag || '').trim().toLowerCase();
  const description = String(server?.description || '').trim().toLowerCase();
  return (
    name === 'game mode demo' &&
    (tag === 'demo' || description.includes('тестовый сервер игрового режима'))
  );
}

function purgeLegacyDemoServers() {
  return withDb((db) => {
    const demoServerIds = new Set((db.servers || []).filter((entry) => isLegacyDemoServer(entry)).map((entry) => entry.id));
    if (!demoServerIds.size) return 0;

    const removedChannelIds = new Set(
      (db.channels || [])
        .filter((entry) => demoServerIds.has(entry.serverId))
        .map((entry) => entry.id)
    );

    db.servers = (db.servers || []).filter((entry) => !demoServerIds.has(entry.id));
    db.channels = (db.channels || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.messages = (db.messages || []).filter((entry) => !removedChannelIds.has(entry.channelId));
    db.serverRoles = (db.serverRoles || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverMemberRoles = (db.serverMemberRoles || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverInvites = (db.serverInvites || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverEvents = (db.serverEvents || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.userServerPrefs = (db.userServerPrefs || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverAuditLogs = (db.serverAuditLogs || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverBans = (db.serverBans || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverIntegrations = (db.serverIntegrations || []).filter((entry) => !demoServerIds.has(entry.serverId));
    db.serverEmojiPacks = (db.serverEmojiPacks || []).filter((entry) => !demoServerIds.has(entry.serverId));

    return demoServerIds.size;
  });
}

function relationState(db, viewerId, targetUserId) {
  if (viewerId === targetUserId) return 'self';
  if (areFriends(db, viewerId, targetUserId)) return 'friends';

  const outgoing = db.friendRequests.find(
    (req) => req.fromUserId === viewerId && req.toUserId === targetUserId && req.status === 'pending'
  );
  if (outgoing) return 'outgoing';

  const incoming = db.friendRequests.find(
    (req) => req.fromUserId === targetUserId && req.toUserId === viewerId && req.status === 'pending'
  );
  if (incoming) return 'incoming';

  return 'none';
}

const PERMISSION_KEYS = ['manageServer', 'manageChannels', 'manageMembers', 'manageRoles', 'manageInvites'];

function rolePermissionsForUser(db, serverId, userId) {
  const payload = {};
  for (const key of PERMISSION_KEYS) {
    payload[key] = userHasServerPermission(db, serverId, userId, key);
  }
  return payload;
}

function mapServerForUser(db, server, currentUserId) {
  const channels = db.channels
    .filter((c) => c.serverId === server.id && userHasChannelAccess(db, currentUserId, c.id))
    .sort((a, b) => {
      if ((a.kind || 'text') !== (b.kind || 'text')) {
        return (a.kind || 'text').localeCompare(b.kind || 'text');
      }
      if ((a.section || '') !== (b.section || '')) {
        return (a.section || '').localeCompare(b.section || '');
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const roles = getServerRoles(db, server.id);
  const memberRoles = db.serverMemberRoles.filter((entry) => entry.serverId === server.id);
  const members = server.memberIds
    .map((memberId) => db.users.find((user) => user.id === memberId))
    .filter(Boolean)
    .map((user) => normalizeUser(user));
  const permissions = rolePermissionsForUser(db, server.id, currentUserId);
  const events = getServerEvents(db, server.id);
  const bans = permissions.manageMembers ? getServerBans(db, server.id) : [];
  const integrations = permissions.manageServer ? getServerIntegrations(db, server.id) : [];
  const emojiPacks = getServerEmojiPacks(db, server.id).map((item) => ({
    ...item,
    emojis: Array.isArray(item.emojis) ? item.emojis : []
  }));
  const preferences = getServerPref(db, currentUserId, server.id);

  return {
    ...server,
    channels,
    roles,
    memberRoles,
    members,
    events,
    bans,
    integrations,
    emojiPacks,
    preferences,
    permissions
  };
}

function mapDmForUser(db, dmChannel, currentUserId) {
  const otherId = dmChannel.userIds.find((id) => id !== currentUserId) || currentUserId;
  const other = db.users.find((u) => u.id === otherId);
  const lastMessage = db.dmMessages
    .filter((m) => m.dmChannelId === dmChannel.id && !isMessageDeletedForUser(m, currentUserId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  return {
    id: dmChannel.id,
    userIds: dmChannel.userIds,
    otherUser: other ? normalizeUser(other) : null,
    createdAt: dmChannel.createdAt,
    lastMessage: lastMessage ? normalizeMessage({...lastMessage}) : null
  };
}

function mapUsersForViewer(db, viewerId) {
  return db.users
    .filter((u) => u.id !== viewerId)
    .map((u) => ({
      ...normalizeUser(u),
      relation: relationState(db, viewerId, u.id)
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function mapDmListForUser(db, userId) {
  return db.dmChannels
    .filter((dm) => dm.userIds.includes(userId))
    .map((dm) => mapDmForUser(db, dm, userId))
    .sort((a, b) => {
      const ad = a.lastMessage?.createdAt || a.createdAt || '';
      const bd = b.lastMessage?.createdAt || b.createdAt || '';
      return new Date(bd).getTime() - new Date(ad).getTime();
    });
}

function userHasDmAccess(db, userId, dmChannelId) {
  const dm = db.dmChannels.find((x) => x.id === dmChannelId);
  if (!dm) return false;
  return dm.userIds.includes(userId);
}

function userHasCallAccess(db, userId, scopeType, scopeId) {
  if (scopeType === 'channel') return userHasChannelAccess(db, userId, scopeId);
  if (scopeType === 'dm') return userHasDmAccess(db, userId, scopeId);
  return false;
}

function getFriendPayload(db, userId) {
  const friends = db.friendships
    .filter((friendship) => friendship.userIds.includes(userId))
    .map((friendship) => {
      const friendId = friendship.userIds.find((id) => id !== userId);
      const friend = db.users.find((u) => u.id === friendId);
      return friend ? normalizeUser(friend) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));

  const incoming = db.friendRequests
    .filter((request) => request.toUserId === userId && request.status === 'pending')
    .map((request) => {
      const from = db.users.find((u) => u.id === request.fromUserId);
      return from ? {id: request.id, fromUser: normalizeUser(from), createdAt: request.createdAt} : null;
    })
    .filter(Boolean);

  const outgoing = db.friendRequests
    .filter((request) => request.fromUserId === userId && request.status === 'pending')
    .map((request) => {
      const to = db.users.find((u) => u.id === request.toUserId);
      return to ? {id: request.id, toUser: normalizeUser(to), createdAt: request.createdAt} : null;
    })
    .filter(Boolean);

  return {friends, incoming, outgoing};
}

function canManageChannels(db, serverId, userId) {
  return userHasServerPermission(db, serverId, userId, 'manageChannels');
}

function canManageOrOwnChannel(db, channel, userId) {
  if (!channel || !userId) return false;
  if (canManageChannels(db, channel.serverId, userId)) return true;
  const server = db.servers.find((item) => item.id === channel.serverId);
  if (server?.ownerId === userId) return true;
  return channel.createdByUserId === userId;
}

function canManageServer(db, serverId, userId) {
  return userHasServerPermission(db, serverId, userId, 'manageServer');
}

function canManageMembers(db, serverId, userId) {
  return userHasServerPermission(db, serverId, userId, 'manageMembers');
}

function canManageRoles(db, serverId, userId) {
  return userHasServerPermission(db, serverId, userId, 'manageRoles');
}

function canManageInvites(db, serverId, userId) {
  return userHasServerPermission(db, serverId, userId, 'manageInvites');
}

function createInviteCode() {
  return Math.random().toString(36).slice(2, 10);
}

function mapServerMembers(db, serverId) {
  const server = db.servers.find((item) => item.id === serverId);
  if (!server) return [];
  return server.memberIds
    .map((memberId) => db.users.find((user) => user.id === memberId))
    .filter(Boolean)
    .map((user) => ({
      ...normalizeUser(user),
      roleIds: getMemberRoleIds(db, serverId, user.id)
    }));
}

function mapServerAudit(db, serverId) {
  return (db.serverAuditLogs || [])
    .filter((entry) => entry.serverId === serverId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 250)
    .map((entry) => {
      const actor = db.users.find((user) => user.id === entry.actorUserId);
      return {
        ...entry,
        actor: actor ? normalizeUser(actor) : null
      };
    });
}

function mapServerBans(db, serverId) {
  return getServerBans(db, serverId).map((item) => {
    const user = db.users.find((u) => u.id === item.userId);
    const actor = db.users.find((u) => u.id === item.createdBy);
    return {
      ...item,
      user: user ? normalizeUser(user) : null,
      actor: actor ? normalizeUser(actor) : null
    };
  });
}

function mapServerIntegrations(db, serverId) {
  return getServerIntegrations(db, serverId).map((item) => ({
    ...item
  }));
}

function isInviteActive(invite) {
  if (!invite) return false;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return false;
  if (Number.isFinite(invite.maxUses) && invite.maxUses > 0 && invite.uses >= invite.maxUses) return false;
  return true;
}


app.get('/api/health', (_req, res) => {
  res.json({ok: true});
});

const onlineUsers = new Set();
const userSockets = new Map();
const pendingDmCalls = new Map();
const callMediaState = new Map();
const MAX_SCREEN_SHARES = 5;

app.get('/api/presence', authMiddleware, (_req, res) => {
  res.json({onlineUserIds: Array.from(onlineUsers)});
});

app.post('/api/auth/register', async (req, res) => {
  const name = clampText(req.body?.name, 64);
  const username = normalizeUsernameInput(req.body?.username);
  const email = normalizeEmailInput(req.body?.email);
  const password = String(req.body?.password || '');

  if (name.length < 2) {
    return res.status(400).json({error: 'Name must be at least 2 chars'});
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({error: 'Username format: @name (a-z, 0-9, _, .), 3-32 chars'});
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({error: 'Invalid email format'});
  }
  if (password.length < 6) {
    return res.status(400).json({error: 'Password must be at least 6 chars'});
  }

  const db = readDb();
  const existingByUsername = db.users.find(
    (u) => normalizeUsernameInput(u.username) === username
  );
  if (existingByUsername) {
    return res.status(409).json({error: 'Username already exists'});
  }
  const existingByEmail = db.users.find(
    (u) => normalizeEmailInput(u.email) === email
  );
  if (existingByEmail) {
    return res.status(409).json({error: 'Email already exists'});
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = withDb((db) => {
    const nextUser = {
      id: uuid(),
      name,
      username,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      profile: {
        displayName: name,
        bio: '',
        location: '',
        statusText: '',
        avatarColor: '#5865f2',
        bannerColor: '#1e1f22',
        avatarUrl: '',
        bannerUrl: ''
      }
    };
    db.users.push(nextUser);
    return nextUser;
  });

  createDefaultServerForUser(user.id, user.username);
  const token = signToken(user);
  return res.json({token, user: normalizeUser(user)});
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmailInput(req.body?.email);
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({error: 'Invalid email format'});
  }
  const user = readDb().users.find((u) => normalizeEmailInput(u.email) === email);
  if (!user) {
    return res.status(401).json({error: 'Invalid credentials'});
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({error: 'Invalid credentials'});
  }

  const token = signToken(user);
  return res.json({token, user: normalizeUser(user)});
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  res.json({user: normalizeUser(user)});
});

app.get('/api/bootstrap', authMiddleware, (req, res) => {
  const db = readDb();
  const me = db.users.find((u) => u.id === req.user.id);
  const servers = db.servers
    .filter((s) => s.memberIds.includes(req.user.id))
    .map((s) => mapServerForUser(db, s, req.user.id));
  const dms = db.dmChannels
    .filter((dm) => dm.userIds.includes(req.user.id))
    .map((dm) => mapDmForUser(db, dm, req.user.id));
  const friends = getFriendPayload(db, req.user.id);
  res.json({user: normalizeUser(me), servers, dms, friends, onlineUserIds: Array.from(onlineUsers)});
});


app.get('/api/users', authMiddleware, (req, res) => {
  const db = readDb();
  const users = mapUsersForViewer(db, req.user.id);
  res.json({users});
});

app.get('/api/profiles/:userId', authMiddleware, (req, res) => {
  const db = readDb();
  const target = db.users.find((u) => u.id === req.params.userId);
  if (!target) {
    return res.status(404).json({error: 'User not found'});
  }
  res.json({
    profile: normalizeUser(target),
    relation: relationState(db, req.user.id, target.id)
  });
});

app.patch('/api/profiles/me', authMiddleware, (req, res) => {
  const body = req.body || {};
  const updated = withDb((db) => {
    const me = db.users.find((u) => u.id === req.user.id);
    if (!me) return null;
    const nextUsernameRaw = typeof body.username === 'string' ? normalizeUsernameInput(body.username) : '';
    if (nextUsernameRaw) {
      if (!USERNAME_RE.test(nextUsernameRaw)) {
        return {error: 'Username must contain 3-32 chars [a-z0-9._]', status: 400};
      }
      const conflict = db.users.find(
        (candidate) =>
          candidate.id !== me.id &&
          normalizeUsernameInput(candidate.username) === nextUsernameRaw
      );
      if (conflict) {
        return {error: 'Username already taken', status: 409};
      }
      me.username = nextUsernameRaw;
      if (!String(me.profile.displayName || '').trim()) {
        me.profile.displayName = nextUsernameRaw;
      }
    }
    me.profile.displayName = clampText(body.displayName || me.profile.displayName, 32) || me.username;
    me.profile.bio = clampText(body.bio || me.profile.bio, 240);
    me.profile.location = clampText(body.location || me.profile.location, 80);
    me.profile.statusText = clampText(body.statusText || me.profile.statusText, 100);
    me.profile.avatarColor = clampText(body.avatarColor || me.profile.avatarColor, 20) || '#5865f2';
    me.profile.bannerColor = clampText(body.bannerColor || me.profile.bannerColor, 20) || '#1e1f22';
    if (typeof body.avatarUrl === 'string') {
      me.profile.avatarUrl = String(body.avatarUrl).trim().slice(0, 1500000);
    }
    if (typeof body.bannerUrl === 'string') {
      me.profile.bannerUrl = String(body.bannerUrl).trim().slice(0, 1500000);
    }
    return normalizeUser(me);
  });
  if (!updated) return res.status(404).json({error: 'User not found'});
  if (updated?.error) {
    return res.status(updated.status || 400).json({error: updated.error});
  }
  io.emit('user:updated', {user: updated});
  res.json({user: updated});
});

app.get('/api/friends', authMiddleware, (req, res) => {
  const db = readDb();
  res.json(getFriendPayload(db, req.user.id));
});

app.post('/api/friends/requests', authMiddleware, (req, res) => {
  const targetUserId = String(req.body?.targetUserId || '');
  const result = withDb((db) => {
    const target = db.users.find((u) => u.id === targetUserId);
    if (!target || target.id === req.user.id) {
      return {error: 'Invalid target'};
    }
    if (areFriends(db, req.user.id, targetUserId)) {
      return {error: 'Already friends'};
    }

    const existingOutgoing = db.friendRequests.find(
      (request) =>
        request.fromUserId === req.user.id && request.toUserId === targetUserId && request.status === 'pending'
    );
    if (existingOutgoing) {
      return {ok: true, targetUserId};
    }

    const reverse = db.friendRequests.find(
      (request) =>
        request.fromUserId === targetUserId && request.toUserId === req.user.id && request.status === 'pending'
    );
    if (reverse) {
      reverse.status = 'accepted';
      reverse.acceptedAt = new Date().toISOString();
      createFriendship(db, req.user.id, targetUserId);
      return {accepted: true, targetUserId};
    }

    db.friendRequests.push({
      id: uuid(),
      fromUserId: req.user.id,
      toUserId: targetUserId,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    return {ok: true, targetUserId};
  });

  if (result.error) return res.status(400).json({error: result.error});
  emitFriendsAndUsers(io, [req.user.id, targetUserId]);
  return res.status(201).json(result);
});

app.post('/api/friends/requests/:requestId/accept', authMiddleware, (req, res) => {
  const {requestId} = req.params;
  const result = withDb((db) => {
    const request = db.friendRequests.find((x) => x.id === requestId && x.status === 'pending');
    if (!request || request.toUserId !== req.user.id) {
      return {error: 'Request not found'};
    }
    request.status = 'accepted';
    request.acceptedAt = new Date().toISOString();
    createFriendship(db, request.fromUserId, request.toUserId);
    return {ok: true, fromUserId: request.fromUserId, toUserId: request.toUserId};
  });
  if (result.error) return res.status(404).json({error: result.error});
  emitFriendsAndUsers(io, [result.fromUserId, result.toUserId]);
  return res.json(result);
});

app.post('/api/friends/requests/:requestId/decline', authMiddleware, (req, res) => {
  const {requestId} = req.params;
  const result = withDb((db) => {
    const request = db.friendRequests.find((x) => x.id === requestId && x.status === 'pending');
    if (!request) return {error: 'Request not found'};
    if (request.toUserId !== req.user.id && request.fromUserId !== req.user.id) {
      return {error: 'Request not found'};
    }
    request.status = 'declined';
    request.declinedAt = new Date().toISOString();
    return {ok: true, fromUserId: request.fromUserId, toUserId: request.toUserId};
  });
  if (result.error) return res.status(404).json({error: result.error});
  emitFriendsAndUsers(io, [result.fromUserId, result.toUserId]);
  return res.json(result);
});

app.delete('/api/friends/:userId', authMiddleware, (req, res) => {
  const targetUserId = req.params.userId;
  withDb((db) => {
    db.friendships = db.friendships.filter((friendship) => {
      const ids = friendship.userIds;
      return !(ids.includes(req.user.id) && ids.includes(targetUserId));
    });
  });
  emitFriendsAndUsers(io, [req.user.id, targetUserId]);
  res.json({ok: true});
});

app.get('/api/servers', authMiddleware, (req, res) => {
  const db = readDb();
  const servers = db.servers
    .filter((s) => s.memberIds.includes(req.user.id))
    .map((s) => mapServerForUser(db, s, req.user.id));
  res.json({servers});
});

app.post('/api/servers', authMiddleware, (req, res) => {
  const name = clampText(req.body?.name, 60);
  if (name.length < 2) {
    return res.status(400).json({error: 'Server name must be at least 2 chars'});
  }

  const payload = withDb((db) => {
    const {server, channel} = createServerWithDefaults(db, req.user.id, name);
    return {server, channel};
  });

  return res.status(201).json(payload);
});

app.patch('/api/servers/:serverId', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const body = req.body || {};
  const updated = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};

    const nextName = clampText(body.name || server.name, 60);
    if (nextName.length < 2) return {error: 'Server name must be at least 2 chars'};
    server.name = nextName;
    if (typeof body.tag === 'string') server.tag = clampText(body.tag, 40);
    if (typeof body.description === 'string') server.description = clampText(body.description, 400);
    if (typeof body.iconUrl === 'string') server.iconUrl = String(body.iconUrl).trim().slice(0, 1500000);
    if (typeof body.bannerUrl === 'string') server.bannerUrl = String(body.bannerUrl).trim().slice(0, 1500000);
    if (typeof body.bannerColor === 'string') server.bannerColor = clampText(body.bannerColor, 20) || '#1f2937';
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'server.profile.update',
      details: server.name
    });
    return mapServerForUser(db, server, req.user.id);
  });

  if (updated?.error === 'Forbidden') return res.status(403).json({error: updated.error});
  if (updated?.error) return res.status(400).json({error: updated.error});
  if (!updated) return res.status(404).json({error: 'Server not found'});
  return res.json({server: updated});
});

app.get('/api/servers/:serverId/preferences', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  const preferences = getServerPref(db, req.user.id, serverId);
  return res.json({preferences});
});

app.patch('/api/servers/:serverId/preferences', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const body = req.body || {};
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    const preferences = upsertServerPref(db, req.user.id, serverId, {
      muted: body.muted,
      mentionsOnly: body.mentionsOnly,
      desktopEnabled: body.desktopEnabled,
      soundEnabled: body.soundEnabled
    });
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'server.preferences.update',
      details: `muted=${preferences.muted}, mentionsOnly=${preferences.mentionsOnly}`
    });
    return preferences;
  });
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json({preferences: result});
});

app.get('/api/servers/:serverId/events', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  const events = getServerEvents(db, serverId);
  return res.json({events});
});

app.post('/api/servers/:serverId/events', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const name = clampText(req.body?.name, 80);
  const startsAtRaw = String(req.body?.startsAt || '');
  const description = clampText(req.body?.description, 240);
  if (name.length < 2) return res.status(400).json({error: 'Event name must be at least 2 chars'});
  const startsAt = Number.isNaN(new Date(startsAtRaw).getTime())
    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    : new Date(startsAtRaw).toISOString();

  const event = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageChannels(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const next = {
      id: uuid(),
      serverId,
      name,
      description,
      startsAt,
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    };
    db.serverEvents.push(next);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'server.event.create',
      details: name
    });
    return next;
  });
  if (event?.error) return res.status(403).json({error: event.error});
  if (!event) return res.status(404).json({error: 'Server not found'});
  return res.status(201).json({event});
});

app.delete('/api/servers/:serverId/events/:eventId', authMiddleware, (req, res) => {
  const {serverId, eventId} = req.params;
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageChannels(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const event = db.serverEvents.find((item) => item.id === eventId && item.serverId === serverId);
    if (!event) return {error: 'Not found'};
    db.serverEvents = db.serverEvents.filter((item) => item.id !== eventId);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'server.event.delete',
      details: event.name
    });
    return {ok: true};
  });
  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error) return res.status(404).json({error: 'Event not found'});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json({ok: true});
});

app.get('/api/servers/:serverId/audit', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  if (!canManageServer(db, serverId, req.user.id)) return res.status(403).json({error: 'Forbidden'});
  const audit = mapServerAudit(db, serverId);
  return res.json({audit});
});

app.get('/api/servers/:serverId/bans', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  if (!canManageMembers(db, serverId, req.user.id)) return res.status(403).json({error: 'Forbidden'});
  return res.json({bans: mapServerBans(db, serverId)});
});

app.post('/api/servers/:serverId/bans', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const userId = String(req.body?.userId || '');
  const reason = clampText(req.body?.reason, 200);

  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageMembers(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const target = db.users.find((u) => u.id === userId);
    if (!target) return {error: 'User not found'};
    if (target.id === server.ownerId) return {error: 'Cannot ban server owner'};
    if (target.id === req.user.id) return {error: 'Cannot ban yourself'};
    if (isUserBannedInServer(db, serverId, userId)) return {error: 'Already banned'};

    server.memberIds = server.memberIds.filter((id) => id !== userId);
    db.serverMemberRoles = db.serverMemberRoles.filter((item) => !(item.serverId === serverId && item.userId === userId));

    const ban = {
      id: uuid(),
      serverId,
      userId,
      reason: reason || '',
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    };
    db.serverBans.push(ban);

    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'member.ban',
      details: `${target.username}${reason ? ` | ${reason}` : ''}`
    });
    return ban;
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error) return res.status(400).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  const db = readDb();
  const ban = mapServerBans(db, serverId).find((item) => item.id === result.id) || result;
  return res.status(201).json({ban});
});

app.delete('/api/servers/:serverId/bans/:banId', authMiddleware, (req, res) => {
  const {serverId, banId} = req.params;
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageMembers(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const ban = db.serverBans.find((item) => item.id === banId && item.serverId === serverId);
    if (!ban) return {error: 'Ban not found'};
    db.serverBans = db.serverBans.filter((item) => item.id !== banId);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'member.unban',
      details: ban.userId
    });
    return {ok: true};
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error) return res.status(404).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json(result);
});

app.get('/api/servers/:serverId/integrations', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  if (!canManageServer(db, serverId, req.user.id)) return res.status(403).json({error: 'Forbidden'});
  return res.json({integrations: mapServerIntegrations(db, serverId)});
});

app.post('/api/servers/:serverId/integrations', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const name = clampText(req.body?.name, 80);
  const type = clampText(req.body?.type, 32) || 'webhook';
  const url = clampText(req.body?.url, 220);
  if (name.length < 2) return res.status(400).json({error: 'Integration name must be at least 2 chars'});

  const integration = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const next = {
      id: uuid(),
      serverId,
      name,
      type,
      url: url || '',
      enabled: true,
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    };
    db.serverIntegrations.push(next);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'integration.create',
      details: `${next.type}:${next.name}`
    });
    return next;
  });

  if (integration?.error === 'Forbidden') return res.status(403).json({error: integration.error});
  if (!integration) return res.status(404).json({error: 'Server not found'});
  return res.status(201).json({integration});
});

app.patch('/api/servers/:serverId/integrations/:integrationId', authMiddleware, (req, res) => {
  const {serverId, integrationId} = req.params;
  const body = req.body || {};
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const integration = db.serverIntegrations.find((item) => item.id === integrationId && item.serverId === serverId);
    if (!integration) return {error: 'Integration not found'};
    if (typeof body.name === 'string') integration.name = clampText(body.name, 80) || integration.name;
    if (typeof body.type === 'string') integration.type = clampText(body.type, 32) || integration.type;
    if (typeof body.url === 'string') integration.url = clampText(body.url, 220);
    if (typeof body.enabled === 'boolean') integration.enabled = body.enabled;
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'integration.update',
      details: integration.name
    });
    return integration;
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error) return res.status(404).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json({integration: result});
});

app.delete('/api/servers/:serverId/integrations/:integrationId', authMiddleware, (req, res) => {
  const {serverId, integrationId} = req.params;
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const integration = db.serverIntegrations.find((item) => item.id === integrationId && item.serverId === serverId);
    if (!integration) return {error: 'Integration not found'};
    db.serverIntegrations = db.serverIntegrations.filter((item) => item.id !== integrationId);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'integration.delete',
      details: integration.name
    });
    return {ok: true};
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error) return res.status(404).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json(result);
});

app.get('/api/servers/:serverId/emoji-packs', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) return res.status(404).json({error: 'Server not found'});
  const packs = getServerEmojiPacks(db, serverId).map((item) => ({
    ...item,
    emojis: Array.isArray(item.emojis) ? item.emojis : []
  }));
  return res.json({packs});
});

app.post('/api/servers/:serverId/emoji-packs', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const name = clampText(req.body?.name, 60);
  const emojis = parseEmojiTokens(req.body?.emojis);
  if (name.length < 2) return res.status(400).json({error: 'Pack name must be at least 2 chars'});
  if (!emojis.length) return res.status(400).json({error: 'Emoji pack cannot be empty'});

  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const pack = {
      id: uuid(),
      serverId,
      name,
      emojis,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.serverEmojiPacks.push(pack);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'emoji-pack.create',
      details: `${name} (${emojis.length})`
    });
    return pack;
  });

  if (result?.error) return res.status(403).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.status(201).json({pack: result});
});

app.patch('/api/servers/:serverId/emoji-packs/:packId', authMiddleware, (req, res) => {
  const {serverId, packId} = req.params;
  const body = req.body || {};
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const pack = db.serverEmojiPacks.find((item) => item.id === packId && item.serverId === serverId);
    if (!pack) return {error: 'Not found'};
    if (typeof body.name === 'string') {
      const nextName = clampText(body.name, 60);
      if (nextName.length < 2) return {error: 'Pack name must be at least 2 chars'};
      pack.name = nextName;
    }
    if (body.emojis !== undefined) {
      const nextEmojis = parseEmojiTokens(body.emojis);
      if (!nextEmojis.length) return {error: 'Emoji pack cannot be empty'};
      pack.emojis = nextEmojis;
    }
    pack.updatedAt = new Date().toISOString();
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'emoji-pack.update',
      details: `${pack.name} (${pack.emojis.length})`
    });
    return pack;
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error === 'Not found') return res.status(404).json({error: 'Emoji pack not found'});
  if (result?.error) return res.status(400).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json({pack: result});
});

app.delete('/api/servers/:serverId/emoji-packs/:packId', authMiddleware, (req, res) => {
  const {serverId, packId} = req.params;
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageServer(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const pack = db.serverEmojiPacks.find((item) => item.id === packId && item.serverId === serverId);
    if (!pack) return {error: 'Not found'};
    db.serverEmojiPacks = db.serverEmojiPacks.filter((item) => item.id !== packId);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'emoji-pack.delete',
      details: pack.name
    });
    return {ok: true};
  });

  if (result?.error === 'Forbidden') return res.status(403).json({error: result.error});
  if (result?.error === 'Not found') return res.status(404).json({error: 'Emoji pack not found'});
  if (!result) return res.status(404).json({error: 'Server not found'});
  return res.json(result);
});

app.get('/api/servers/:serverId/channels', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((s) => s.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) {
    return res.status(404).json({error: 'Server not found'});
  }
  const channels = db.channels.filter(
    (c) => c.serverId === serverId && userHasChannelAccess(db, req.user.id, c.id)
  );
  return res.json({channels});
});

app.post('/api/servers/:serverId/channels', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const name = clampText(req.body?.name, 60);
  const kind = req.body?.kind === 'voice' ? 'voice' : 'text';
  const sectionInput = clampText(req.body?.section, 80);
  const section = sectionInput || (kind === 'voice' ? 'VOICE CHANNELS' : 'TEXT CHANNELS');
  if (name.length < 2) {
    return res.status(400).json({error: 'Channel name must be at least 2 chars'});
  }

  const created = withDb((db) => {
    const server = db.servers.find((s) => s.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) {
      return null;
    }
    if (!canManageChannels(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const channel = {
      id: uuid(),
      serverId,
      name,
      topic: '',
      color: '#949ba4',
      kind,
      section,
      isPrivate: false,
      allowedRoleIds: [],
      createdByUserId: req.user.id,
      createdAt: new Date().toISOString()
    };
    db.channels.push(channel);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'channel.create',
      details: `${kind}:${name}`
    });
    return channel;
  });

  if (created?.error) return res.status(403).json({error: created.error});
  if (!created) {
    return res.status(404).json({error: 'Server not found'});
  }
  return res.status(201).json({channel: created});
});

app.patch('/api/channels/:channelId', authMiddleware, (req, res) => {
  const {channelId} = req.params;
  const body = req.body || {};
  const updated = withDb((db) => {
    const channel = db.channels.find((c) => c.id === channelId);
    if (!channel) return null;
    if (!canManageOrOwnChannel(db, channel, req.user.id)) return {error: 'Forbidden'};
    if (typeof body.name === 'string') channel.name = clampText(body.name, 60) || channel.name;
    if (typeof body.topic === 'string') channel.topic = clampText(body.topic, 120);
    if (typeof body.color === 'string') channel.color = clampText(body.color, 20) || channel.color;
    if (typeof body.section === 'string') {
      const nextSection = clampText(body.section, 80);
      channel.section = nextSection || channel.section;
    }
    if (body.kind === 'voice' || body.kind === 'text') {
      channel.kind = body.kind;
      if (!channel.section || !channel.section.trim()) {
        channel.section = channel.kind === 'voice' ? 'VOICE CHANNELS' : 'TEXT CHANNELS';
      }
    }
    if (typeof body.isPrivate === 'boolean') channel.isPrivate = body.isPrivate;
    if (Array.isArray(body.allowedRoleIds)) {
      const roles = getServerRoles(db, channel.serverId).map((role) => role.id);
      channel.allowedRoleIds = body.allowedRoleIds.filter((roleId) => roles.includes(roleId));
    }
    addAuditLog(db, {
      serverId: channel.serverId,
      actorUserId: req.user.id,
      action: 'channel.update',
      details: channel.name
    });
    return channel;
  });
  if (updated?.error) return res.status(403).json({error: updated.error});
  if (!updated) return res.status(404).json({error: 'Channel not found'});
  res.json({channel: updated});
});

app.delete('/api/channels/:channelId', authMiddleware, (req, res) => {
  const {channelId} = req.params;
  const deleted = withDb((db) => {
    const channel = db.channels.find((item) => item.id === channelId);
    if (!channel) return null;
    if (!canManageOrOwnChannel(db, channel, req.user.id)) return {error: 'Forbidden'};

    db.channels = db.channels.filter((item) => item.id !== channelId);
    db.messages = db.messages.filter((item) => item.channelId !== channelId);

    addAuditLog(db, {
      serverId: channel.serverId,
      actorUserId: req.user.id,
      action: 'channel.delete',
      details: `${channel.kind || 'text'}:${channel.name}`
    });

    return {ok: true, channelId, serverId: channel.serverId};
  });

  if (deleted?.error) return res.status(403).json({error: deleted.error});
  if (!deleted) return res.status(404).json({error: 'Channel not found'});
  return res.json(deleted);
});

app.get('/api/servers/:serverId/roles', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) {
    return res.status(404).json({error: 'Server not found'});
  }
  const roles = getServerRoles(db, serverId);
  res.json({roles});
});

app.post('/api/servers/:serverId/roles', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const name = clampText(req.body?.name, 32);
  const color = clampText(req.body?.color, 20) || '#949ba4';
  const permissions = req.body?.permissions || {};
  if (name.length < 2) {
    return res.status(400).json({error: 'Role name must be at least 2 chars'});
  }

  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageRoles(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const role = {
      id: uuid(),
      serverId,
      name,
      color,
      isDefault: false,
      permissions: {
        manageServer: !!permissions.manageServer,
        manageChannels: !!permissions.manageChannels,
        manageMembers: !!permissions.manageMembers,
        manageRoles: !!permissions.manageRoles,
        manageInvites: !!permissions.manageInvites
      },
      createdAt: new Date().toISOString()
    };
    db.serverRoles.push(role);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'role.create',
      details: role.name
    });
    return role;
  });

  if (result?.error) return res.status(403).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  res.status(201).json({role: result});
});

app.patch('/api/servers/:serverId/roles/:roleId', authMiddleware, (req, res) => {
  const {serverId, roleId} = req.params;
  const body = req.body || {};
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageRoles(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const role = db.serverRoles.find((item) => item.id === roleId && item.serverId === serverId);
    if (!role) return null;
    if (role.isDefault) return {error: 'Default role cannot be edited'};
    if (typeof body.name === 'string') role.name = clampText(body.name, 32) || role.name;
    if (typeof body.color === 'string') role.color = clampText(body.color, 20) || role.color;
    if (body.permissions && typeof body.permissions === 'object') {
      role.permissions = {
        manageServer: !!body.permissions.manageServer,
        manageChannels: !!body.permissions.manageChannels,
        manageMembers: !!body.permissions.manageMembers,
        manageRoles: !!body.permissions.manageRoles,
        manageInvites: !!body.permissions.manageInvites
      };
    }
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'role.update',
      details: role.name
    });
    return role;
  });

  if (result?.error) return res.status(400).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Role not found'});
  res.json({role: result});
});

app.delete('/api/servers/:serverId/roles/:roleId', authMiddleware, (req, res) => {
  const {serverId, roleId} = req.params;
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageRoles(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const role = db.serverRoles.find((item) => item.id === roleId && item.serverId === serverId);
    if (!role) return null;
    if (role.isDefault) return {error: 'Default role cannot be deleted'};
    db.serverRoles = db.serverRoles.filter((item) => item.id !== roleId);
    for (const member of db.serverMemberRoles.filter((item) => item.serverId === serverId)) {
      member.roleIds = (member.roleIds || []).filter((id) => id !== roleId);
    }
    for (const channel of db.channels.filter((item) => item.serverId === serverId)) {
      channel.allowedRoleIds = (channel.allowedRoleIds || []).filter((id) => id !== roleId);
    }
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'role.delete',
      details: role.name
    });
    return {ok: true};
  });

  if (result?.error) return res.status(400).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Role not found'});
  res.json(result);
});

app.get('/api/servers/:serverId/members', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) {
    return res.status(404).json({error: 'Server not found'});
  }
  const members = mapServerMembers(db, serverId);
  res.json({members});
});

app.patch('/api/servers/:serverId/members/:memberId', authMiddleware, (req, res) => {
  const {serverId, memberId} = req.params;
  const body = req.body || {};
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageMembers(db, serverId, req.user.id)) return {error: 'Forbidden'};
    if (!server.memberIds.includes(memberId)) return null;
    if (memberId === server.ownerId && req.user.id !== server.ownerId) return {error: 'Cannot edit owner'};

    if (body.kick === true) {
      if (memberId === req.user.id) return {error: 'Cannot kick yourself'};
      const kickedUser = db.users.find((u) => u.id === memberId);
      server.memberIds = server.memberIds.filter((id) => id !== memberId);
      db.serverMemberRoles = db.serverMemberRoles.filter(
        (item) => !(item.serverId === serverId && item.userId === memberId)
      );
      addAuditLog(db, {
        serverId,
        actorUserId: req.user.id,
        action: 'member.kick',
        details: kickedUser?.username || memberId
      });
      return {ok: true, kicked: true};
    }

    if (Array.isArray(body.roleIds)) {
      const validRoles = getServerRoles(db, serverId).map((role) => role.id);
      const defaultRoleId = getServerRoles(db, serverId).find((role) => role.isDefault)?.id;
      let nextRoleIds = body.roleIds.filter((roleId) => validRoles.includes(roleId));
      if (defaultRoleId && !nextRoleIds.includes(defaultRoleId)) nextRoleIds.push(defaultRoleId);
      const entry = db.serverMemberRoles.find((item) => item.serverId === serverId && item.userId === memberId);
      if (entry) entry.roleIds = nextRoleIds;
      else {
        db.serverMemberRoles.push({
          id: uuid(),
          serverId,
          userId: memberId,
          roleIds: nextRoleIds,
          createdAt: new Date().toISOString()
        });
      }
      addAuditLog(db, {
        serverId,
        actorUserId: req.user.id,
        action: 'member.roles.update',
        details: memberId
      });
      return {ok: true, roleIds: nextRoleIds};
    }
    return {ok: true};
  });

  if (result?.error) return res.status(400).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Member not found'});
  res.json(result);
});

app.post('/api/servers/:serverId/invites', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const maxUses = Number(req.body?.maxUses || 0);
  const expiresInHours = Number(req.body?.expiresInHours || 0);
  const result = withDb((db) => {
    const server = db.servers.find((item) => item.id === serverId);
    if (!server || !server.memberIds.includes(req.user.id)) return null;
    if (!canManageInvites(db, serverId, req.user.id)) return {error: 'Forbidden'};
    const invite = {
      id: uuid(),
      serverId,
      code: createInviteCode(),
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      uses: 0,
      maxUses: Number.isFinite(maxUses) && maxUses > 0 ? Math.floor(maxUses) : 0,
      expiresAt: Number.isFinite(expiresInHours) && expiresInHours > 0
        ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
        : null
    };
    db.serverInvites.push(invite);
    addAuditLog(db, {
      serverId,
      actorUserId: req.user.id,
      action: 'invite.create',
      details: invite.code
    });
    return invite;
  });

  if (result?.error) return res.status(403).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Server not found'});
  res.status(201).json({invite: result});
});

app.get('/api/servers/:serverId/invites', authMiddleware, (req, res) => {
  const {serverId} = req.params;
  const db = readDb();
  const server = db.servers.find((item) => item.id === serverId);
  if (!server || !server.memberIds.includes(req.user.id)) {
    return res.status(404).json({error: 'Server not found'});
  }
  if (!canManageInvites(db, serverId, req.user.id)) {
    return res.status(403).json({error: 'Forbidden'});
  }
  const invites = db.serverInvites.filter((item) => item.serverId === serverId && isInviteActive(item));
  res.json({invites});
});

app.delete('/api/invites/:inviteId', authMiddleware, (req, res) => {
  const {inviteId} = req.params;
  const result = withDb((db) => {
    const invite = db.serverInvites.find((item) => item.id === inviteId);
    if (!invite) return null;
    if (!canManageInvites(db, invite.serverId, req.user.id)) return {error: 'Forbidden'};
    addAuditLog(db, {
      serverId: invite.serverId,
      actorUserId: req.user.id,
      action: 'invite.delete',
      details: invite.code
    });
    db.serverInvites = db.serverInvites.filter((item) => item.id !== inviteId);
    return {ok: true};
  });
  if (result?.error) return res.status(403).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Invite not found'});
  res.json(result);
});

app.get('/api/invites/:code', authMiddleware, (req, res) => {
  const {code} = req.params;
  const db = readDb();
  const invite = db.serverInvites.find((item) => item.code === code);
  if (!invite || !isInviteActive(invite)) return res.status(404).json({error: 'Invite not found'});
  const server = db.servers.find((item) => item.id === invite.serverId);
  if (!server) return res.status(404).json({error: 'Server not found'});
  res.json({invite, server: {id: server.id, name: server.name}});
});

app.post('/api/invites/:code/join', authMiddleware, (req, res) => {
  const {code} = req.params;
  const result = withDb((db) => {
    const invite = db.serverInvites.find((item) => item.code === code);
    if (!invite || !isInviteActive(invite)) return null;
    const server = db.servers.find((item) => item.id === invite.serverId);
    if (!server) return null;
    if (isUserBannedInServer(db, server.id, req.user.id)) return {error: 'You are banned from this server'};
    if (!server.memberIds.includes(req.user.id)) {
      addMemberToServer(db, server.id, req.user.id);
      invite.uses += 1;
    }
    return {serverId: server.id};
  });

  if (result?.error) return res.status(403).json({error: result.error});
  if (!result) return res.status(404).json({error: 'Invite not found'});
  const db = readDb();
  const server = db.servers.find((item) => item.id === result.serverId);
  res.json({server: mapServerForUser(db, server, req.user.id)});
});

app.get('/api/channels/:channelId/messages', authMiddleware, (req, res) => {
  const {channelId} = req.params;
  const db = readDb();
  if (!userHasChannelAccess(db, req.user.id, channelId)) {
    return res.status(403).json({error: 'Forbidden'});
  }
  const channel = db.channels.find((item) => item.id === channelId);
  if (!channel) return res.status(404).json({error: 'Channel not found'});
  if (channel.kind === 'voice') return res.json({messages: []});

  const messages = db.messages
    .filter((m) => m.channelId === channelId && !isMessageDeletedForUser(m, req.user.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((item) => normalizeMessage({...item}));
  return res.json({messages});
});

app.post('/api/channels/:channelId/messages', authMiddleware, (req, res) => {
  const {channelId} = req.params;
  const payload = sanitizeMessageInput(req.body || {});
  if (!payload) {
    return res.status(400).json({error: 'Message is empty'});
  }

  const created = withDb((db) => {
    if (!userHasChannelAccess(db, req.user.id, channelId)) {
      return null;
    }
    const channel = db.channels.find((item) => item.id === channelId);
    if (!channel || channel.kind === 'voice') {
      return {error: 'Cannot send text to voice channel'};
    }
    const message = {
      id: uuid(),
      channelId,
      userId: req.user.id,
      username: req.user.username,
      content: payload.content,
      attachments: payload.attachments,
      replyToId: payload.replyToId,
      forwardedFrom: payload.forwardedFrom,
      reactions: {},
      deletedFor: [],
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    return message;
  });

  if (created?.error) return res.status(400).json({error: created.error});
  if (!created) {
    return res.status(403).json({error: 'Forbidden'});
  }
  io.to(`channel:${channelId}`).emit('message:new', normalizeMessage(created));
  return res.status(201).json({message: created});
});

app.get('/api/dms', authMiddleware, (req, res) => {
  const db = readDb();
  const dms = mapDmListForUser(db, req.user.id);
  res.json({dms});
});

app.post('/api/dms', authMiddleware, (req, res) => {
  const targetUserId = String(req.body?.targetUserId || '');
  const db = readDb();
  const target = db.users.find((u) => u.id === targetUserId);
  if (!target || target.id === req.user.id) {
    return res.status(400).json({error: 'Invalid DM target'});
  }
  if (!areFriends(db, req.user.id, targetUserId)) {
    return res.status(403).json({error: 'You can open DM only with friends'});
  }

  const dm = getOrCreateDmChannel(req.user.id, targetUserId);
  const nextDb = readDb();
  const dmForCurrent = mapDmForUser(nextDb, dm, req.user.id);
  const dmForTarget = mapDmForUser(nextDb, dm, targetUserId);
  emitToUser(io, req.user.id, 'dm:created', {dm: dmForCurrent});
  emitToUser(io, targetUserId, 'dm:created', {dm: dmForTarget});
  emitToUser(io, req.user.id, 'dms:update', {dms: mapDmListForUser(nextDb, req.user.id)});
  emitToUser(io, targetUserId, 'dms:update', {dms: mapDmListForUser(nextDb, targetUserId)});
  return res.status(201).json({dm: dmForCurrent});
});

app.get('/api/dms/:dmId/messages', authMiddleware, (req, res) => {
  const {dmId} = req.params;
  const db = readDb();
  if (!userHasDmAccess(db, req.user.id, dmId)) {
    return res.status(403).json({error: 'Forbidden'});
  }
  const messages = db.dmMessages
    .filter((m) => m.dmChannelId === dmId && !isMessageDeletedForUser(m, req.user.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((item) => normalizeMessage({...item}));
  res.json({messages});
});

app.post('/api/dms/:dmId/messages', authMiddleware, (req, res) => {
  const {dmId} = req.params;
  const payload = sanitizeMessageInput(req.body || {});
  if (!payload) {
    return res.status(400).json({error: 'Message is empty'});
  }

  const message = withDb((db) => {
    if (!userHasDmAccess(db, req.user.id, dmId)) {
      return null;
    }
    const nextMessage = {
      id: uuid(),
      dmChannelId: dmId,
      userId: req.user.id,
      username: req.user.username,
      content: payload.content,
      attachments: payload.attachments,
      replyToId: payload.replyToId,
      forwardedFrom: payload.forwardedFrom,
      reactions: {},
      deletedFor: [],
      createdAt: new Date().toISOString()
    };
    db.dmMessages.push(nextMessage);
    return nextMessage;
  });

  if (!message) {
    return res.status(403).json({error: 'Forbidden'});
  }

  io.to(`dm:${dmId}`).emit('dm:new', normalizeMessage(message));
  const dbAfter = readDb();
  const dmChannel = dbAfter.dmChannels.find((x) => x.id === dmId);
  if (dmChannel?.userIds?.length) {
    for (const userId of dmChannel.userIds) {
      emitToUser(io, userId, 'dms:update', {dms: mapDmListForUser(dbAfter, userId)});
    }
  }
  return res.status(201).json({message});
});

app.delete('/api/channels/:channelId/messages/:messageId', authMiddleware, (req, res) => {
  const {channelId, messageId} = req.params;
  const forEveryone = !!req.body?.forEveryone;

  const result = withDb((db) => {
    if (!userHasChannelAccess(db, req.user.id, channelId)) {
      return {error: 'Forbidden', status: 403};
    }
    const idx = db.messages.findIndex((item) => item.id === messageId && item.channelId === channelId);
    if (idx < 0) {
      return {error: 'Message not found', status: 404};
    }
    const message = db.messages[idx];
    normalizeMessage(message);
    if (forEveryone) {
      if (message.userId !== req.user.id) {
        return {error: 'You can delete for everyone only your own messages', status: 403};
      }
      db.messages.splice(idx, 1);
      return {messageId, channelId, forEveryone: true};
    }
    if (!message.deletedFor.includes(req.user.id)) {
      message.deletedFor.push(req.user.id);
    }
    return {messageId, channelId, forEveryone: false};
  });

  if (result?.error) return res.status(result.status || 400).json({error: result.error});
  if (result.forEveryone) {
    io.to(`channel:${channelId}`).emit('message:delete', {messageId, channelId});
  } else {
    emitToUser(io, req.user.id, 'message:delete', {messageId, channelId});
  }
  return res.json({ok: true, ...result});
});

app.delete('/api/dms/:dmId/messages/:messageId', authMiddleware, (req, res) => {
  const {dmId, messageId} = req.params;
  const forEveryone = !!req.body?.forEveryone;

  const result = withDb((db) => {
    if (!userHasDmAccess(db, req.user.id, dmId)) {
      return {error: 'Forbidden', status: 403};
    }
    const dm = db.dmChannels.find((item) => item.id === dmId);
    if (!dm) return {error: 'DM not found', status: 404};
    const idx = db.dmMessages.findIndex((item) => item.id === messageId && item.dmChannelId === dmId);
    if (idx < 0) {
      return {error: 'Message not found', status: 404};
    }
    const message = db.dmMessages[idx];
    normalizeMessage(message);
    if (forEveryone) {
      if (message.userId !== req.user.id) {
        return {error: 'You can delete for everyone only your own messages', status: 403};
      }
      db.dmMessages.splice(idx, 1);
      return {messageId, dmId, forEveryone: true, userIds: [...dm.userIds]};
    }
    if (!message.deletedFor.includes(req.user.id)) {
      message.deletedFor.push(req.user.id);
    }
    return {messageId, dmId, forEveryone: false, userIds: [...dm.userIds]};
  });

  if (result?.error) return res.status(result.status || 400).json({error: result.error});
  if (result.forEveryone) {
    io.to(`dm:${dmId}`).emit('dm:delete', {messageId, dmChannelId: dmId});
    const dbAfter = readDb();
    for (const userId of result.userIds || []) {
      emitToUser(io, userId, 'dms:update', {dms: mapDmListForUser(dbAfter, userId)});
    }
  } else {
    emitToUser(io, req.user.id, 'dm:delete', {messageId, dmChannelId: dmId});
    const dbAfter = readDb();
    emitToUser(io, req.user.id, 'dms:update', {dms: mapDmListForUser(dbAfter, req.user.id)});
  }
  return res.json({ok: true, ...result});
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const socketCallRooms = new Map();

function roomKey(scopeType, scopeId) {
  return `${scopeType}:${scopeId}`;
}

function parseRoomKey(key) {
  const idx = key.indexOf(':');
  if (idx < 0) return null;
  return {scopeType: key.slice(0, idx), scopeId: key.slice(idx + 1)};
}

function getCallState(ioServer, scopeType, scopeId) {
  const room = `call:${roomKey(scopeType, scopeId)}`;
  const sockets = Array.from(ioServer.sockets.adapter.rooms.get(room) || [])
    .map((id) => ioServer.sockets.sockets.get(id))
    .filter(Boolean);
  const uniq = new Map();
  for (const item of sockets) {
    const socketUser = item.data?.user;
    if (socketUser?.id && !uniq.has(socketUser.id)) {
      uniq.set(socketUser.id, {userId: socketUser.id, username: socketUser.username});
    }
  }
  return Array.from(uniq.values());
}

function emitCallState(ioServer, scopeType, scopeId) {
  ioServer.emit('call:state', {
    scopeType,
    scopeId,
    users: getCallState(ioServer, scopeType, scopeId)
  });
}

function addUserSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}

function removeUserSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) userSockets.delete(userId);
}

function emitToUser(ioServer, userId, eventName, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const socketId of sockets) {
    ioServer.to(socketId).emit(eventName, payload);
  }
}

function emitFriendsAndUsers(ioServer, userIds) {
  const uniqUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!uniqUserIds.length) return;
  const db = readDb();
  for (const userId of uniqUserIds) {
    emitToUser(ioServer, userId, 'friends:update', {friends: getFriendPayload(db, userId)});
    emitToUser(ioServer, userId, 'users:update', {users: mapUsersForViewer(db, userId)});
    emitToUser(ioServer, userId, 'dms:update', {dms: mapDmListForUser(db, userId)});
  }
}

function ensureCallMediaRoom(key) {
  let roomState = callMediaState.get(key);
  if (!roomState) {
    roomState = new Map();
    callMediaState.set(key, roomState);
  }
  return roomState;
}

function normalizeMediaState(raw = {}) {
  return {
    micMuted: !!raw.micMuted,
    speakerMuted: !!raw.speakerMuted,
    cameraOn: !!raw.cameraOn,
    screenOn: !!raw.screenOn
  };
}

function roomScreenShareCount(key) {
  const roomState = callMediaState.get(key);
  if (!roomState) return 0;
  let total = 0;
  for (const state of roomState.values()) {
    if (state?.screenOn) total += 1;
  }
  return total;
}

function emitCallMediaState(ioServer, scopeType, scopeId) {
  const key = roomKey(scopeType, scopeId);
  const roomState = callMediaState.get(key) || new Map();
  const states = Array.from(roomState.entries()).map(([socketId, state]) => ({
    socketId,
    ...state
  }));
  ioServer.to(`call:${key}`).emit('call:media', {scopeType, scopeId, states});
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    const payload = verifyToken(token);
    const db = readDb();
    const user = db.users.find((u) => u.id === payload.userId);
    if (!user) {
      return next(new Error('Unauthorized'));
    }
    socket.data.user = normalizeUser(user);
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socketCallRooms.set(socket.id, new Set());
  addUserSocket(user.id, socket.id);
  onlineUsers.add(user.id);
  io.emit('presence:update', {onlineUserIds: Array.from(onlineUsers)});
  emitFriendsAndUsers(io, [user.id]);

  socket.on('join:channel', ({channelId}) => {
    if (!channelId) return;
    const db = readDb();
    if (!userHasChannelAccess(db, user.id, channelId)) return;
    socket.join(`channel:${channelId}`);
  });

  socket.on('leave:channel', ({channelId}) => {
    if (!channelId) return;
    socket.leave(`channel:${channelId}`);
  });

  socket.on('join:dm', ({dmChannelId}) => {
    if (!dmChannelId) return;
    const db = readDb();
    if (!userHasDmAccess(db, user.id, dmChannelId)) return;
    socket.join(`dm:${dmChannelId}`);
  });

  socket.on('leave:dm', ({dmChannelId}) => {
    if (!dmChannelId) return;
    socket.leave(`dm:${dmChannelId}`);
  });

  socket.on('message:create', (raw = {}) => {
    const channelId = String(raw.channelId || '');
    const payload = sanitizeMessageInput(raw);
    if (!channelId || !payload) return;

    const message = withDb((db) => {
      if (!userHasChannelAccess(db, user.id, channelId)) return null;
      const channel = db.channels.find((item) => item.id === channelId);
      if (!channel || channel.kind === 'voice') return null;
      const nextMessage = {
        id: uuid(),
        channelId,
        userId: user.id,
        username: user.username,
        content: payload.content,
        attachments: payload.attachments,
        replyToId: payload.replyToId,
        forwardedFrom: payload.forwardedFrom,
        reactions: {},
        deletedFor: [],
        createdAt: new Date().toISOString()
      };
      db.messages.push(nextMessage);
      return nextMessage;
    });

    if (!message) return;
    io.to(`channel:${channelId}`).emit('message:new', normalizeMessage(message));
  });

  socket.on('dm:create', (raw = {}) => {
    const dmChannelId = String(raw.dmChannelId || '');
    const payload = sanitizeMessageInput(raw);
    if (!dmChannelId || !payload) return;

    const message = withDb((db) => {
      if (!userHasDmAccess(db, user.id, dmChannelId)) return null;
      const nextMessage = {
        id: uuid(),
        dmChannelId,
        userId: user.id,
        username: user.username,
        content: payload.content,
        attachments: payload.attachments,
        replyToId: payload.replyToId,
        forwardedFrom: payload.forwardedFrom,
        reactions: {},
        deletedFor: [],
        createdAt: new Date().toISOString()
      };
      db.dmMessages.push(nextMessage);
      return nextMessage;
    });

    if (!message) return;
    io.to(`dm:${dmChannelId}`).emit('dm:new', normalizeMessage(message));
    const dbAfter = readDb();
    const dmChannel = dbAfter.dmChannels.find((x) => x.id === dmChannelId);
    if (!dmChannel?.userIds?.length) return;
    for (const userId of dmChannel.userIds) {
      emitToUser(io, userId, 'dms:update', {dms: mapDmListForUser(dbAfter, userId)});
    }
  });

  socket.on('message:reaction:toggle', ({channelId, messageId, emoji}) => {
    if (!channelId || !messageId) return;
    const updated = withDb((db) => {
      if (!userHasChannelAccess(db, user.id, channelId)) return null;
      const message = db.messages.find((m) => m.id === messageId && m.channelId === channelId);
      if (!message) return null;
      toggleReaction(message, user.id, emoji);
      return normalizeMessage(message);
    });
    if (!updated) return;
    io.to(`channel:${channelId}`).emit('message:update', updated);
  });

  socket.on('dm:reaction:toggle', ({dmChannelId, messageId, emoji}) => {
    if (!dmChannelId || !messageId) return;
    const updated = withDb((db) => {
      if (!userHasDmAccess(db, user.id, dmChannelId)) return null;
      const message = db.dmMessages.find((m) => m.id === messageId && m.dmChannelId === dmChannelId);
      if (!message) return null;
      toggleReaction(message, user.id, emoji);
      return normalizeMessage(message);
    });
    if (!updated) return;
    io.to(`dm:${dmChannelId}`).emit('dm:update', updated);
  });

  socket.on('dm-call:invite', ({dmChannelId}) => {
    if (!dmChannelId) return;
    const db = readDb();
    const dm = db.dmChannels.find((item) => item.id === dmChannelId);
    if (!dm || !dm.userIds.includes(user.id)) return;
    const toUserId = dm.userIds.find((id) => id !== user.id);
    if (!toUserId) return;
    const callId = uuid();
    const from = db.users.find((item) => item.id === user.id);
    pendingDmCalls.set(callId, {
      callId,
      dmChannelId,
      fromUserId: user.id,
      toUserId,
      createdAt: Date.now()
    });
    socket.emit('dm-call:ringing', {callId, dmChannelId, toUserId});
    emitToUser(io, toUserId, 'dm-call:incoming', {
      callId,
      dmChannelId,
      fromUser: from ? normalizeUser(from) : {id: user.id, username: user.username}
    });
  });

  socket.on('dm-call:accept', ({callId}) => {
    const pending = pendingDmCalls.get(callId);
    if (!pending) return;
    if (pending.toUserId !== user.id) return;
    pendingDmCalls.delete(callId);
    const db = readDb();
    const by = db.users.find((item) => item.id === user.id);
    const from = db.users.find((item) => item.id === pending.fromUserId);
    emitToUser(io, pending.fromUserId, 'dm-call:accepted', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId,
      byUser: by ? normalizeUser(by) : {id: user.id, username: user.username},
      peerUser: by ? normalizeUser(by) : {id: user.id, username: user.username}
    });
    emitToUser(io, pending.toUserId, 'dm-call:accepted', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId,
      byUser: by ? normalizeUser(by) : {id: user.id, username: user.username},
      peerUser: from ? normalizeUser(from) : {id: pending.fromUserId, username: ''}
    });
  });

  socket.on('dm-call:reject', ({callId}) => {
    const pending = pendingDmCalls.get(callId);
    if (!pending) return;
    if (pending.toUserId !== user.id && pending.fromUserId !== user.id) return;
    pendingDmCalls.delete(callId);
    const rejectedBy = user.id;
    emitToUser(io, pending.fromUserId, 'dm-call:rejected', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId,
      byUserId: rejectedBy
    });
    emitToUser(io, pending.toUserId, 'dm-call:rejected', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId,
      byUserId: rejectedBy
    });
  });

  socket.on('dm-call:cancel', ({callId}) => {
    const pending = pendingDmCalls.get(callId);
    if (!pending) return;
    if (pending.fromUserId !== user.id) return;
    pendingDmCalls.delete(callId);
    emitToUser(io, pending.fromUserId, 'dm-call:canceled', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId
    });
    emitToUser(io, pending.toUserId, 'dm-call:canceled', {
      callId: pending.callId,
      dmChannelId: pending.dmChannelId
    });
  });

  socket.on('call:join', ({scopeType, scopeId}) => {
    if (!scopeType || !scopeId) return;
    const db = readDb();
    if (!userHasCallAccess(db, user.id, scopeType, scopeId)) return;

    const key = roomKey(scopeType, scopeId);
    const room = `call:${key}`;
    const roomState = ensureCallMediaRoom(key);
    const existingSockets = Array.from(io.sockets.adapter.rooms.get(room) || [])
      .filter((id) => id !== socket.id)
      .map((id) => {
        const other = io.sockets.sockets.get(id);
        return other ? {socketId: id, user: other.data.user, media: roomState.get(id) || normalizeMediaState()} : null;
      })
      .filter(Boolean);

    socket.join(room);
    socketCallRooms.get(socket.id)?.add(key);
    roomState.set(socket.id, normalizeMediaState());
    socket.emit('call:participants', {scopeType, scopeId, participants: existingSockets});
    socket.to(room).emit('call:user-joined', {
      scopeType,
      scopeId,
      socketId: socket.id,
      user,
      media: roomState.get(socket.id) || normalizeMediaState()
    });
    emitCallMediaState(io, scopeType, scopeId);
    emitCallState(io, scopeType, scopeId);
  });

  socket.on('call:media:update', ({scopeType, scopeId, media}) => {
    if (!scopeType || !scopeId) return;
    const db = readDb();
    if (!userHasCallAccess(db, user.id, scopeType, scopeId)) return;
    const key = roomKey(scopeType, scopeId);
    const room = `call:${key}`;
    if (!socket.rooms.has(room)) return;
    const roomState = ensureCallMediaRoom(key);
    const nextMedia = normalizeMediaState(media);
    const prev = roomState.get(socket.id) || normalizeMediaState();
    const tryingEnableScreen = !!nextMedia.screenOn && !prev.screenOn;
    if (tryingEnableScreen) {
      const currentScreens = roomScreenShareCount(key);
      if (currentScreens >= MAX_SCREEN_SHARES) {
        socket.emit('call:media:rejected', {
          scopeType,
          scopeId,
          reason: 'screen_limit',
          max: MAX_SCREEN_SHARES
        });
        return;
      }
    }
    roomState.set(socket.id, nextMedia);
    emitCallMediaState(io, scopeType, scopeId);
  });

  socket.on('call:signal', ({scopeType, scopeId, targetSocketId, signal}) => {
    if (!scopeType || !scopeId || !targetSocketId || !signal) return;
    const db = readDb();
    if (!userHasCallAccess(db, user.id, scopeType, scopeId)) return;
    io.to(targetSocketId).emit('call:signal', {
      scopeType,
      scopeId,
      fromSocketId: socket.id,
      signal,
      user
    });
  });

  socket.on('call:leave', ({scopeType, scopeId}) => {
    if (!scopeType || !scopeId) return;
    const key = roomKey(scopeType, scopeId);
    const room = `call:${key}`;
    socket.leave(room);
    socketCallRooms.get(socket.id)?.delete(key);
    const roomState = callMediaState.get(key);
    if (roomState) {
      roomState.delete(socket.id);
      if (!roomState.size) callMediaState.delete(key);
    }
    socket.to(room).emit('call:user-left', {scopeType, scopeId, socketId: socket.id});
    emitCallMediaState(io, scopeType, scopeId);
    emitCallState(io, scopeType, scopeId);
  });

  socket.on('call:state:sync', () => {
    const keys = new Set();
    for (const room of io.sockets.adapter.rooms.keys()) {
      if (!room.startsWith('call:')) continue;
      const parsed = parseRoomKey(room.slice(5));
      if (!parsed) continue;
      keys.add(`${parsed.scopeType}:${parsed.scopeId}`);
    }
    for (const key of keys) {
      const parsed = parseRoomKey(key);
      if (!parsed) continue;
      socket.emit('call:state', {
        scopeType: parsed.scopeType,
        scopeId: parsed.scopeId,
        users: getCallState(io, parsed.scopeType, parsed.scopeId)
      });
      const roomState = callMediaState.get(key) || new Map();
      const states = Array.from(roomState.entries()).map(([socketId, media]) => ({socketId, ...media}));
      socket.emit('call:media', {scopeType: parsed.scopeType, scopeId: parsed.scopeId, states});
    }
  });

  socket.on('disconnect', () => {
    const joined = socketCallRooms.get(socket.id) || new Set();
    for (const key of joined) {
      const parsed = parseRoomKey(key);
      if (!parsed) continue;
      const {scopeType, scopeId} = parsed;
      const room = `call:${key}`;
      const roomState = callMediaState.get(key);
      if (roomState) {
        roomState.delete(socket.id);
        if (!roomState.size) callMediaState.delete(key);
      }
      socket.to(room).emit('call:user-left', {scopeType, scopeId, socketId: socket.id});
      emitCallMediaState(io, scopeType, scopeId);
      emitCallState(io, scopeType, scopeId);
    }
    const hasAnotherSession = Array.from(io.sockets.sockets.values()).some(
      (item) => item.id !== socket.id && item.data?.user?.id === user.id
    );
    removeUserSocket(user.id, socket.id);
    const stale = [];
    for (const [callId, pending] of pendingDmCalls.entries()) {
      if (pending.fromUserId === user.id || pending.toUserId === user.id) stale.push(callId);
    }
    for (const callId of stale) {
      const pending = pendingDmCalls.get(callId);
      if (!pending) continue;
      pendingDmCalls.delete(callId);
      emitToUser(io, pending.fromUserId, 'dm-call:canceled', {
        callId: pending.callId,
        dmChannelId: pending.dmChannelId
      });
      emitToUser(io, pending.toUserId, 'dm-call:canceled', {
        callId: pending.callId,
        dmChannelId: pending.dmChannelId
      });
    }
    if (!hasAnotherSession) {
      onlineUsers.delete(user.id);
      io.emit('presence:update', {onlineUserIds: Array.from(onlineUsers)});
    }
    socketCallRooms.delete(socket.id);
  });
});

const purgedDemoUsers = purgeLegacyDemoUsers();
if (purgedDemoUsers > 0) {
  console.log(`[yooh-playmode] removed ${purgedDemoUsers} legacy demo user(s).`);
}
const purgedDemoServers = purgeLegacyDemoServers();
if (purgedDemoServers > 0) {
  console.log(`[yooh-playmode] removed ${purgedDemoServers} legacy demo server(s).`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[metior-local-backend] listening on http://0.0.0.0:${PORT}`);
});
