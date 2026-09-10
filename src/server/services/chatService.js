import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { CHAT_ROLES, CHAT_TYPES } from "../constants.js";
import { HttpError } from "../errors.js";
import {
  canViewerInviteTarget,
  canViewerSendDirectMessage,
  canViewerSendVoiceToTarget,
  getPublicUserForViewer,
} from "./privacyRules.js";
import { byteLength, hashPhone, isValidGroupTitle, monthKey, normalizePhone, normalizePublicHandle, nowIso, trimText } from "../utils.js";

const chatSettingsSchema = z
  .object({
    allowMemberInvites: z.boolean().optional(),
    reactionsEnabled: z.boolean().optional(),
    allowedReactions: z.array(z.string().min(1).max(32)).max(64).optional(),
    commentsEnabled: z.boolean().optional(),
    hideParticipants: z.boolean().optional(),
    translateEnabled: z.boolean().optional(),
    signMessages: z.boolean().optional(),
    joinRequestsEnabled: z.boolean().optional(),
    restrictContentSaving: z.boolean().optional(),
    topicsEnabled: z.boolean().optional(),
    topicDisplayMode: z.string().min(1).max(32).optional(),
    autoDeleteDays: z.number().int().min(0).max(365).optional(),
    wallpaperPreset: z.string().max(64).optional(),
    wallpaper: z.string().max(15_000_000).optional(),
    wallpaperBlur: z.number().int().min(0).max(100).optional(),
    wallpaperDim: z.number().int().min(0).max(100).optional(),
    permissions: z
      .object({
        sendMessages: z.boolean().optional(),
        addMembers: z.boolean().optional(),
        pinMessages: z.boolean().optional(),
        changeChatProfile: z.boolean().optional(),
        slowModeSeconds: z.number().int().min(0).max(3600).optional(),
        media: z
          .object({
            photos: z.boolean().optional(),
            videos: z.boolean().optional(),
            videoMessages: z.boolean().optional(),
            music: z.boolean().optional(),
            voiceMessages: z.boolean().optional(),
            files: z.boolean().optional(),
            stickersGifs: z.boolean().optional(),
            linkPreviews: z.boolean().optional(),
            polls: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    stylePreset: z.string().min(1).max(32).optional(),
  })
  .optional();

const createChatSchema = z
  .object({
    type: z.enum(CHAT_TYPES),
    title: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    avatar: z.string().max(2_500_000).optional(),
    memberIds: z.array(z.string().min(1)).optional(),
    memberId: z.string().min(1).optional(),
    memberUsername: z.string().min(5).max(32).optional(),
    isPublic: z.boolean().optional(),
    handle: z.string().min(5).max(32).optional(),
    interfaceMode: z.enum(["chat", "game"]).optional(),
    settings: chatSettingsSchema,
  })
  .refine((value) => value.type !== "direct" || value.memberId || value.memberUsername, {
    message: "Direct chat requires memberId or memberUsername",
  });

const locationPayloadSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  title: z.string().max(160).optional(),
  address: z.string().max(260).optional(),
  mapUrl: z.string().max(2000).optional(),
});

const pollPayloadSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(12),
  anonymous: z.boolean().optional(),
  multiple: z.boolean().optional(),
  quiz: z.boolean().optional(),
  correctOptionIndex: z.number().int().min(0).max(11).nullable().optional(),
});

const createMessageSchema = z.object({
  kind: z.enum(["text", "location", "poll"]).optional(),
  text: z.string().max(4000).optional(),
  location: locationPayloadSchema.optional(),
  poll: pollPayloadSchema.optional(),
  replyToMessageId: z.string().min(1).optional(),
  threadRootId: z.string().min(1).optional(),
  clientMessageId: z.string().min(8).max(128).optional(),
  // Optional future ISO timestamp: the message stays hidden until due,
  // then a scheduler publishes it (realtime + history). Validated below.
  scheduledAt: z.string().max(64).optional(),
});

const pollVoteSchema = z.object({
  optionIds: z.array(z.string().min(1)).max(12),
});

const updateChatSchema = z
  .object({
    title: z.string().max(120).optional(),
    description: z.union([z.string().max(500), z.null()]).optional(),
    avatar: z.union([z.string().max(2_500_000), z.null()]).optional(),
    isPublic: z.boolean().optional(),
    handle: z.union([z.string().max(32), z.null()]).optional(),
    settings: chatSettingsSchema,
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one chat field must be provided",
  });

const sendFilePayloadSchema = z.object({
  text: z.string().max(4000).optional(),
  stream: z.enum(["main", "comment"]).optional(),
  replyToMessageId: z.string().min(1).optional(),
  threadRootId: z.string().min(1).optional(),
  clientMessageId: z.string().min(8).max(128).optional(),
});

const memberPayloadSchema = z
  .object({
    memberId: z.string().min(1).optional(),
    memberUsername: z.string().min(2).max(64).optional(),
  })
  .refine((value) => value.memberId || value.memberUsername, {
    message: "Member payload requires memberId or memberUsername",
  });

const feedbackTicketSchema = z.object({
  category: z.enum(["bug", "improvement", "wish"]),
  message: z.string().min(1).max(4000),
});

const supportTicketCategorySchema = z.enum(["bug", "idea", "account", "other"]);

const supportTicketCreateSchema = z.object({
  category: supportTicketCategorySchema,
});

const supportTicketReplySchema = z.object({
  text: z.string().min(1).max(4000),
});

const editMessageSchema = z.object({
  text: z.string().max(4000),
});

const forwardMessageSchema = z.object({
  targetChatId: z.string().min(1),
  stream: z.enum(["main", "comment"]).optional(),
});

const stickerPackStickerSchema = z.object({
  emoji: z.string().min(1).max(24),
  label: z.string().min(1).max(64).optional(),
  image: z.string().max(2_500_000).optional(),
  keywords: z.array(z.string().min(1).max(24)).max(12).optional(),
});

const createStickerPackSchema = z.object({
  title: z.string().min(2).max(64),
  description: z.string().max(240).optional(),
  coverEmoji: z.string().max(24).optional(),
  stickers: z.array(stickerPackStickerSchema).min(3).max(120),
  published: z.boolean().optional(),
});

const storySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  caption: z.string().max(2048).optional(),
  avatar: z.string().max(2_500_000).optional(),
  image: z.string().max(15_000_000).optional(),
  video: z.string().max(25_000_000).optional(),
  mediaType: z.enum(["image", "video"]).optional(),
  background: z.string().max(64).optional(),
  privacy: z.enum(["everyone", "contacts", "close-friends", "selected"]).optional(),
  selectedUsers: z.string().max(1000).optional(),
  exceptions: z.string().max(1000).optional(),
  disableScreenshots: z.boolean().optional(),
  expiresHours: z.number().int().min(6).max(48).optional(),
  saveToProfile: z.boolean().optional(),
  isLive: z.boolean().optional(),
  liveCommentPrice: z.number().int().min(0).max(10000).optional(),
});

const adminStoryBroadcastSchema = z.object({
  text: z.string().min(1).max(2048),
  background: z.string().max(64).optional(),
  expiresHours: z.number().int().min(6).max(48).optional(),
});

const storyReactionSchema = z.object({
  emoji: z.string().max(16).optional(),
});

const storyCommentSchema = z.object({
  text: z.string().min(1).max(280),
});

const storyViewSchema = z.object({
  stealth: z.boolean().optional(),
});

const roleSchema = z.enum(CHAT_ROLES);
const streamSchema = z.enum(["main", "comment"]);
const CALL_MODES = new Set(["audio", "video"]);
const ERROR_LOG_SOURCES = new Set(["client", "server"]);
const ERROR_LOG_MAX_ENTRIES = 3000;

function isActive(expiresAt) {
  if (!expiresAt) {
    return true;
  }
  return new Date(expiresAt).getTime() > Date.now();
}

function enforceMonthLimit(db, userId, addedBytes, monthLimitBytes) {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const currentMonth = monthKey();
  if (user.usageMonth !== currentMonth) {
    user.usageMonth = currentMonth;
    user.usedBytes = 0;
  }

  if (user.usedBytes + addedBytes > monthLimitBytes) {
    throw new HttpError(413, "Monthly traffic limit reached");
  }

  user.usedBytes += addedBytes;
}

function getUserTrafficLimitBytes(user, config) {
  const baseLimit = Number.parseInt(config.monthLimitBytes ?? 0, 10) || 0;
  return user?.isPremium ? baseLimit * 2 : baseLimit;
}

function getUserFileLimitBytes(user, config) {
  const baseLimit = Number.parseInt(config.fileLimitBytes ?? 0, 10) || 0;
  const premiumLimit = 4 * 1024 * 1024 * 1024;
  return user?.isPremium ? Math.max(baseLimit, premiumLimit) : Math.min(baseLimit, 2 * 1024 * 1024 * 1024);
}

function normalizeReadByUserIds(value, messageSenderId = "") {
  const senderId = trimText(messageSenderId);
  const input = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const rawEntry of input) {
    const userId = trimText(rawEntry);
    if (!userId || userId === senderId || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    result.push(userId);
  }
  return result;
}

function ensureMembership(db, chatId, userId) {
  const member = db.memberships.find((entry) => entry.chatId === chatId && entry.userId === userId);
  if (!member) {
    throw new HttpError(403, "Access to chat denied");
  }
  return member;
}

function ensureRole(db, chatId, userId, allowedRoles) {
  const member = ensureMembership(db, chatId, userId);
  if (!allowedRoles.includes(member.role)) {
    throw new HttpError(403, "Not enough permissions");
  }
  return member;
}

function ensureNotBanned(db, userId) {
  const activeBan = db.bans.find((entry) => entry.userId === userId && isActive(entry.expiresAt));
  if (activeBan) {
    throw new HttpError(403, "User is banned");
  }
}

function ensureNotMuted(db, chatId, userId) {
  const activeMute = db.mutes.find(
    (entry) => entry.chatId === chatId && entry.userId === userId && isActive(entry.expiresAt),
  );
  if (activeMute) {
    throw new HttpError(403, "User is muted in this chat");
  }
}

function ensureNotChatBanned(db, chatId, userId) {
  const activeBan = (db.chatBans ?? []).find(
    (entry) => entry.chatId === chatId && entry.userId === userId && isActive(entry.expiresAt),
  );
  if (activeBan) {
    throw new HttpError(403, "User is banned in this chat");
  }
}

function findChat(db, chatId) {
  const chat = db.chats.find((entry) => entry.id === chatId);
  if (!chat) {
    throw new HttpError(404, "Chat not found");
  }
  return chat;
}

function normalizeCallMode(value) {
  const mode = String(value ?? "").trim();
  return CALL_MODES.has(mode) ? mode : "audio";
}

function ensureCallChat(db, chatId) {
  const chat = findChat(db, chatId);
  if (chat.type !== "direct" && chat.type !== "server" && chat.type !== "group") {
    throw new HttpError(400, "Call actions are available only for direct, group and server chats");
  }
  return chat;
}

function normalizeInterfaceMode(value) {
  return String(value ?? "").trim().toLowerCase() === "game" ? "game" : "chat";
}

function sanitizeErrorText(value, maxLength = 4000) {
  return trimText(String(value ?? "")).slice(0, maxLength);
}

function normalizeErrorSource(value) {
  const source = String(value ?? "").trim().toLowerCase();
  return ERROR_LOG_SOURCES.has(source) ? source : "client";
}

function shouldIgnoreErrorLogEntry(entry = {}) {
  const statusCode = Number.parseInt(entry.statusCode, 10);
  const message = sanitizeErrorText(entry.message, 2000).toLowerCase();
  const endpoint = sanitizeErrorText(entry.endpoint, 260).toLowerCase();
  if (statusCode === 401 && message.includes("session is invalid or expired")) {
    return true;
  }
  if (statusCode === 401 && endpoint.startsWith("/api/chats") && message.includes("session")) {
    return true;
  }
  return false;
}

function findUserByUsername(db, username) {
  return db.users.find((entry) => entry.username.toLowerCase() === String(username).toLowerCase());
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeUserLookupQuery(value) {
  return trimText(value).toLowerCase().replace(/^[@*]+/, "");
}

function normalizeSearchQuery(value) {
  return trimText(value).toLowerCase().replace(/^[@%&*$]+/, "");
}

function normalizeBotSearchQuery(value) {
  return trimText(value).toLowerCase().replace(/^[@*]+/, "");
}

function normalizeTitle(rawValue) {
  return trimText(rawValue);
}

function findSystemBotUser(db, config) {
  const preferredUsername = String(config.systemBotUsername ?? "yooh_support_bot")
    .trim()
    .toLowerCase();
  return (
    db.users.find((entry) => entry.isSystemBot) ??
    db.users.find(
      (entry) => Boolean(entry.isBot) && String(entry.username ?? "").trim().toLowerCase() === preferredUsername,
    ) ??
    null
  );
}

function findDirectChatByUserIds(db, firstUserId, secondUserId) {
  const expected = [String(firstUserId ?? "").trim(), String(secondUserId ?? "").trim()].filter(Boolean).sort();
  if (expected.length !== 2 || expected[0] === expected[1]) {
    return null;
  }

  return (
    db.chats.find((chat) => {
      if (chat.type !== "direct") {
        return false;
      }
      const participants = db.memberships
        .filter((entry) => entry.chatId === chat.id)
        .map((entry) => entry.userId)
        .sort();
      return participants.length === 2 && participants[0] === expected[0] && participants[1] === expected[1];
    }) ?? null
  );
}

function normalizeContactHashes(list) {
  const source = Array.isArray(list) ? list : [];
  const normalized = [
    ...new Set(
      source
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter((entry) => /^[a-f0-9]{64}$/.test(entry)),
    ),
  ];
  return normalized.slice(0, 5000);
}

function ensureDirectChatBetweenUsers(db, userId, otherUserId) {
  const safeUserId = String(userId ?? "").trim();
  const safeOtherId = String(otherUserId ?? "").trim();
  if (!safeUserId || !safeOtherId || safeUserId === safeOtherId) {
    return null;
  }
  let chat = findDirectChatByUserIds(db, safeUserId, safeOtherId);
  if (chat) {
    return chat;
  }
  const createdAt = nowIso();
  chat = {
    id: uuid(),
    type: "direct",
    title: null,
    description: "",
    handle: null,
    isPublic: false,
    settings: mergeChatSettings("direct", {}, {}),
    createdBy: safeUserId,
    createdAt,
    updatedAt: createdAt,
  };
  db.chats.push(chat);
  db.memberships.push({
    id: uuid(),
    chatId: chat.id,
    userId: safeUserId,
    role: "member",
    joinedAt: createdAt,
  });
  db.memberships.push({
    id: uuid(),
    chatId: chat.id,
    userId: safeOtherId,
    role: "member",
    joinedAt: createdAt,
  });
  return chat;
}

function ensureSupportDirectChat(db, config, targetUserId) {
  const safeTargetUserId = String(targetUserId ?? "").trim();
  if (!safeTargetUserId) {
    throw new HttpError(400, "Target user is required");
  }

  const targetUser = db.users.find((entry) => entry.id === safeTargetUserId);
  if (!targetUser) {
    throw new HttpError(404, "User not found");
  }

  const botUser = findSystemBotUser(db, config);
  if (!botUser) {
    throw new HttpError(503, "System bot account is unavailable");
  }
  if (botUser.id === safeTargetUserId) {
    throw new HttpError(400, "Target user is invalid");
  }

  let chat = findDirectChatByUserIds(db, safeTargetUserId, botUser.id);
  const createdAt = nowIso();
  if (!chat) {
    chat = {
      id: uuid(),
      type: "direct",
      title: null,
      description: "",
      handle: null,
      isPublic: false,
      settings: mergeChatSettings("direct", {}, {}),
      createdBy: botUser.id,
      createdAt,
      updatedAt: createdAt,
    };
    db.chats.push(chat);
    db.memberships.push({
      id: uuid(),
      chatId: chat.id,
      userId: botUser.id,
      role: "owner",
      joinedAt: createdAt,
    });
    db.memberships.push({
      id: uuid(),
      chatId: chat.id,
      userId: safeTargetUserId,
      role: "member",
      joinedAt: createdAt,
    });
  } else {
    const hasBotMember = db.memberships.some((entry) => entry.chatId === chat.id && entry.userId === botUser.id);
    const hasTargetMember = db.memberships.some((entry) => entry.chatId === chat.id && entry.userId === safeTargetUserId);
    if (!hasBotMember) {
      db.memberships.push({
        id: uuid(),
        chatId: chat.id,
        userId: botUser.id,
        role: "owner",
        joinedAt: createdAt,
      });
      chat.updatedAt = createdAt;
    }
    if (!hasTargetMember) {
      db.memberships.push({
        id: uuid(),
        chatId: chat.id,
        userId: safeTargetUserId,
        role: "member",
        joinedAt: createdAt,
      });
      chat.updatedAt = createdAt;
    }
  }

  return { chat, botUser, targetUser };
}

function createTextMessageFromBot(db, chat, botUserId, rawText) {
  const text = trimText(rawText);
  if (!text) {
    throw new HttpError(400, "Message text is empty");
  }

  const createdAt = nowIso();
  const message = {
    id: uuid(),
    chatId: chat.id,
    senderId: botUserId,
    type: "text",
    text,
    fileId: null,
    stream: "main",
    readByUserIds: [],
    createdAt,
  };
  db.messages.push(message);
  chat.updatedAt = createdAt;
  return hydrateMessage(db, message);
}

function findUserByLookup(db, rawLookup) {
  const lookup = trimText(rawLookup);
  if (!lookup) {
    return null;
  }
  const normalizedUsername = lookup.replace(/^@+/, "").toLowerCase();

  return (
    db.users.find((entry) => entry.id === lookup) ??
    db.users.find((entry) => String(entry.chatId ?? "") === lookup) ??
    db.users.find((entry) => String(entry.username ?? "").toLowerCase() === normalizedUsername) ??
    null
  );
}

function ensureSupportTicketsCollection(db) {
  if (!Array.isArray(db.supportTickets)) {
    db.supportTickets = [];
  }
  return db.supportTickets;
}

function getNextSupportTicketNumber(db) {
  const maxExisting = ensureSupportTicketsCollection(db).reduce((max, entry) => {
    const value = Number.parseInt(entry?.number ?? 0, 10);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  const persistedSeq = Number.parseInt(db.supportTicketSeq ?? 0, 10);
  const safeSeq = Number.isFinite(persistedSeq) ? Math.max(0, persistedSeq) : 0;
  const next = Math.max(safeSeq, maxExisting) + 1;
  db.supportTicketSeq = next;
  return next;
}

function getActiveSupportTicketForUser(db, userId) {
  const safeUserId = trimText(userId);
  if (!safeUserId) {
    return null;
  }
  return ensureSupportTicketsCollection(db).find((entry) => entry.userId === safeUserId) ?? null;
}

function appendSupportTicketMessage(ticket, messageId, updatedAt = nowIso()) {
  if (!ticket || !messageId) {
    return;
  }
  ticket.messageIds = Array.isArray(ticket.messageIds) ? ticket.messageIds : [];
  if (!ticket.messageIds.includes(messageId)) {
    ticket.messageIds.push(messageId);
  }
  ticket.updatedAt = updatedAt;
}

function ensureSupportTicketById(db, ticketId) {
  const safeTicketId = trimText(ticketId);
  if (!safeTicketId) {
    throw new HttpError(400, "ticketId is required");
  }
  const ticket = ensureSupportTicketsCollection(db).find((entry) => entry.id === safeTicketId);
  if (!ticket) {
    throw new HttpError(404, "Support ticket not found");
  }
  return ticket;
}

function buildSupportActorKey(context = {}) {
  const ip = trimText(context.ip).slice(0, 120);
  const userAgent = trimText(context.userAgent).slice(0, 260);
  const key = `${ip}|${userAgent}`;
  if (!trimText(key.replace("|", ""))) {
    throw new HttpError(400, "Admin actor context is invalid");
  }
  return { key, ip, userAgent };
}

function getSupportCategoryLabel(category) {
  switch (String(category ?? "").trim()) {
    case "bug":
      return "Ошибка";
    case "idea":
      return "Идея/предложение";
    case "account":
      return "Аккаунт и вход";
    case "other":
      return "Другое";
    default:
      return "Другое";
  }
}

function buildSupportTicketView(db, ticket, options = {}) {
  if (!ticket || typeof ticket !== "object") {
    return null;
  }
  const viewerUserId = trimText(options.viewerUserId);
  const user = db.users.find((entry) => entry.id === ticket.userId) ?? null;
  const actorKey = trimText(options.actorKey);
  const claimedByMe = Boolean(actorKey && ticket.claimedByKey && ticket.claimedByKey === actorKey);
  const claimedByOther = Boolean(ticket.claimedByKey && actorKey && ticket.claimedByKey !== actorKey);
  const status = ticket.claimedByKey ? "claimed" : "open";
  return {
    id: ticket.id,
    number: Number.parseInt(ticket.number ?? 0, 10) || 0,
    category: ticket.category,
    categoryLabel: getSupportCategoryLabel(ticket.category),
    userId: ticket.userId,
    chatId: ticket.chatId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt ?? ticket.createdAt,
    status,
    claimedAt: ticket.claimedAt ?? null,
    claimedByMe,
    claimedByOther,
    claimed: Boolean(ticket.claimedByKey),
    user: user
      ? {
          id: user.id,
          chatId: user.chatId,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar ?? "",
          isPremium: Boolean(user.isPremium),
          premiumBadge: user.premiumBadge ?? null,
        }
      : null,
    messageCount: Array.isArray(ticket.messageIds) ? ticket.messageIds.length : 0,
    canReply: Boolean(ticket.claimedByKey && ticket.claimedByKey === actorKey),
    canClaim: !ticket.claimedByKey || ticket.claimedByKey === actorKey,
    // Avoid exposing full lock fingerprint to regular users.
    lockInfo:
      options.includeLockInfo && ticket.claimedByKey
        ? {
            ip: ticket.claimedByIp ?? "",
            userAgent: ticket.claimedByUserAgent ?? "",
          }
        : null,
    viewerUserId: viewerUserId || null,
  };
}

function ensureStickerPacksCollection(db) {
  if (!Array.isArray(db.stickerPacks)) {
    db.stickerPacks = [];
  }
  return db.stickerPacks;
}

function buildStickerSvgDataUrl({ emoji, background, accent, label }) {
  const safeEmoji = trimText(emoji) || "✨";
  const safeBg = trimText(background) || "#1f2f49";
  const safeAccent = trimText(accent) || "#5e9cff";
  const safeLabel = trimText(label).slice(0, 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${safeBg}"/><stop offset="100%" stop-color="${safeAccent}"/></linearGradient></defs><rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/><circle cx="66" cy="64" r="26" fill="rgba(255,255,255,.24)"/><text x="128" y="146" font-size="104" text-anchor="middle">${safeEmoji}</text><text x="128" y="214" font-family="Segoe UI, Arial" font-size="23" font-weight="700" fill="rgba(255,255,255,.92)" text-anchor="middle">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getBuiltInStickerPacks() {
  const stickers = [
    { emoji: "🔥", label: "Огонь", image: buildStickerSvgDataUrl({ emoji: "🔥", background: "#2a1c40", accent: "#ff6a3d", label: "Огонь" }), keywords: ["fire", "огонь", "hot"] },
    { emoji: "💯", label: "Сотка", image: buildStickerSvgDataUrl({ emoji: "💯", background: "#102542", accent: "#00b4ff", label: "Сотка" }), keywords: ["100", "круто", "top"] },
    { emoji: "😂", label: "Ору", image: buildStickerSvgDataUrl({ emoji: "😂", background: "#3a2a12", accent: "#ffcc00", label: "Ору" }), keywords: ["lol", "смех", "laugh"] },
    { emoji: "😎", label: "Стиль", image: buildStickerSvgDataUrl({ emoji: "😎", background: "#132b2f", accent: "#22c55e", label: "Стиль" }), keywords: ["cool", "style", "класс"] },
    { emoji: "🤝", label: "Договор", image: buildStickerSvgDataUrl({ emoji: "🤝", background: "#2f1b27", accent: "#f472b6", label: "Договор" }), keywords: ["deal", "договор", "ok"] },
    { emoji: "🚀", label: "Погнали", image: buildStickerSvgDataUrl({ emoji: "🚀", background: "#151935", accent: "#7c8cff", label: "Погнали" }), keywords: ["go", "rocket", "поехали"] },
    { emoji: "🎉", label: "Праздник", image: buildStickerSvgDataUrl({ emoji: "🎉", background: "#1f213a", accent: "#a855f7", label: "Праздник" }), keywords: ["party", "ура", "celebrate"] },
    { emoji: "❤️", label: "Любовь", image: buildStickerSvgDataUrl({ emoji: "❤️", background: "#3b1422", accent: "#ef4444", label: "Любовь" }), keywords: ["love", "heart", "сердце"] },
  ];
  return [
    {
      id: "yooh-creator-pack-v1",
      ownerId: "",
      title: "Yooh Creator Pack",
      description: "Базовый набор стикеров от Yooh",
      coverEmoji: "✨",
      stickers,
      usageCount: 0,
      published: true,
      builtin: true,
    },
  ];
}

function ensureBuiltInStickerPacks(db) {
  const packs = ensureStickerPacksCollection(db);
  const builtInPacks = getBuiltInStickerPacks();
  const now = nowIso();
  const builtInIds = [];

  for (const builtIn of builtInPacks) {
    const safeStickers = normalizeStickerPackStickers(builtIn.stickers);
    if (safeStickers.length < 3) {
      continue;
    }
    const existing = packs.find((entry) => entry.id === builtIn.id);
    if (!existing) {
      packs.push({
        id: builtIn.id,
        ownerId: builtIn.ownerId || "",
        title: builtIn.title,
        description: builtIn.description,
        coverEmoji: normalizeStickerPackEmoji(builtIn.coverEmoji, safeStickers[0]?.emoji || "✨"),
        stickers: safeStickers,
        usageCount: Math.max(0, Number.parseInt(builtIn.usageCount ?? 0, 10) || 0),
        published: true,
        builtin: true,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      if (!trimText(existing.title)) {
        existing.title = builtIn.title;
      }
      if (!trimText(existing.description)) {
        existing.description = builtIn.description;
      }
      existing.coverEmoji = normalizeStickerPackEmoji(existing.coverEmoji, builtIn.coverEmoji);
      existing.stickers = normalizeStickerPackStickers(Array.isArray(existing.stickers) && existing.stickers.length ? existing.stickers : safeStickers);
      existing.published = true;
      existing.builtin = true;
      existing.updatedAt = existing.updatedAt ?? now;
    }
    builtInIds.push(builtIn.id);
  }

  return builtInIds;
}

function normalizeStickerPackEmoji(value, fallback = "😀") {
  const safe = trimText(value).slice(0, 24);
  return safe || fallback;
}

function normalizeStickerPackStickers(source = []) {
  const input = Array.isArray(source) ? source : [];
  const normalized = [];
  const seen = new Set();
  for (const rawEntry of input) {
    const parsed = stickerPackStickerSchema.safeParse(rawEntry ?? {});
    if (!parsed.success) {
      continue;
    }
    const entry = parsed.data;
    const emoji = normalizeStickerPackEmoji(entry.emoji, "");
    const label = trimText(entry.label).slice(0, 64);
    const image = trimText(entry.image).slice(0, 2_500_000);
    const keywords = [...new Set((Array.isArray(entry.keywords) ? entry.keywords : []).map((item) => trimText(item).toLowerCase()).filter(Boolean))].slice(0, 12);
    const dedupeKey = `${emoji}|${label.toLowerCase()}|${image}`;
    if (!emoji || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      emoji,
      label: label || emoji,
      image,
      keywords,
    });
  }
  return normalized.slice(0, 120);
}

function ensureUserStickerSettings(user) {
  if (!user || typeof user !== "object") {
    return { installedSets: [] };
  }
  if (!user.settings || typeof user.settings !== "object") {
    user.settings = {};
  }
  if (!user.settings.stickersEmoji || typeof user.settings.stickersEmoji !== "object") {
    user.settings.stickersEmoji = {};
  }
  const installedSets = Array.isArray(user.settings.stickersEmoji.installedSets)
    ? user.settings.stickersEmoji.installedSets.map((entry) => trimText(entry)).filter(Boolean)
    : [];
  user.settings.stickersEmoji.installedSets = [...new Set(installedSets)];
  return user.settings.stickersEmoji;
}

function buildStickerPackView(db, pack, viewerUserId = "", options = {}) {
  if (!pack || typeof pack !== "object") {
    return null;
  }
  const safeViewerId = trimText(viewerUserId);
  const owner = db.users.find((entry) => entry.id === pack.ownerId) ?? null;
  const viewer = safeViewerId ? db.users.find((entry) => entry.id === safeViewerId) ?? null : null;
  const installedSets = viewer ? ensureUserStickerSettings(viewer).installedSets : [];
  const installedSetOverride = options.installedSet instanceof Set ? options.installedSet : null;
  const safeStickers = normalizeStickerPackStickers(pack.stickers);
  return {
    id: pack.id,
    title: trimText(pack.title).slice(0, 64),
    description: trimText(pack.description).slice(0, 240),
    coverEmoji: normalizeStickerPackEmoji(pack.coverEmoji, safeStickers[0]?.emoji || "😀"),
    stickerCount: safeStickers.length,
    stickers: safeStickers,
    published: pack.published !== false,
    createdAt: pack.createdAt ?? nowIso(),
    updatedAt: pack.updatedAt ?? pack.createdAt ?? nowIso(),
    usageCount: Math.max(0, Number.parseInt(pack.usageCount ?? 0, 10) || 0),
    installed: installedSetOverride ? installedSetOverride.has(pack.id) : installedSets.includes(pack.id),
    builtin: pack.builtin === true,
    owner: owner
      ? {
          id: owner.id,
          username: owner.username,
          displayName: owner.displayName,
          avatar: owner.avatar ?? "",
        }
      : null,
  };
}

function resolveSupportTicketForOutgoingMessage(db, config, chat, senderUserId) {
  if (!chat || chat.type !== "direct") {
    return null;
  }
  const safeSenderId = trimText(senderUserId);
  if (!safeSenderId) {
    return null;
  }
  const botUser = findSystemBotUser(db, config);
  if (!botUser) {
    return null;
  }
  if (safeSenderId === botUser.id) {
    return null;
  }
  const chatMembers = db.memberships.filter((entry) => entry.chatId === chat.id).map((entry) => entry.userId);
  const isSupportChat = chatMembers.includes(botUser.id) && chatMembers.includes(safeSenderId);
  if (!isSupportChat) {
    return null;
  }
  const ticket = getActiveSupportTicketForUser(db, safeSenderId);
  if (!ticket || ticket.chatId !== chat.id) {
    throw new HttpError(403, "Support ticket is not active. Open support menu and create ticket first");
  }
  return ticket;
}

function ensureGroupTitle(title) {
  if (!title) {
    throw new HttpError(400, "Group title is invalid");
  }

  if (!isValidGroupTitle(title)) {
    throw new HttpError(400, "Group title contains unsupported symbols");
  }

  return title;
}

function defaultChatSettings(type) {
  const defaultPermissions = {
    sendMessages: true,
    addMembers: true,
    pinMessages: false,
    changeChatProfile: false,
    slowModeSeconds: 0,
    media: {
      photos: true,
      videos: true,
      videoMessages: true,
      music: true,
      voiceMessages: true,
      files: true,
      stickersGifs: true,
      linkPreviews: true,
      polls: true,
    },
  };
  if (type === "channel" || type === "server") {
    return {
      allowMemberInvites: false,
      reactionsEnabled: true,
      allowedReactions: [],
      commentsEnabled: true,
      hideParticipants: false,
      translateEnabled: false,
      signMessages: false,
      joinRequestsEnabled: false,
      restrictContentSaving: false,
      topicsEnabled: false,
      topicDisplayMode: "sidebar",
      autoDeleteDays: 0,
      wallpaperPreset: "",
      wallpaper: "",
      wallpaperBlur: 0,
      wallpaperDim: 0,
      permissions: {
        ...defaultPermissions,
        addMembers: false,
      },
      stylePreset: "blue",
    };
  }

  if (type === "group") {
    return {
      allowMemberInvites: true,
      reactionsEnabled: true,
      allowedReactions: [],
      commentsEnabled: false,
      hideParticipants: false,
      translateEnabled: false,
      signMessages: false,
      joinRequestsEnabled: false,
      restrictContentSaving: false,
      topicsEnabled: false,
      topicDisplayMode: "sidebar",
      autoDeleteDays: 0,
      wallpaperPreset: "",
      wallpaper: "",
      wallpaperBlur: 0,
      wallpaperDim: 0,
      permissions: {
        ...defaultPermissions,
      },
      stylePreset: "blue",
    };
  }

  return {
    allowMemberInvites: false,
    reactionsEnabled: true,
    allowedReactions: [],
    commentsEnabled: false,
    hideParticipants: false,
    translateEnabled: false,
    signMessages: false,
    joinRequestsEnabled: false,
    restrictContentSaving: false,
    topicsEnabled: false,
    topicDisplayMode: "sidebar",
    autoDeleteDays: 0,
    wallpaperPreset: "",
    wallpaper: "",
    wallpaperBlur: 0,
    wallpaperDim: 0,
    permissions: {
      ...defaultPermissions,
      addMembers: false,
    },
    stylePreset: "blue",
  };
}

function mergeChatSettings(type, current, patch) {
  const defaults = defaultChatSettings(type);
  const currentSettings = current ?? {};
  const patchSettings = patch ?? {};
  return {
    ...defaults,
    ...currentSettings,
    ...patchSettings,
    allowedReactions: Array.isArray(patchSettings.allowedReactions)
      ? [...new Set(patchSettings.allowedReactions.map((entry) => trimText(entry)).filter(Boolean))]
      : Array.isArray(currentSettings.allowedReactions)
        ? [...new Set(currentSettings.allowedReactions.map((entry) => trimText(entry)).filter(Boolean))]
        : [...defaults.allowedReactions],
    permissions: {
      ...defaults.permissions,
      ...(currentSettings.permissions ?? {}),
      ...(patchSettings.permissions ?? {}),
      media: {
        ...defaults.permissions.media,
        ...((currentSettings.permissions ?? {}).media ?? {}),
        ...((patchSettings.permissions ?? {}).media ?? {}),
      },
    },
  };
}

function userBypassesChatPermissions(membership) {
  return ["owner", "admin"].includes(String(membership?.role ?? "").trim());
}

function detectFilePermissionKey(file = {}) {
  const mime = String(file.mimetype ?? file.mimeType ?? "")
    .trim()
    .toLowerCase();
  const originalName = normalizeUploadedOriginalName(file).toLowerCase();
  const ext = path.extname(originalName);

  if (mime.startsWith("image/")) {
    return "photos";
  }
  if (mime.startsWith("video/")) {
    if (originalName.includes("video-message") || mime.includes("quicktime")) {
      return "videoMessages";
    }
    return "videos";
  }
  if (mime.startsWith("audio/") || mime === "application/ogg") {
    if (isVoiceLikeFile(file)) {
      return "voiceMessages";
    }
    return "music";
  }
  if (mime === "image/gif" || ext === ".gif" || ext === ".webp") {
    return "stickersGifs";
  }
  return "files";
}

function ensureChatSendAllowed(db, chat, membership, options = {}) {
  if (!chat || !membership || userBypassesChatPermissions(membership)) {
    return;
  }
  const settings = mergeChatSettings(chat.type, chat.settings, {});
  const permissions = settings.permissions ?? defaultChatSettings(chat.type).permissions;

  if (permissions.sendMessages === false) {
    throw new HttpError(403, "Sending messages is disabled in this chat");
  }

  if (options.kind === "poll" && permissions.media?.polls === false) {
    throw new HttpError(403, "Polls are disabled in this chat");
  }

  if (options.filePermissionKey && permissions.media?.[options.filePermissionKey] === false) {
    throw new HttpError(403, "This type of media is disabled in this chat");
  }

  const slowModeSeconds = Number.parseInt(permissions.slowModeSeconds ?? 0, 10) || 0;
  if (slowModeSeconds > 0) {
    const nowTs = Date.now();
    const lastOwnMessage = [...db.messages]
      .reverse()
      .find(
        (entry) =>
          entry.chatId === chat.id &&
          entry.senderId === membership.userId &&
          !entry.deletedAt &&
          ["text", "file", "location", "poll"].includes(String(entry.type ?? "")),
      );
    if (lastOwnMessage) {
      const lastTs = new Date(lastOwnMessage.createdAt).getTime();
      if (Number.isFinite(lastTs) && nowTs - lastTs < slowModeSeconds * 1000) {
        throw new HttpError(429, "Slow mode is enabled in this chat");
      }
    }
  }
}

function isVoiceLikeFile(file) {
  if (!file || typeof file !== "object") {
    return false;
  }
  const mime = String(file.mimetype ?? file.mimeType ?? "")
    .trim()
    .toLowerCase();
  const originalName = normalizeUploadedOriginalName(file).toLowerCase();
  const ext = path.extname(originalName);

  if (mime.startsWith("audio/") || mime === "application/ogg") {
    return true;
  }
  if (/^voice[-_]/.test(originalName)) {
    return true;
  }
  return [".ogg", ".opus", ".mp3", ".m4a", ".wav", ".aac", ".flac"].includes(ext);
}

function normalizeUploadedOriginalName(file) {
  const raw = trimText(file?.originalname ?? file?.originalName);
  if (!raw) {
    return "";
  }
  const hasCyrillic = /[\u0400-\u04ff]/.test(raw);
  const looksMojibake = /[ÐÑÃÂ]/.test(raw);
  if (!looksMojibake || hasCyrillic) {
    return raw;
  }
  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8").trim();
    if (decoded && !decoded.includes("\uFFFD")) {
      return decoded;
    }
  } catch {
    // Keep raw value when decode fails.
  }
  return raw;
}

function getDirectPeer(db, chatId, actorUserId) {
  return db.memberships.find((entry) => entry.chatId === chatId && entry.userId !== actorUserId) ?? null;
}

function ensureDirectDeliveryAllowed(db, chat, actorUserId, options = {}) {
  if (!chat || chat.type !== "direct") {
    return;
  }
  const actorId = trimText(actorUserId);
  const memberships = db.memberships.filter((entry) => entry.chatId === chat.id);
  const hasActorMembership = memberships.some((entry) => entry.userId === actorId);
  if (!hasActorMembership) {
    throw new HttpError(403, "Chat membership is required");
  }

  const isSelfDirectChat = memberships.length === 1 && memberships[0]?.userId === actorId;
  if (isSelfDirectChat) {
    return;
  }

  const peerMembership = getDirectPeer(db, chat.id, actorUserId);
  if (!peerMembership) {
    if (options.requirePeer) {
      throw new HttpError(400, "Call participants are invalid");
    }
    return;
  }
  const peer = db.users.find((entry) => entry.id === peerMembership.userId);
  if (!peer) {
    throw new HttpError(404, "User not found");
  }

  if (!canViewerSendDirectMessage(db, peer, actorUserId)) {
    throw new HttpError(403, "Messaging is restricted by recipient privacy");
  }
  if (options.voice && !canViewerSendVoiceToTarget(db, peer, actorUserId)) {
    throw new HttpError(403, "Voice messages are restricted by recipient privacy");
  }
}

function normalizeMessageReactions(rawReactions) {
  if (!Array.isArray(rawReactions)) {
    return [];
  }

  const normalized = [];
  for (const entry of rawReactions) {
    const emoji = trimText(entry?.emoji).slice(0, 32);
    if (!emoji) {
      continue;
    }
    const userIds = uniqueIds((Array.isArray(entry?.userIds) ? entry.userIds : []).map((value) => trimText(value)));
    normalized.push({
      emoji,
      userIds,
    });
  }

  return normalized;
}

function normalizePollPayload(rawPoll, creatorUserId) {
  const parsed = pollPayloadSchema.parse(rawPoll ?? {});
  const options = parsed.options
    .map((entry) => trimText(entry))
    .filter(Boolean)
    .slice(0, 12)
    .map((text) => ({
      id: uuid(),
      text,
      voterIds: [],
    }));
  if (options.length < 2) {
    throw new HttpError(400, "Poll requires at least 2 options");
  }
  const safeQuiz = Boolean(parsed.quiz);
  const safeMultiple = safeQuiz ? false : Boolean(parsed.multiple);
  const safeIndex = Number.isInteger(parsed.correctOptionIndex) ? parsed.correctOptionIndex : -1;
  const correctOptionId = safeQuiz && safeIndex >= 0 && safeIndex < options.length ? options[safeIndex].id : null;
  return {
    question: trimText(parsed.question),
    anonymous: Boolean(parsed.anonymous),
    multiple: safeMultiple,
    quiz: safeQuiz,
    correctOptionId,
    createdBy: trimText(creatorUserId),
    options,
  };
}

function normalizeStoredPoll(rawPoll) {
  if (!rawPoll || typeof rawPoll !== "object") {
    return null;
  }
  const options = Array.isArray(rawPoll.options)
    ? rawPoll.options
        .map((entry) => ({
          id: trimText(entry?.id) || uuid(),
          text: trimText(entry?.text),
          voterIds: uniqueIds((Array.isArray(entry?.voterIds) ? entry.voterIds : []).map((value) => trimText(value))),
        }))
        .filter((entry) => entry.text)
    : [];
  if (!options.length) {
    return null;
  }
  const correctOptionId = trimText(rawPoll.correctOptionId);
  return {
    question: trimText(rawPoll.question) || "Poll",
    anonymous: Boolean(rawPoll.anonymous),
    multiple: Boolean(rawPoll.multiple),
    quiz: Boolean(rawPoll.quiz),
    correctOptionId: correctOptionId || null,
    createdBy: trimText(rawPoll.createdBy) || "",
    options,
  };
}

function hydratePollForViewer(db, rawPoll, viewerUserId = null) {
  const poll = normalizeStoredPoll(rawPoll);
  if (!poll) {
    return null;
  }
  const viewerId = trimText(viewerUserId);
  const includeVoters = !poll.anonymous;
  const options = poll.options.map((entry) => {
    const voters = entry.voterIds
      .map((userId) => db.users.find((user) => user.id === userId))
      .filter(Boolean)
      .map((user) =>
        getPublicUserForViewer(db, user, viewerId || user.id, {
          includePhone: false,
        }),
      );
    return {
      id: entry.id,
      text: entry.text,
      count: entry.voterIds.length,
      mine: viewerId ? entry.voterIds.includes(viewerId) : false,
      voters: includeVoters
        ? voters.map((entryUser) => ({
            id: entryUser.id,
            username: entryUser.username,
            displayName: entryUser.displayName,
            avatar: entryUser.avatar ?? "",
          }))
        : [],
    };
  });
  const totalVotes = options.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  return {
    question: poll.question,
    anonymous: poll.anonymous,
    multiple: poll.multiple,
    quiz: poll.quiz,
    correctOptionId: poll.correctOptionId,
    options,
    totalVotes,
  };
}

/// A message scheduled for the future is invisible until due.
function isMessagePending(entry, nowMs = Date.now()) {
  if (!entry || !entry.scheduledAt) {
    return false;
  }
  const due = new Date(entry.scheduledAt).getTime();
  return Number.isFinite(due) && due > nowMs;
}

function resolveMessageReplyReference(db, message, viewerUserId) {  const replyToMessageId = trimText(message?.replyToMessageId);
  if (!replyToMessageId) {
    return null;
  }

  const target = db.messages.find(
    (entry) => entry.id === replyToMessageId && entry.chatId === message.chatId,
  );
  if (!target) {
    return {
      id: replyToMessageId,
      deleted: true,
    };
  }

  const sender = db.users.find((entry) => entry.id === target.senderId);
  const hydratedSender = sender
    ? getPublicUserForViewer(db, sender, viewerUserId ?? sender.id, {
        includePhone: false,
      })
    : null;
  const file = target.fileId ? db.files.find((entry) => entry.id === target.fileId) : null;

  return {
    id: target.id,
    stream: target.stream ?? "main",
    type: target.type,
    text: target.text ?? "",
    file: file
      ? {
          id: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
        }
      : null,
    sender: hydratedSender
      ? {
          id: hydratedSender.id,
          username: hydratedSender.username,
          displayName: hydratedSender.displayName,
          avatar: hydratedSender.avatar ?? "",
          isPremium: Boolean(hydratedSender.isPremium),
          premiumBadge: hydratedSender.premiumBadge ?? null,
        }
      : null,
    deleted: false,
  };
}

function hydrateMessage(db, message, viewerUserId = null) {
  const sender = db.users.find((entry) => entry.id === message.senderId);
  const file = message.fileId ? db.files.find((entry) => entry.id === message.fileId) : null;
  const reactions = normalizeMessageReactions(message.reactions);
  const readByUserIds = normalizeReadByUserIds(message.readByUserIds, message.senderId);
  const viewerId = trimText(viewerUserId);
  const hydratedSender = sender
    ? getPublicUserForViewer(db, sender, viewerUserId ?? sender.id, {
        includePhone: false,
      })
    : null;

  return {
    ...message,
    stream: message.stream ?? "main",
    sender: hydratedSender
      ? {
          id: hydratedSender.id,
          chatId: hydratedSender.chatId,
          username: hydratedSender.username,
          displayName: hydratedSender.displayName,
          isBot: Boolean(hydratedSender.isBot),
          isSystemBot: Boolean(hydratedSender.isSystemBot),
          isPremium: Boolean(hydratedSender.isPremium),
          premiumBadge: hydratedSender.premiumBadge ?? null,
          about: hydratedSender.about ?? "",
          avatar: hydratedSender.avatar ?? "",
          privacy: hydratedSender.privacy ?? null,
        }
      : null,
    file: file
      ? {
          id: file.id,
          originalName: file.originalName,
          size: file.size,
          mimeType: file.mimeType,
          expiresAt: file.expiresAt,
        }
      : null,
    threadRootId: trimText(message.threadRootId) || null,
    replyToMessageId: trimText(message.replyToMessageId) || null,
    replyTo: resolveMessageReplyReference(db, message, viewerUserId),
    reactions: reactions.map((entry) => ({
      emoji: entry.emoji,
      count: entry.userIds.length,
      mine: viewerId ? entry.userIds.includes(viewerId) : false,
    })),
    readByUserIds,
    location:
      message?.location && typeof message.location === "object"
        ? {
            lat: Number(message.location.lat),
            lng: Number(message.location.lng),
            title: trimText(message.location.title),
            address: trimText(message.location.address),
            mapUrl: trimText(message.location.mapUrl),
          }
        : null,
    poll: hydratePollForViewer(db, message.poll, viewerUserId),
    call: message.call ?? null,
    reportCount: db.reports.filter((entry) => entry.messageId === message.id).length,
  };
}

function hydrateMember(db, membership, viewerUserId = null) {
  const user = db.users.find((entry) => entry.id === membership.userId);
  if (!user) {
    return null;
  }
  const publicUser = getPublicUserForViewer(db, user, viewerUserId ?? membership.userId, {
    includePhone: false,
  });

  return {
    userId: publicUser.id,
    chatId: publicUser.chatId,
    username: publicUser.username,
    displayName: publicUser.displayName,
    isBot: Boolean(publicUser.isBot),
    isSystemBot: Boolean(publicUser.isSystemBot),
    isPremium: Boolean(publicUser.isPremium),
    premiumBadge: publicUser.premiumBadge ?? null,
    about: publicUser.about ?? "",
    avatar: publicUser.avatar ?? "",
    privacy: publicUser.privacy ?? null,
    role: membership.role,
  };
}

function hydrateChatForUser(db, chat, userId) {
  const membership = db.memberships.find((entry) => entry.chatId === chat.id && entry.userId === userId);
  if (!membership) {
    return null;
  }

  const totalMembersCount = db.memberships.filter((entry) => entry.chatId === chat.id).length;
  const settings = mergeChatSettings(chat.type, chat.settings, {});

  let members = db.memberships
    .filter((entry) => entry.chatId === chat.id)
    .map((entry) => hydrateMember(db, entry, userId))
    .filter(Boolean);

  if (chat.type === "channel" && membership.role !== "owner") {
    members = [];
  } else if (chat.type === "group" && settings.hideParticipants && !["owner", "admin"].includes(membership.role)) {
    members = [];
  }

  const lastMessage = db.messages
    .filter((entry) => entry.chatId === chat.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return {
    ...chat,
    description: chat.description ?? "",
    settings,
    myRole: membership.role,
    members,
    membersCount: totalMembersCount,
    lastMessage: lastMessage ? hydrateMessage(db, lastMessage, userId) : null,
  };
}

function assertHandleUniqueness(db, handle, chatIdToIgnore = null) {
  if (!handle) {
    return;
  }

  const exists = db.chats.some(
    (entry) => entry.id !== chatIdToIgnore && entry.handle && entry.handle.toLowerCase() === handle,
  );

  if (exists) {
    throw new HttpError(409, "Chat handle is already taken");
  }
}

function findDirectChatBetweenUsers(db, firstUserId, secondUserId) {
  const expected = uniqueIds([firstUserId, secondUserId]).sort();
  return (
    db.chats.find((chat) => {
      if (chat.type !== "direct") {
        return false;
      }
      const participants = db.memberships
        .filter((entry) => entry.chatId === chat.id)
        .map((entry) => entry.userId)
        .sort();
      return JSON.stringify(participants) === JSON.stringify(expected);
    }) ?? null
  );
}

export function createChatService({ store, config }) {
  async function listChats(userId) {
    return store.read((db) => {
      const memberships = db.memberships.filter((entry) => entry.userId === userId);
      return memberships
        .map((membership) => {
          const chat = db.chats.find((entry) => entry.id === membership.chatId);
          if (!chat) {
            return null;
          }
          return hydrateChatForUser(db, chat, userId);
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
  }

  async function listStickerPacks(userId, options = {}) {
    const safeUserId = trimText(userId);
    const query = trimText(options.query).toLowerCase();
    const mineOnly = Boolean(options.mineOnly);
    const installedOnly = Boolean(options.installedOnly);

    return store.transact((db) => {
      const viewer = db.users.find((entry) => entry.id === safeUserId);
      if (!viewer) {
        throw new HttpError(404, "User not found");
      }

      const builtInIds = ensureBuiltInStickerPacks(db);
      const viewerInstalledSets = ensureUserStickerSettings(viewer).installedSets;
      const effectiveInstalledSet = new Set(viewerInstalledSets);
      for (const builtInId of builtInIds) {
        if (builtInId) {
          effectiveInstalledSet.add(builtInId);
        }
      }
      ensureUserStickerSettings(viewer).installedSets = [...effectiveInstalledSet];
      const packs = ensureStickerPacksCollection(db)
        .filter((entry) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }
          const isOwner = entry.ownerId === safeUserId;
          if (mineOnly && !isOwner) {
            return false;
          }
          if (!isOwner && entry.published === false) {
            return false;
          }
          if (installedOnly && !effectiveInstalledSet.has(entry.id)) {
            return false;
          }
          if (!query) {
            return true;
          }
          const title = trimText(entry.title).toLowerCase();
          const description = trimText(entry.description).toLowerCase();
          const owner = db.users.find((candidate) => candidate.id === entry.ownerId);
          const ownerName = trimText(owner?.displayName).toLowerCase();
          const ownerUsername = trimText(owner?.username).toLowerCase();
          const keywords = normalizeStickerPackStickers(entry.stickers)
            .flatMap((sticker) => [sticker.label, ...(Array.isArray(sticker.keywords) ? sticker.keywords : [])])
            .map((value) => trimText(value).toLowerCase())
            .filter(Boolean);
          return (
            title.includes(query) ||
            description.includes(query) ||
            ownerName.includes(query) ||
            ownerUsername.includes(query) ||
            keywords.some((keyword) => keyword.includes(query))
          );
        })
        .sort((left, right) => {
          const leftInstalled = effectiveInstalledSet.has(left.id);
          const rightInstalled = effectiveInstalledSet.has(right.id);
          if (leftInstalled !== rightInstalled) {
            return Number(rightInstalled) - Number(leftInstalled);
          }
          const leftUsage = Math.max(0, Number.parseInt(left.usageCount ?? 0, 10) || 0);
          const rightUsage = Math.max(0, Number.parseInt(right.usageCount ?? 0, 10) || 0);
          if (leftUsage !== rightUsage) {
            return rightUsage - leftUsage;
          }
          return new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() - new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
        })
        .slice(0, 120)
        .map((entry) => buildStickerPackView(db, entry, safeUserId, { installedSet: effectiveInstalledSet }))
        .filter(Boolean);

      return {
        packs,
        installedSets: [...effectiveInstalledSet],
      };
    });
  }

  async function createStickerPack(userId, payload = {}) {
    const safeUserId = trimText(userId);
    const parsed = createStickerPackSchema.parse(payload ?? {});
    const stickers = normalizeStickerPackStickers(parsed.stickers);
    if (stickers.length < 3) {
      throw new HttpError(400, "Sticker pack requires at least 3 valid stickers");
    }
    const title = trimText(parsed.title).slice(0, 64);
    if (!title) {
      throw new HttpError(400, "Sticker pack title is required");
    }

    return store.transact((db) => {
      const owner = db.users.find((entry) => entry.id === safeUserId);
      if (!owner) {
        throw new HttpError(404, "User not found");
      }
      ensureBuiltInStickerPacks(db);

      const titleKey = title.toLowerCase();
      const duplicate = ensureStickerPacksCollection(db).find(
        (entry) => entry.ownerId === safeUserId && trimText(entry.title).toLowerCase() === titleKey,
      );
      if (duplicate) {
        throw new HttpError(409, "Sticker pack with same title already exists");
      }

      const now = nowIso();
      const pack = {
        id: uuid(),
        ownerId: safeUserId,
        title,
        description: trimText(parsed.description).slice(0, 240),
        coverEmoji: normalizeStickerPackEmoji(parsed.coverEmoji, stickers[0]?.emoji || "😀"),
        stickers,
        usageCount: 0,
        published: parsed.published !== false,
        createdAt: now,
        updatedAt: now,
      };
      ensureStickerPacksCollection(db).push(pack);

      const stickerSettings = ensureUserStickerSettings(owner);
      if (!stickerSettings.installedSets.includes(pack.id)) {
        stickerSettings.installedSets.push(pack.id);
      }
      const effectiveInstalledSet = new Set(stickerSettings.installedSets);

      return {
        pack: buildStickerPackView(db, pack, safeUserId, { installedSet: effectiveInstalledSet }),
        installedSets: [...effectiveInstalledSet],
      };
    });
  }

  async function setStickerPackInstalled(userId, packId, installed = true) {
    const safeUserId = trimText(userId);
    const safePackId = trimText(packId);
    if (!safePackId) {
      throw new HttpError(400, "Sticker pack id is required");
    }
    return store.transact((db) => {
      const viewer = db.users.find((entry) => entry.id === safeUserId);
      if (!viewer) {
        throw new HttpError(404, "User not found");
      }
      ensureBuiltInStickerPacks(db);
      const pack = ensureStickerPacksCollection(db).find((entry) => entry.id === safePackId);
      if (!pack) {
        throw new HttpError(404, "Sticker pack not found");
      }
      if (pack.ownerId !== safeUserId && pack.published === false) {
        throw new HttpError(403, "Sticker pack is private");
      }

      const stickerSettings = ensureUserStickerSettings(viewer);
      const installedSets = new Set(stickerSettings.installedSets);
      if (installed) {
        const isNewInstall = !installedSets.has(safePackId);
        installedSets.add(safePackId);
        if (isNewInstall) {
          pack.usageCount = Math.max(0, Number.parseInt(pack.usageCount ?? 0, 10) || 0) + 1;
        }
      } else {
        installedSets.delete(safePackId);
      }
      stickerSettings.installedSets = [...installedSets];
      pack.updatedAt = nowIso();

      return {
        pack: buildStickerPackView(db, pack, safeUserId, { installedSet: installedSets }),
        installedSets: [...stickerSettings.installedSets],
      };
    });
  }

  function normalizeStoryRecord(db, story, viewerUserId, options = {}) {
    if (!story || typeof story !== "object") {
      return null;
    }
    const author = db.users.find((entry) => entry.id === story.authorId);
    if (!author) {
      return null;
    }
    const isSelf = story.authorId === viewerUserId;
    const directChat = !isSelf ? findDirectChatBetweenUsers(db, viewerUserId, story.authorId) : null;
    const reactionEntry =
      Array.isArray(story.viewers) ? story.viewers.find((entry) => entry.userId === viewerUserId) ?? null : null;
    return {
      id: story.id,
      title: trimText(story.title) || author.displayName,
      caption: trimText(story.caption),
      avatar: trimText(story.avatar) || author.avatar || "",
      image: trimText(story.image),
      video: trimText(story.video),
      mediaType: trimText(story.mediaType) === "video" ? "video" : "image",
      background: trimText(story.background) || "sunset",
      createdAt: story.createdAt,
      isSelf,
      sourceChatId: directChat?.id ?? "",
      sourceUserId: author.id,
      sourceKey: `story-user:${author.id}`,
      privacy: trimText(story.privacy) || "contacts",
      selectedUsers: trimText(story.selectedUsers),
      exceptions: trimText(story.exceptions),
      disableScreenshots: Boolean(story.disableScreenshots),
      expiresHours: Math.max(6, Math.min(48, Number.parseInt(story.expiresHours ?? 24, 10) || 24)),
      saveToProfile: Boolean(story.saveToProfile),
      isLive: Boolean(story.isLive),
      liveCommentPrice: Math.max(0, Math.min(10000, Number.parseInt(story.liveCommentPrice ?? 0, 10) || 0)),
      premium: Boolean(author.isPremium),
      viewed: isSelf ? true : Boolean(reactionEntry),
      myReaction: trimText(reactionEntry?.reaction),
      hidden: false,
      viewers: Array.isArray(story.viewers)
        ? story.viewers
            .map((entry) => {
              const user = db.users.find((candidate) => candidate.id === entry.userId);
              if (!user) {
                return null;
              }
              return {
                id: user.id,
                name: user.displayName,
                username: user.username,
                avatar: user.avatar ?? "",
                reaction: trimText(entry.reaction),
                isContact: !!findDirectChatBetweenUsers(db, viewerUserId, user.id),
                viewedAt: entry.viewedAt ?? story.createdAt,
              };
            })
            .filter(Boolean)
        : [],
      liveComments: Array.isArray(story.liveComments)
        ? story.liveComments
            .map((entry) => {
              const user = db.users.find((candidate) => candidate.id === entry.userId);
              if (!user) {
                return null;
              }
              return {
                id: entry.id,
                name: user.displayName,
                username: user.username,
                avatar: user.avatar ?? "",
                text: trimText(entry.text),
                createdAt: entry.createdAt ?? story.createdAt,
                stars: Math.max(0, Math.min(10000, Number.parseInt(entry.stars ?? 0, 10) || 0)),
              };
            })
            .filter(Boolean)
            .slice(-50)
        : [],
      draftOnly: Boolean(options.draftOnly),
    };
  }

  function canUserViewStory(db, story, viewerUserId) {
    if (!story || !viewerUserId) {
      return false;
    }
    if (story.authorId === viewerUserId) {
      return true;
    }
    if (story.expiresAt && new Date(story.expiresAt).getTime() <= Date.now()) {
      return Boolean(story.saveToProfile);
    }
    const blockedIds = uniqueIds(String(story.exceptions ?? "").split(",").map((entry) => trimText(entry).replace(/^@+/, "")))
      .map((entry) => findUserByUsername(db, normalizeUserLookupQuery(entry))?.id)
      .filter(Boolean);
    if (blockedIds.includes(viewerUserId)) {
      return false;
    }
    const privacy = trimText(story.privacy) || "contacts";
    if (privacy === "everyone") {
      return true;
    }
    const directChat = findDirectChatBetweenUsers(db, viewerUserId, story.authorId);
    if (privacy === "contacts") {
      return Boolean(directChat);
    }
    const selectedIds = uniqueIds(String(story.selectedUserIds ?? "").split(",").map((entry) => trimText(entry)));
    if (privacy === "selected" || privacy === "close-friends") {
      return selectedIds.includes(viewerUserId);
    }
    return false;
  }

  async function listStories(viewerUserId) {
    return store.read((db) => {
      const ownStories = db.stories
        .filter((entry) => entry.authorId === viewerUserId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((entry) => normalizeStoryRecord(db, entry, viewerUserId))
        .filter(Boolean);

      const peerStories = db.stories
        .filter((entry) => entry.authorId !== viewerUserId)
        .filter((entry) => canUserViewStory(db, entry, viewerUserId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((entry) => normalizeStoryRecord(db, entry, viewerUserId))
        .filter(Boolean);

      return {
        ownStories,
        peerStories,
      };
    });
  }

  async function publishStory(userId, payload = {}) {
    const parsed = storySchema.parse(payload ?? {});
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      const storyId = trimText(payload.id) || uuid();
      const existing = db.stories.find((entry) => entry.id === storyId && entry.authorId === userId) ?? null;
      const selectedUsers = trimText(parsed.selectedUsers);
      const selectedUserIds = uniqueIds(
        String(parsed.selectedUsers ?? existing?.selectedUsers ?? "")
          .split(",")
          .map((entry) => trimText(entry).replace(/^@+/, ""))
          .map((entry) => findUserByUsername(db, normalizeUserLookupQuery(entry))?.id)
          .filter(Boolean),
      );
      const createdAt = existing?.createdAt ?? nowIso();
      const expiresHours = Math.max(6, Math.min(48, Number.parseInt(parsed.expiresHours ?? existing?.expiresHours ?? 24, 10) || 24));
      let nextPrivacy = trimText(parsed.privacy ?? existing?.privacy) || "contacts";
      if (!user.isSystemBot && nextPrivacy === "close-friends") {
        nextPrivacy = "selected";
      }
      if (nextPrivacy === "everyone" && !user.isSystemBot) {
        if (parsed.privacy !== undefined || !existing) {
          throw new HttpError(403, "Publishing stories for everyone is available only from admin bot");
        }
        // Legacy fallback: downgrade old global stories to contacts on edit.
        nextPrivacy = "contacts";
      }
      const nextStory = {
        id: storyId,
        authorId: userId,
        title: trimText(parsed.title ?? existing?.title) || user.displayName,
        caption: trimText(parsed.caption ?? existing?.caption),
        avatar: trimText(parsed.avatar ?? existing?.avatar) || user.avatar || "",
        image: trimText(parsed.image ?? existing?.image),
        video: trimText(parsed.video ?? existing?.video),
        mediaType:
          trimText(parsed.mediaType ?? existing?.mediaType) === "video" || trimText(parsed.video ?? existing?.video)
            ? "video"
            : "image",
        background: trimText(parsed.background ?? existing?.background) || "sunset",
        privacy: nextPrivacy,
        selectedUsers: parsed.selectedUsers !== undefined ? selectedUsers : trimText(existing?.selectedUsers),
        exceptions: trimText(parsed.exceptions ?? existing?.exceptions),
        selectedUserIds: selectedUserIds.join(","),
        disableScreenshots: Boolean(parsed.disableScreenshots ?? existing?.disableScreenshots),
        expiresHours,
        expiresAt: new Date(new Date(createdAt).getTime() + expiresHours * 60 * 60 * 1000).toISOString(),
        saveToProfile: Boolean(parsed.saveToProfile ?? existing?.saveToProfile),
        isLive: Boolean(parsed.isLive ?? existing?.isLive),
        liveCommentPrice: Math.max(0, Math.min(10000, Number.parseInt(parsed.liveCommentPrice ?? existing?.liveCommentPrice ?? 0, 10) || 0)),
        createdAt,
        updatedAt: nowIso(),
        viewers: Array.isArray(existing?.viewers) ? existing.viewers : [],
        liveComments: Array.isArray(existing?.liveComments) ? existing.liveComments : [],
      };
      db.stories = db.stories.filter((entry) => entry.id !== storyId);
      db.stories.unshift(nextStory);
      return normalizeStoryRecord(db, nextStory, userId);
    });
  }

  async function publishSystemStory(payload = {}) {
    return store.transact((db) => {
      const botUser = findSystemBotUser(db, config);
      if (!botUser) {
        throw new HttpError(503, "System bot account is unavailable");
      }

      const now = nowIso();
      const expiresHours = Math.max(6, Math.min(48, Number.parseInt(payload?.expiresHours ?? 24, 10) || 24));
      const storyId = uuid();
      const nextStory = {
        id: storyId,
        authorId: botUser.id,
        title: trimText(payload?.title) || botUser.displayName || "Yooh",
        caption: trimText(payload?.text),
        avatar: trimText(payload?.avatar) || botUser.avatar || "",
        image: trimText(payload?.image),
        video: trimText(payload?.video),
        mediaType: trimText(payload?.mediaType) === "video" || trimText(payload?.video) ? "video" : "image",
        background: trimText(payload?.background) || "ocean",
        privacy: "everyone",
        selectedUsers: "",
        exceptions: "",
        selectedUserIds: "",
        disableScreenshots: Boolean(payload?.disableScreenshots),
        expiresHours,
        expiresAt: new Date(new Date(now).getTime() + expiresHours * 60 * 60 * 1000).toISOString(),
        saveToProfile: Boolean(payload?.saveToProfile),
        isLive: Boolean(payload?.isLive),
        liveCommentPrice: Math.max(0, Math.min(10000, Number.parseInt(payload?.liveCommentPrice ?? 0, 10) || 0)),
        createdAt: now,
        updatedAt: now,
        viewers: [],
        liveComments: [],
      };

      db.stories.unshift(nextStory);
      return normalizeStoryRecord(db, nextStory, botUser.id);
    });
  }

  async function deleteStory(userId, storyId) {
    return store.transact((db) => {
      const safeStoryId = trimText(storyId);
      const before = db.stories.length;
      db.stories = db.stories.filter((entry) => !(entry.id === safeStoryId && entry.authorId === userId));
      if (before === db.stories.length) {
        throw new HttpError(404, "Story not found");
      }
      return { removed: 1, storyId: safeStoryId };
    });
  }

  async function markStoryViewed(viewerUserId, storyId, payload = {}) {
    const parsed = storyViewSchema.parse(payload ?? {});
    return store.transact((db) => {
      const story = db.stories.find((entry) => entry.id === storyId);
      if (!story) {
        throw new HttpError(404, "Story not found");
      }
      if (!canUserViewStory(db, story, viewerUserId)) {
        throw new HttpError(403, "Access to story denied");
      }
      if (story.authorId === viewerUserId) {
        return normalizeStoryRecord(db, story, viewerUserId);
      }
      if (parsed.stealth) {
        return normalizeStoryRecord(db, story, viewerUserId);
      }
      if (!Array.isArray(story.viewers)) {
        story.viewers = [];
      }
      const existing = story.viewers.find((entry) => entry.userId === viewerUserId);
      if (existing) {
        existing.viewedAt = nowIso();
      } else {
        story.viewers.push({
          userId: viewerUserId,
          viewedAt: nowIso(),
          reaction: "",
        });
      }
      story.updatedAt = nowIso();
      return normalizeStoryRecord(db, story, viewerUserId);
    });
  }

  async function reactToStory(viewerUserId, storyId, payload = {}) {
    const parsed = storyReactionSchema.parse(payload ?? {});
    return store.transact((db) => {
      const story = db.stories.find((entry) => entry.id === storyId);
      if (!story) {
        throw new HttpError(404, "Story not found");
      }
      if (!canUserViewStory(db, story, viewerUserId)) {
        throw new HttpError(403, "Access to story denied");
      }
      if (!Array.isArray(story.viewers)) {
        story.viewers = [];
      }
      let existing = story.viewers.find((entry) => entry.userId === viewerUserId);
      if (!existing) {
        existing = {
          userId: viewerUserId,
          viewedAt: nowIso(),
          reaction: "",
        };
        story.viewers.push(existing);
      }
      existing.reaction = trimText(parsed.emoji);
      existing.viewedAt = nowIso();
      story.updatedAt = nowIso();
      return normalizeStoryRecord(db, story, viewerUserId);
    });
  }

  async function commentOnLiveStory(viewerUserId, storyId, payload = {}) {
    const parsed = storyCommentSchema.parse(payload ?? {});
    return store.transact((db) => {
      const story = db.stories.find((entry) => entry.id === storyId);
      if (!story) {
        throw new HttpError(404, "Story not found");
      }
      if (!canUserViewStory(db, story, viewerUserId)) {
        throw new HttpError(403, "Access to story denied");
      }
      if (!story.isLive) {
        throw new HttpError(400, "Story is not live");
      }
      if (!Array.isArray(story.liveComments)) {
        story.liveComments = [];
      }
      story.liveComments.push({
        id: uuid(),
        userId: viewerUserId,
        text: trimText(parsed.text),
        stars: Math.max(0, Math.min(10000, Number.parseInt(story.liveCommentPrice ?? 0, 10) || 0)),
        createdAt: nowIso(),
      });
      story.liveComments = story.liveComments.slice(-50);
      story.updatedAt = nowIso();
      return normalizeStoryRecord(db, story, viewerUserId);
    });
  }

  async function searchUsers(userId, rawQuery, options = {}) {
    const botsOnly = Boolean(options.botsOnly);
    const query = botsOnly ? normalizeBotSearchQuery(rawQuery) : normalizeUserLookupQuery(rawQuery);
    // Allow empty query to support "add members from contacts" pickers.
    // Keep short non-empty lookups constrained to avoid noisy fuzzy matches.
    if (!botsOnly && query && query.length < 2) {
      return [];
    }

    return store.read((db) => {
      const systemBotUser = findSystemBotUser(db, config);
      const systemBotId = String(systemBotUser?.id ?? "").trim();

      return db.users
        .filter((entry) => entry && typeof entry === "object")
        .filter((entry) => entry.id !== userId)
        .filter((entry) => (botsOnly ? entry.isBot === true : entry.isBot !== true))
        .filter(
          (entry) =>
            !query ||
            String(entry.username ?? "").toLowerCase().includes(query) ||
            String(entry.displayName ?? "").toLowerCase().includes(query) ||
            String(entry.chatId ?? "").includes(query),
        )
        .sort((a, b) => {
          if (botsOnly) {
            const aSystem = String(a.id ?? "") === systemBotId || Boolean(a.isSystemBot);
            const bSystem = String(b.id ?? "") === systemBotId || Boolean(b.isSystemBot);
            if (aSystem !== bSystem) {
              return Number(bSystem) - Number(aSystem);
            }
          }
          return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""));
        })
        .filter((entry) => String(entry.id ?? "").trim())
        .slice(0, 20)
        .map((entry) => {
          const publicEntry = getPublicUserForViewer(db, entry, userId, {
            includePhone: false,
          });
          return {
            ...publicEntry,
            isBot: Boolean(entry.isBot),
            isSystemBot: Boolean(entry.isSystemBot),
          };
        })
        .map((entry) => ({
          id: entry.id,
          chatId: entry.chatId,
          username: entry.username,
          displayName: entry.displayName,
          avatar: entry.avatar ?? "",
          about: entry.about ?? "",
          isPremium: Boolean(entry.isPremium),
          premiumBadge: entry.premiumBadge ?? null,
          privacy: entry.privacy ?? null,
          isBot: Boolean(entry.isBot),
          isSystemBot: Boolean(entry.isSystemBot),
        }));
    });
  }

  async function syncContactHashes(userId, payload = {}) {
    const safeUserId = String(userId ?? "").trim();
    if (!safeUserId) {
      throw new HttpError(400, "User is required");
    }
    const hashes = normalizeContactHashes(payload?.hashes);
    // Convenience for clients without the hash salt: raw phone numbers are
    // normalized and hashed server-side exactly like stored phone hashes.
    // Additive only — the `hashes` contract is unchanged.
    if (Array.isArray(payload?.phones)) {
      const salt = config?.contactHashSalt ?? "";
      for (const raw of payload.phones.slice(0, 5000)) {
        const hashed = hashPhone(raw, salt);
        if (hashed && !hashes.includes(hashed)) {
          hashes.push(hashed);
          if (hashes.length >= 5000) {
            break;
          }
        }
      }
    }
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === safeUserId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      user.contactHashes = hashes;
      user.contactsUpdatedAt = nowIso();

      const myHash = String(user.phoneHash ?? "").trim().toLowerCase();
      if (!myHash) {
        return { matches: [], created: [] };
      }

      const candidates = db.users.filter(
        (entry) => entry.id !== safeUserId && hashes.includes(String(entry.phoneHash ?? "").trim().toLowerCase()),
      );
      const mutualMatches = candidates.filter((entry) =>
        Array.isArray(entry.contactHashes)
          ? entry.contactHashes.map((hash) => String(hash ?? "").trim().toLowerCase()).includes(myHash)
          : false,
      );

      const created = [];
      for (const match of mutualMatches) {
        const chat = ensureDirectChatBetweenUsers(db, safeUserId, match.id);
        if (chat) {
          created.push({ chatId: chat.id, memberIds: [safeUserId, match.id] });
        }
      }

      return {
        matches: mutualMatches.map((entry) => entry.id),
        created,
      };
    });
  }

  async function searchPublicChats(userId, rawQuery) {
    const query = normalizeSearchQuery(rawQuery);

    return store.read((db) =>
      db.chats
        .filter((chat) => chat.type === "group" && chat.isPublic)
        .filter((chat) => {
          if (!query) {
            return true;
          }

          const title = (chat.title ?? "").toLowerCase();
          const description = (chat.description ?? "").toLowerCase();
          const handle = (chat.handle ?? "").toLowerCase();
          const type = (chat.type ?? "").toLowerCase();
          return (
            title.includes(query) ||
            description.includes(query) ||
            handle.includes(query) ||
            type.includes(query)
          );
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 30)
        .map((chat) => ({
          id: chat.id,
          type: chat.type,
          title: chat.title,
          description: chat.description ?? "",
          handle: chat.handle,
          isPublic: chat.isPublic,
          joined: db.memberships.some((entry) => entry.chatId === chat.id && entry.userId === userId),
          membersCount: db.memberships.filter((entry) => entry.chatId === chat.id).length,
        })),
    );
  }

  async function joinPublicChatByHandle(userId, rawHandle) {
    const handle = normalizePublicHandle(rawHandle);
    if (!handle) {
      throw new HttpError(400, "Chat handle format is invalid");
    }

    return store.transact((db) => {
      ensureNotBanned(db, userId);
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      const chat = db.chats.find((entry) => entry.handle === handle && entry.isPublic && entry.type === "group");
      if (!chat) {
        throw new HttpError(404, "Public chat not found");
      }

      const existing = db.memberships.find((entry) => entry.chatId === chat.id && entry.userId === userId);
      if (!existing) {
        db.memberships.push({
          id: uuid(),
          chatId: chat.id,
          userId,
          role: "member",
          joinedAt: nowIso(),
        });
        chat.updatedAt = nowIso();
      }

      return hydrateChatForUser(db, chat, userId);
    });
  }

  async function assertChatAccess(userId, chatId) {
    return store.read((db) => {
      ensureMembership(db, chatId, userId);
      return true;
    });
  }

  async function markChatRead(userId, chatId, payload = {}) {
    const stream = streamSchema.parse(payload?.stream ?? "main");
    const messageId = trimText(payload?.messageId);
    const readerUserId = trimText(userId);

    return store.transact((db) => {
      ensureMembership(db, chatId, readerUserId);

      let readUntil = Number.POSITIVE_INFINITY;
      if (messageId) {
        const marker = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
        if (!marker) {
          throw new HttpError(404, "Message not found");
        }
        if ((marker.stream ?? "main") !== stream) {
          throw new HttpError(400, "Message stream mismatch");
        }
        readUntil = new Date(marker.createdAt ?? 0).getTime();
      }

      let updatedCount = 0;
      for (const message of db.messages) {
        if (message.chatId !== chatId) {
          continue;
        }
        if ((message.stream ?? "main") !== stream) {
          continue;
        }
        if (message.senderId === readerUserId) {
          continue;
        }
        const createdAtMs = new Date(message.createdAt ?? 0).getTime();
        if (Number.isFinite(readUntil) && createdAtMs > readUntil) {
          continue;
        }

        const current = normalizeReadByUserIds(message.readByUserIds, message.senderId);
        if (current.includes(readerUserId)) {
          message.readByUserIds = current;
          continue;
        }
        message.readByUserIds = [...current, readerUserId];
        updatedCount += 1;
      }

      return {
        chatId,
        stream,
        messageId: messageId || null,
        readAt: nowIso(),
        updatedCount,
      };
    });
  }

  async function getChatMemberIds(chatId) {
    return store.read((db) => db.memberships.filter((entry) => entry.chatId === chatId).map((entry) => entry.userId));
  }

  async function ensureSupportChat(userId) {
    return store.transact((db) => {
      const { chat } = ensureSupportDirectChat(db, config, userId);
      return hydrateChatForUser(db, chat, userId);
    });
  }

  async function sendSystemBotMessageToUser(userId, payload = {}) {
    const parsed = createMessageSchema.parse(payload ?? {});
    return store.transact((db) => {
      const { chat, botUser, targetUser } = ensureSupportDirectChat(db, config, userId);
      const message = createTextMessageFromBot(db, chat, botUser.id, parsed.text);
      return {
        chatId: chat.id,
        targetUserId: targetUser.id,
        targetChatId: targetUser.chatId,
        message,
        memberIds: [targetUser.id, botUser.id],
      };
    });
  }

  async function sendSystemBotMessageToTarget(rawTarget, payload = {}) {
    const parsed = createMessageSchema.parse(payload ?? {});
    const safeTarget = trimText(rawTarget);
    if (!safeTarget) {
      throw new HttpError(400, "Target user is required");
    }

    return store.transact((db) => {
      const targetUser = findUserByLookup(db, safeTarget);
      if (!targetUser) {
        throw new HttpError(404, "Target user not found");
      }
      if (targetUser.isSystemBot) {
        throw new HttpError(400, "Target user is invalid");
      }

      const { chat, botUser } = ensureSupportDirectChat(db, config, targetUser.id);
      const message = createTextMessageFromBot(db, chat, botUser.id, parsed.text);
      return {
        chatId: chat.id,
        targetUserId: targetUser.id,
        targetChatId: targetUser.chatId,
        message,
        memberIds: [targetUser.id, botUser.id],
      };
    });
  }

  async function broadcastSystemBotMessage(payload = {}) {
    const parsed = createMessageSchema.parse(payload ?? {});
    return store.transact((db) => {
      const botUser = findSystemBotUser(db, config);
      if (!botUser) {
        throw new HttpError(503, "System bot account is unavailable");
      }

      const recipients = db.users.filter((entry) => entry.id !== botUser.id && !entry.isSystemBot);
      const deliveries = [];
      for (const recipient of recipients) {
        const { chat } = ensureSupportDirectChat(db, config, recipient.id);
        const message = createTextMessageFromBot(db, chat, botUser.id, parsed.text);
        deliveries.push({
          chatId: chat.id,
          targetUserId: recipient.id,
          targetChatId: recipient.chatId,
          message,
          memberIds: [recipient.id, botUser.id],
        });
      }

      return {
        delivered: deliveries.length,
        deliveries,
      };
    });
  }

  async function broadcastSystemBotStory(payload = {}) {
    const parsed = adminStoryBroadcastSchema.parse(payload ?? {});
    return store.transact((db) => {
      const botUser = findSystemBotUser(db, config);
      if (!botUser) {
        throw new HttpError(503, "System bot account is unavailable");
      }

      const caption = trimText(parsed.text);
      if (!caption) {
        throw new HttpError(400, "Story text is empty");
      }

      const recipients = db.users.filter((entry) => entry.id !== botUser.id && !entry.isSystemBot);
      const createdAt = nowIso();
      const expiresHours = Math.max(6, Math.min(48, Number.parseInt(parsed.expiresHours ?? 24, 10) || 24));
      const story = {
        id: uuid(),
        authorId: botUser.id,
        title: trimText(botUser.displayName) || "YOOH",
        caption,
        avatar: trimText(botUser.avatar),
        image: "",
        video: "",
        mediaType: "image",
        background: trimText(parsed.background) || "sunset",
        privacy: "everyone",
        selectedUsers: "",
        exceptions: "",
        selectedUserIds: "",
        disableScreenshots: false,
        expiresHours,
        expiresAt: new Date(new Date(createdAt).getTime() + expiresHours * 60 * 60 * 1000).toISOString(),
        saveToProfile: false,
        isLive: false,
        liveCommentPrice: 0,
        createdAt,
        updatedAt: createdAt,
        viewers: [],
        liveComments: [],
      };

      db.stories = db.stories.filter((entry) => entry.id !== story.id);
      db.stories.unshift(story);

      return {
        delivered: recipients.length,
        storyId: story.id,
        story: normalizeStoryRecord(db, story, botUser.id),
      };
    });
  }

  async function getSystemBotState() {
    return store.read((db) => {
      const botUser = findSystemBotUser(db, config);
      if (!botUser) {
        return null;
      }
      const recipients = db.users.filter((entry) => entry.id !== botUser.id && !entry.isSystemBot).length;
      return {
        bot: {
          id: botUser.id,
          chatId: botUser.chatId,
          username: botUser.username,
          displayName: botUser.displayName,
          about: botUser.about ?? "",
        },
        recipients,
      };
    });
  }

  async function getSupportTicketState(userId) {
    const safeUserId = trimText(userId);
    if (!safeUserId) {
      throw new HttpError(400, "User is required");
    }
    return store.transact((db) => {
      const { chat } = ensureSupportDirectChat(db, config, safeUserId);
      const ticket = getActiveSupportTicketForUser(db, safeUserId);
      return {
        chatId: chat.id,
        ticket: ticket ? buildSupportTicketView(db, ticket, { viewerUserId: safeUserId }) : null,
      };
    });
  }

  async function createSupportTicket(userId, payload = {}) {
    const safeUserId = trimText(userId);
    if (!safeUserId) {
      throw new HttpError(400, "User is required");
    }
    const parsed = supportTicketCreateSchema.parse(payload ?? {});
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === safeUserId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      const existing = getActiveSupportTicketForUser(db, safeUserId);
      if (existing) {
        throw new HttpError(409, "Support ticket is already active");
      }

      const { chat, botUser } = ensureSupportDirectChat(db, config, safeUserId);
      const createdAt = nowIso();
      const ticket = {
        id: uuid(),
        number: getNextSupportTicketNumber(db),
        userId: safeUserId,
        chatId: chat.id,
        category: parsed.category,
        createdAt,
        updatedAt: createdAt,
        claimedByKey: null,
        claimedByIp: null,
        claimedByUserAgent: null,
        claimedAt: null,
        messageIds: [],
      };
      ensureSupportTicketsCollection(db).push(ticket);
      const text = `Тикет #${ticket.number} создан. Категория: ${getSupportCategoryLabel(ticket.category)}. Опишите проблему в сообщении, оператор подключится скоро.`;
      const message = createTextMessageFromBot(db, chat, botUser.id, text);
      appendSupportTicketMessage(ticket, message.id, createdAt);
      return {
        ticket: buildSupportTicketView(db, ticket, { viewerUserId: safeUserId }),
        message,
        chatId: chat.id,
        memberIds: [safeUserId, botUser.id],
      };
    });
  }

  async function listAdminSupportTickets(adminContext = {}) {
    const actor = buildSupportActorKey(adminContext);
    return store.read((db) =>
      ensureSupportTicketsCollection(db)
        .map((entry) =>
          buildSupportTicketView(db, entry, {
            actorKey: actor.key,
            includeLockInfo: true,
          }),
        )
        .sort((left, right) => {
          const leftClaimed = left.claimed ? 1 : 0;
          const rightClaimed = right.claimed ? 1 : 0;
          if (leftClaimed !== rightClaimed) {
            return leftClaimed - rightClaimed;
          }
          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        }),
    );
  }

  async function getAdminSupportTicketMessages(ticketId, adminContext = {}) {
    const actor = buildSupportActorKey(adminContext);
    return store.read((db) => {
      const ticket = ensureSupportTicketById(db, ticketId);
      const botUser = findSystemBotUser(db, config);
      const mapped = (Array.isArray(ticket.messageIds) ? ticket.messageIds : [])
        .map((messageId) => db.messages.find((entry) => entry.id === messageId))
        .filter(Boolean);
      const fallbackMessages =
        mapped.length > 0
          ? mapped
          : db.messages.filter((entry) => {
              if (entry.chatId !== ticket.chatId) {
                return false;
              }
              if (entry.senderId !== ticket.userId && entry.senderId !== botUser?.id) {
                return false;
              }
              return new Date(entry.createdAt).getTime() >= new Date(ticket.createdAt).getTime();
            });
      const messages = fallbackMessages
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((entry) => hydrateMessage(db, entry, ticket.userId));
      return {
        ticket: buildSupportTicketView(db, ticket, {
          actorKey: actor.key,
          includeLockInfo: true,
        }),
        messages,
        canReply: Boolean(ticket.claimedByKey && ticket.claimedByKey === actor.key),
      };
    });
  }

  async function claimSupportTicket(ticketId, adminContext = {}) {
    const actor = buildSupportActorKey(adminContext);
    return store.transact((db) => {
      const ticket = ensureSupportTicketById(db, ticketId);
      if (ticket.claimedByKey && ticket.claimedByKey !== actor.key) {
        throw new HttpError(409, "Ticket is already claimed by another operator");
      }
      const { chat, botUser, targetUser } = ensureSupportDirectChat(db, config, ticket.userId);
      let message = null;
      if (!ticket.claimedByKey) {
        const claimedAt = nowIso();
        ticket.claimedByKey = actor.key;
        ticket.claimedByIp = actor.ip;
        ticket.claimedByUserAgent = actor.userAgent;
        ticket.claimedAt = claimedAt;
        ticket.updatedAt = claimedAt;
        message = createTextMessageFromBot(db, chat, botUser.id, `Оператор подключился к тикету #${ticket.number}.`);
        appendSupportTicketMessage(ticket, message.id, claimedAt);
      }
      return {
        ticket: buildSupportTicketView(db, ticket, {
          actorKey: actor.key,
          includeLockInfo: true,
        }),
        message,
        chatId: chat.id,
        memberIds: [targetUser.id, botUser.id],
      };
    });
  }

  async function replySupportTicket(ticketId, payload = {}, adminContext = {}) {
    const actor = buildSupportActorKey(adminContext);
    const parsed = supportTicketReplySchema.parse(payload ?? {});
    return store.transact((db) => {
      const ticket = ensureSupportTicketById(db, ticketId);
      if (!ticket.claimedByKey) {
        throw new HttpError(409, "Claim ticket before replying");
      }
      if (ticket.claimedByKey !== actor.key) {
        throw new HttpError(403, "Ticket is locked by another operator");
      }
      const { chat, botUser, targetUser } = ensureSupportDirectChat(db, config, ticket.userId);
      const message = createTextMessageFromBot(db, chat, botUser.id, parsed.text);
      appendSupportTicketMessage(ticket, message.id, nowIso());
      return {
        ticket: buildSupportTicketView(db, ticket, {
          actorKey: actor.key,
          includeLockInfo: true,
        }),
        message,
        chatId: chat.id,
        memberIds: [targetUser.id, botUser.id],
      };
    });
  }

  async function closeSupportTicket(ticketId, adminContext = {}) {
    const actor = buildSupportActorKey(adminContext);
    return store.transact((db) => {
      const ticket = ensureSupportTicketById(db, ticketId);
      if (!ticket.claimedByKey) {
        throw new HttpError(409, "Claim ticket before closing");
      }
      if (ticket.claimedByKey !== actor.key) {
        throw new HttpError(403, "Ticket is locked by another operator");
      }
      const { chat, botUser, targetUser } = ensureSupportDirectChat(db, config, ticket.userId);
      const message = createTextMessageFromBot(
        db,
        chat,
        botUser.id,
        `Тикет #${ticket.number} закрыт. Если нужна помощь, откройте новое обращение через кнопки поддержки.`,
      );
      db.supportTickets = ensureSupportTicketsCollection(db).filter((entry) => entry.id !== ticket.id);
      return {
        removed: 1,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        userId: ticket.userId,
        chatId: chat.id,
        message,
        memberIds: [targetUser.id, botUser.id],
      };
    });
  }

  async function listCallLogs(userId, options = {}) {
    const limitRaw = Number.parseInt(options.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 100 : Math.min(Math.max(limitRaw, 1), 300);

    return store.read((db) =>
      db.callLogs
        .filter((entry) => entry.callerId === userId || entry.calleeId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map((entry) => {
          const chat = db.chats.find((candidate) => candidate.id === entry.chatId) ?? null;
          const caller = db.users.find((candidate) => candidate.id === entry.callerId) ?? null;
          const callee = db.users.find((candidate) => candidate.id === entry.calleeId) ?? null;
          const peer = entry.callerId === userId ? callee : caller;
          const publicPeer = peer
            ? getPublicUserForViewer(db, peer, userId, {
                includePhone: false,
              })
            : null;

          return {
            id: entry.id,
            chatId: entry.chatId,
            status: entry.status,
            mode: normalizeCallMode(entry.mode),
            durationSeconds: entry.durationSeconds ?? 0,
            createdAt: entry.createdAt,
            direction: entry.callerId === userId ? "outgoing" : "incoming",
            peer: publicPeer
                ? {
                  id: publicPeer.id,
                  chatId: publicPeer.chatId,
                  username: publicPeer.username,
                  displayName: publicPeer.displayName,
                  isBot: Boolean(publicPeer.isBot),
                  isSystemBot: Boolean(publicPeer.isSystemBot),
                  isPremium: Boolean(publicPeer.isPremium),
                  premiumBadge: publicPeer.premiumBadge ?? null,
                  about: publicPeer.about ?? "",
                  avatar: publicPeer.avatar ?? "",
                  privacy: publicPeer.privacy ?? null,
                }
              : null,
            chat: chat
              ? {
                  id: chat.id,
                  type: chat.type,
                  title: chat.title ?? "",
                  handle: chat.handle ?? null,
                }
              : null,
          };
        }),
    );
  }

  async function removeCallLog(userId, callLogId) {
    const safeCallLogId = String(callLogId ?? "").trim();
    if (!safeCallLogId) {
      throw new HttpError(400, "Call log id is required");
    }

    return store.transact((db) => {
      const callLog = db.callLogs.find((entry) => entry.id === safeCallLogId);
      if (!callLog) {
        throw new HttpError(404, "Call log not found");
      }

      const participant = callLog.callerId === userId || callLog.calleeId === userId;
      if (!participant) {
        throw new HttpError(403, "Not enough permissions");
      }

      db.callLogs = db.callLogs.filter((entry) => entry.id !== safeCallLogId);
      return { removed: true, callId: safeCallLogId };
    });
  }

  async function recordCallStatus(payload = {}) {
    const chatId = String(payload.chatId ?? "").trim();
    const callerId = String(payload.callerId ?? "").trim();
    const calleeId = String(payload.calleeId ?? "").trim();
    const status = String(payload.status ?? "").trim();
    const mode = normalizeCallMode(payload.mode);
    const allowedStatuses = new Set(["no_answer", "canceled", "completed", "busy"]);
    const durationSeconds = Math.max(0, Number.parseInt(payload.durationSeconds ?? 0, 10) || 0);
    const createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : nowIso();

    if (!chatId || !callerId || !calleeId) {
      throw new HttpError(400, "Call payload is incomplete");
    }

    if (!allowedStatuses.has(status)) {
      throw new HttpError(400, "Call status is invalid");
    }

    return store.transact((db) => {
      const chat = ensureCallChat(db, chatId);
      ensureMembership(db, chatId, callerId);
      ensureMembership(db, chatId, calleeId);

      const caller = db.users.find((entry) => entry.id === callerId);
      const callee = db.users.find((entry) => entry.id === calleeId);
      if (!caller || !callee) {
        throw new HttpError(404, "Call users not found");
      }

      const callLog = {
        id: uuid(),
        chatId,
        callerId,
        calleeId,
        mode,
        status,
        durationSeconds,
        createdAt,
      };
      db.callLogs.push(callLog);

      const message = {
        id: uuid(),
        chatId,
        senderId: callerId,
        type: "call",
        text: "",
        fileId: null,
        stream: "main",
        readByUserIds: [],
        createdAt,
        call: {
          callerId,
          calleeId,
          mode,
          status,
          durationSeconds,
        },
      };
      db.messages.push(message);
      chat.updatedAt = createdAt;

      return {
        callLog,
        message: hydrateMessage(db, message),
        memberIds: [callerId, calleeId],
      };
    });
  }

  async function createChat(userId, payload) {
    const parsed = createChatSchema.parse(payload);
    const now = nowIso();
    const interfaceMode = normalizeInterfaceMode(parsed.interfaceMode);

    return store.transact((db) => {
      const creator = db.users.find((entry) => entry.id === userId);
      if (!creator) {
        throw new HttpError(404, "User not found");
      }
      ensureNotBanned(db, userId);

      let directTargetId = null;
      if (parsed.type === "direct") {
        if (parsed.memberId) {
          const member = db.users.find((entry) => entry.id === parsed.memberId);
          if (!member) {
            throw new HttpError(404, `User not found: ${parsed.memberId}`);
          }
          directTargetId = member.id;
        } else if (parsed.memberUsername) {
          const member = findUserByUsername(db, normalizeUserLookupQuery(parsed.memberUsername));
          if (!member) {
            throw new HttpError(404, `User not found by username: ${parsed.memberUsername}`);
          }
          directTargetId = member.id;
        }
      }

      const memberIds = uniqueIds([
        ...(parsed.memberIds ?? []),
        parsed.memberId,
        parsed.type === "direct" ? directTargetId : null,
      ]).filter((entry) => entry !== userId);

      for (const memberId of memberIds) {
        const invited = db.users.find((entry) => entry.id === memberId);
        if (!invited) {
          throw new HttpError(404, `User not found: ${memberId}`);
        }
        if (parsed.type !== "direct" && invited.isSystemBot) {
          throw new HttpError(400, "Yooh Support bot cannot be added to groups or channels");
        }
        if (parsed.type !== "direct" && invited.isBot) {
          throw new HttpError(400, "Bots cannot be added during chat creation");
        }
        if (parsed.type !== "direct" && !canViewerInviteTarget(db, invited, userId)) {
          throw new HttpError(403, "Inviting this user is restricted by privacy");
        }
      }

      if (parsed.type === "direct") {
        const existing = db.chats.find((chat) => {
          if (chat.type !== "direct") {
            return false;
          }

          const participants = db.memberships
            .filter((entry) => entry.chatId === chat.id)
            .map((entry) => entry.userId)
            .sort();
          const expected = uniqueIds([userId, directTargetId]).sort();
          return JSON.stringify(participants) === JSON.stringify(expected);
        });

        if (existing) {
          return hydrateChatForUser(db, existing, userId);
        }
      }

      const supportsPublicHandle = parsed.type === "group";
      const normalizedHandle = normalizePublicHandle(parsed.handle);
      if (parsed.handle && !normalizedHandle) {
        throw new HttpError(400, "Chat handle format is invalid");
      }

      if (!supportsPublicHandle && (parsed.isPublic || normalizedHandle)) {
        throw new HttpError(403, "Public publishing is available only for groups");
      }

      if (supportsPublicHandle) {
        assertHandleUniqueness(db, normalizedHandle);
      }

      if (parsed.type === "server" && interfaceMode !== "game") {
        throw new HttpError(403, "Server chats can be created only in game mode");
      }

      const isPublic = supportsPublicHandle ? Boolean(parsed.isPublic) : false;
      if (supportsPublicHandle && isPublic && !normalizedHandle) {
        throw new HttpError(400, "Public group requires a valid handle");
      }

      const titleInput =
        parsed.type === "direct"
          ? null
          : normalizeTitle(parsed.title) || `${parsed.type === "group" ? "Group" : parsed.type === "server" ? "Server" : "Channel"} chat`;
      const title = parsed.type === "group" ? ensureGroupTitle(titleInput) : titleInput;

      const chat = {
        id: uuid(),
        type: parsed.type,
        title,
        description: parsed.type === "direct" ? "" : trimText(parsed.description),
        avatar: parsed.type === "direct" ? "" : trimText(parsed.avatar),
        handle: supportsPublicHandle ? normalizedHandle : null,
        isPublic,
        settings: mergeChatSettings(parsed.type, {}, parsed.settings),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      db.chats.push(chat);

      db.memberships.push({
        id: uuid(),
        chatId: chat.id,
        userId,
        role: "owner",
        joinedAt: now,
      });

      for (const memberId of memberIds) {
        db.memberships.push({
          id: uuid(),
          chatId: chat.id,
          userId: memberId,
          role: "member",
          joinedAt: now,
        });
      }

      return hydrateChatForUser(db, chat, userId);
    });
  }

  async function listMessages(userId, chatId, options = {}) {
    const limitRaw = Number.parseInt(options.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 200);
    const before = options.before ? new Date(options.before).getTime() : null;
    const stream = streamSchema.parse(options.stream ?? "main");
    const threadRootId = trimText(options.threadRootId);

    return store.read((db) => {
      ensureMembership(db, chatId, userId);
      const chat = findChat(db, chatId);
      if (stream === "comment" && chat.type !== "channel" && chat.type !== "server") {
        throw new HttpError(400, "Comments stream is available only for channel/server chats");
      }

      return db.messages
        .filter((entry) => entry.chatId === chatId)
        .filter((entry) => (entry.stream ?? "main") === stream)
        .filter((entry) => !isMessagePending(entry))
        .filter((entry) => {
          if (stream !== "comment" || !threadRootId) {
            return true;
          }
          return trimText(entry.threadRootId) === threadRootId;
        })
        .filter((entry) => (before ? new Date(entry.createdAt).getTime() < before : true))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-limit)
        .map((entry) => hydrateMessage(db, entry, userId));
    });
  }

  function ensureCanPublishToStream(db, chatId, userId, stream) {
    const chat = findChat(db, chatId);
    const membership = ensureMembership(db, chatId, userId);
    const settings = mergeChatSettings(chat.type, chat.settings, {});

    if (stream === "main" && (chat.type === "channel" || chat.type === "server") && !["owner", "admin"].includes(membership.role)) {
      throw new HttpError(403, "Only channel/server owners/admins can publish posts");
    }

    if (stream === "comment" && chat.type !== "channel" && chat.type !== "server") {
      throw new HttpError(400, "Comments stream is available only for channel/server chats");
    }

    if (stream === "comment" && (chat.type === "channel" || chat.type === "server") && !settings.commentsEnabled) {
      throw new HttpError(403, "Comments are disabled in this chat");
    }

    return chat;
  }

  async function sendTextToStream(userId, chatId, payload, stream) {
    const parsed = createMessageSchema.parse(payload);
    const kind = String(parsed.kind ?? "text").trim().toLowerCase() || "text";
    const text = trimText(parsed.text);
    const isLocationMessage = kind === "location";
    const isPollMessage = kind === "poll";
    if (!isLocationMessage && !isPollMessage && !text) {
      throw new HttpError(400, "Message text is empty");
    }
    if (isLocationMessage && !parsed.location) {
      throw new HttpError(400, "Location payload is required");
    }
    if (isPollMessage && !parsed.poll) {
      throw new HttpError(400, "Poll payload is required");
    }
    const clientMessageId = trimText(parsed.clientMessageId);

    // Optional delayed delivery: hidden from history/realtime until due.
    // Bounds: must be in the future and at most 365 days out.
    let scheduledAt = null;
    const scheduledRaw = trimText(parsed.scheduledAt);
    if (scheduledRaw) {
      const scheduledMs = new Date(scheduledRaw).getTime();
      if (!Number.isFinite(scheduledMs)) {
        throw new HttpError(400, "Scheduled time is invalid");
      }
      if (scheduledMs <= Date.now() + 30_000) {
        throw new HttpError(400, "Scheduled time must be in the future");
      }
      if (scheduledMs > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        throw new HttpError(400, "Scheduled time is too far in the future");
      }
      scheduledAt = new Date(scheduledMs).toISOString();
    }

    const createdAt = nowIso();
    return store.transact((db) => {
      ensureNotBanned(db, userId);
      ensureNotChatBanned(db, chatId, userId);
      ensureNotMuted(db, chatId, userId);
      const chat = ensureCanPublishToStream(db, chatId, userId, stream);
      const membership = ensureMembership(db, chatId, userId);
      ensureDirectDeliveryAllowed(db, chat, userId, { voice: false });
      ensureChatSendAllowed(db, chat, membership, { kind });
      const supportTicket = resolveSupportTicketForOutgoingMessage(db, config, chat, userId);

      let locationPayload = null;
      let pollPayload = null;
      if (isLocationMessage) {
        const parsedLocation = locationPayloadSchema.parse(parsed.location ?? {});
        locationPayload = {
          lat: Number(parsedLocation.lat),
          lng: Number(parsedLocation.lng),
          title: trimText(parsedLocation.title),
          address: trimText(parsedLocation.address),
          mapUrl: trimText(parsedLocation.mapUrl),
        };
      } else if (isPollMessage) {
        pollPayload = normalizePollPayload(parsed.poll, userId);
      }

      const payloadWeight = byteLength(
        text ||
          (isLocationMessage
            ? JSON.stringify(locationPayload ?? {})
            : isPollMessage
              ? JSON.stringify(pollPayload ?? {})
              : ""),
      );
      const user = db.users.find((entry) => entry.id === userId);
      enforceMonthLimit(db, userId, payloadWeight, getUserTrafficLimitBytes(user, config));

      if (clientMessageId) {
        const existing = db.messages.find(
          (entry) =>
            entry.chatId === chatId &&
            entry.senderId === userId &&
            trimText(entry.clientMessageId) === clientMessageId &&
            (entry.stream ?? "main") === stream,
        );
        if (existing) {
          return hydrateMessage(db, existing, userId);
        }
      }

      let threadRootId = null;
      if (stream === "comment" && parsed.threadRootId) {
        const threadRoot = db.messages.find((entry) => entry.id === parsed.threadRootId && entry.chatId === chatId);
        if (!threadRoot || (threadRoot.stream ?? "main") !== "main") {
          throw new HttpError(404, "Comment thread root message not found");
        }
        threadRootId = threadRoot.id;
      }

      let replyToMessageId = null;
      if (parsed.replyToMessageId) {
        const replyTarget = db.messages.find((entry) => entry.id === parsed.replyToMessageId && entry.chatId === chatId);
        if (!replyTarget) {
          throw new HttpError(404, "Reply target message not found");
        }
        const replyStream = replyTarget.stream ?? "main";
        const allowedReply = replyStream === stream || (stream === "comment" && replyStream === "main");
        if (!allowedReply) {
          throw new HttpError(400, "Reply target stream mismatch");
        }
        replyToMessageId = replyTarget.id;
      }

      chat.updatedAt = scheduledAt ? chat.updatedAt : createdAt;
      const message = {
        id: uuid(),
        chatId,
        senderId: userId,
        type: isLocationMessage ? "location" : isPollMessage ? "poll" : "text",
        text: text || (isLocationMessage ? trimText(locationPayload?.title || locationPayload?.address) : trimText(pollPayload?.question)),
        clientMessageId: clientMessageId || null,
        fileId: null,
        location: locationPayload,
        poll: pollPayload,
        stream,
        threadRootId,
        replyToMessageId,
        reactions: [],
        readByUserIds: [],
        scheduledAt,
        createdAt,
      };
      db.messages.push(message);
      if (!scheduledAt) {
        appendSupportTicketMessage(supportTicket, message.id, createdAt);
      }
      return hydrateMessage(db, message, userId);
    });
  }

  async function getMessageForUser(userId, chatId, messageId) {    const safeMessageId = trimText(messageId);
    if (!safeMessageId) {
      throw new HttpError(400, "Message id is required");
    }
    return store.read((db) => {
      ensureMembership(db, chatId, userId);
      const message = db.messages.find((entry) => entry.id === safeMessageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }
      return hydrateMessage(db, message, userId);
    });
  }

  /// Full-text search inside one chat (member-only). Pending scheduled
  /// messages are excluded; newest first.
  async function searchMessages(userId, chatId, options = {}) {
    const query = trimText(options.q).toLowerCase();
    if (query.length < 2) {
      return [];
    }
    const limitRaw = Number.parseInt(options.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 50);
    const stream = streamSchema.parse(options.stream ?? "main");

    return store.read((db) => {
      ensureMembership(db, chatId, userId);
      const nowMs = Date.now();
      return db.messages
        .filter((entry) => entry.chatId === chatId)
        .filter((entry) => (entry.stream ?? "main") === stream)
        .filter((entry) => !isMessagePending(entry, nowMs))
        .filter((entry) => String(entry.text ?? "").toLowerCase().includes(query))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map((entry) => hydrateMessage(db, entry, userId));
    });
  }

  /// Own pending scheduled messages (for manage/cancel UI).
  async function listScheduledMessages(userId, chatId) {
    return store.read((db) => {
      ensureMembership(db, chatId, userId);
      const nowMs = Date.now();
      return db.messages
        .filter((entry) => entry.chatId === chatId && entry.senderId === userId)
        .filter((entry) => isMessagePending(entry, nowMs))
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
        .slice(0, 50)
        .map((entry) => hydrateMessage(db, entry, userId));
    });
  }

  /// Publishes due scheduled messages (called by the scheduler tick).
  /// Returns sender-hydrated messages plus member lists for fanout.
  async function collectDueScheduledMessages() {
    const nowMs = Date.now();
    const due = await store.transact((db) => {
      const ready = db.messages.filter(
        (entry) => entry.scheduledAt && !isMessagePending(entry, nowMs),
      );
      const out = [];
      for (const entry of ready) {
        entry.scheduledAt = null;
        const chat = db.chats.find((item) => item.id === entry.chatId);
        if (chat) {
          chat.updatedAt = nowIso();
        }
        out.push({ chatId: entry.chatId, messageId: entry.id, senderId: entry.senderId });
      }
      return out;
    });

    const published = [];
    for (const item of due) {
      try {
        const memberIds = await getChatMemberIds(item.chatId);
        const message = await getMessageForUser(item.senderId, item.chatId, item.messageId);
        published.push({ message, memberIds });
      } catch {
        // Chat/member vanished mid-publish; the message itself is already due.
      }
    }
    return published;
  }

  async function sendTextMessage(userId, chatId, payload) {
    return sendTextToStream(userId, chatId, payload, "main");
  }

  async function sendComment(userId, chatId, payload) {
    return sendTextToStream(userId, chatId, payload, "comment");
  }

  async function sendFileMessage(userId, chatId, file, payload = {}) {
    const parsedPayload = sendFilePayloadSchema.parse(payload ?? {});
    const stream = parsedPayload.stream ?? "main";
    const caption = trimText(parsedPayload.text);
    const clientMessageId = trimText(parsedPayload.clientMessageId);

    if (!file) {
      throw new HttpError(400, "File payload is missing");
    }

    return store.transact((db) => {
      ensureNotBanned(db, userId);
      ensureNotChatBanned(db, chatId, userId);
      ensureNotMuted(db, chatId, userId);
      const chat = ensureCanPublishToStream(db, chatId, userId, stream);
      const membership = ensureMembership(db, chatId, userId);
      ensureDirectDeliveryAllowed(db, chat, userId, { voice: isVoiceLikeFile(file) });
      ensureChatSendAllowed(db, chat, membership, { kind: "file", filePermissionKey: detectFilePermissionKey(file) });
      const supportTicket = resolveSupportTicketForOutgoingMessage(db, config, chat, userId);
      // Intentionally no file size/month traffic limit checks here.

      if (clientMessageId) {
        const existing = db.messages.find(
          (entry) =>
            entry.chatId === chatId &&
            entry.senderId === userId &&
            trimText(entry.clientMessageId) === clientMessageId &&
            (entry.stream ?? "main") === stream,
        );
        if (existing) {
          return hydrateMessage(db, existing, userId);
        }
      }

      let threadRootId = null;
      if (stream === "comment" && parsedPayload.threadRootId) {
        const threadRoot = db.messages.find((entry) => entry.id === parsedPayload.threadRootId && entry.chatId === chatId);
        if (!threadRoot || (threadRoot.stream ?? "main") !== "main") {
          throw new HttpError(404, "Comment thread root message not found");
        }
        threadRootId = threadRoot.id;
      }

      let replyToMessageId = null;
      if (parsedPayload.replyToMessageId) {
        const replyTarget = db.messages.find((entry) => entry.id === parsedPayload.replyToMessageId && entry.chatId === chatId);
        if (!replyTarget) {
          throw new HttpError(404, "Reply target message not found");
        }
        const replyStream = replyTarget.stream ?? "main";
        const allowedReply = replyStream === stream || (stream === "comment" && replyStream === "main");
        if (!allowedReply) {
          throw new HttpError(400, "Reply target stream mismatch");
        }
        replyToMessageId = replyTarget.id;
      }

      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + config.fileRetentionDays * 24 * 60 * 60 * 1000).toISOString();
      const fileId = uuid();
      const originalName = normalizeUploadedOriginalName(file) || "file";
      db.files.push({
        id: fileId,
        chatId,
        uploaderId: userId,
        originalName,
        mimeType: trimText(file.mimetype) || "application/octet-stream",
        size: file.size,
        storageName: file.filename,
        path: file.path,
        expiresAt,
        createdAt,
      });

      chat.updatedAt = createdAt;
      const message = {
        id: uuid(),
        chatId,
        senderId: userId,
        type: "file",
        text: caption,
        clientMessageId: clientMessageId || null,
        fileId,
        location: null,
        poll: null,
        stream,
        threadRootId,
        replyToMessageId,
        reactions: [],
        readByUserIds: [],
        createdAt,
      };
      db.messages.push(message);
      appendSupportTicketMessage(supportTicket, message.id, createdAt);
      return hydrateMessage(db, message, userId);
    });
  }

  function canDeleteMessage(chat, actorRole, senderId, actorId) {
    if (senderId === actorId) {
      return true;
    }

    if (chat.type === "direct") {
      return true;
    }

    if (chat.type !== "direct" && ["owner", "admin"].includes(actorRole)) {
      return true;
    }

    return false;
  }

  function canEditMessage(chat, actorRole, senderId, actorId) {
    if (senderId === actorId) {
      return true;
    }

    if (chat.type !== "direct" && ["owner", "admin"].includes(actorRole)) {
      return true;
    }

    return false;
  }

  async function editMessage(userId, chatId, messageId, payload = {}) {
    const parsed = editMessageSchema.parse(payload ?? {});
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      const actor = ensureMembership(db, chatId, userId);
      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }

      if (!canEditMessage(chat, actor.role, message.senderId, userId)) {
        throw new HttpError(403, "Not enough permissions");
      }

      const nextText = trimText(parsed.text);
      if (!nextText) {
        throw new HttpError(400, "Message text is empty");
      }

      const minText = message.type === "file" ? nextText : nextText;
      message.text = minText;
      message.editedAt = nowIso();
      chat.updatedAt = nowIso();
      return hydrateMessage(db, message, userId);
    });
  }

  async function deleteMessage(userId, chatId, messageId) {
    const result = await store.transact((db) => {
      const chat = findChat(db, chatId);
      const actor = ensureMembership(db, chatId, userId);
      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }

      if (!canDeleteMessage(chat, actor.role, message.senderId, userId)) {
        throw new HttpError(403, "Not enough permissions");
      }

      let filePath = null;
      if (message.fileId) {
        const file = db.files.find((entry) => entry.id === message.fileId);
        if (file) {
          filePath = file.path;
        }
      }

      db.messages = db.messages.filter((entry) => entry.id !== messageId);
      db.reports = db.reports.filter((entry) => entry.messageId !== messageId);
      if (message.fileId) {
        db.files = db.files.filter((entry) => entry.id !== message.fileId);
      }

      chat.updatedAt = nowIso();
      return {
        chatId,
        messageId,
        stream: message.stream ?? "main",
        threadRootId: trimText(message.threadRootId) || null,
        filePath,
      };
    });

    if (result.filePath) {
      try {
        await fs.unlink(path.resolve(result.filePath));
      } catch {
        // Ignore missing file on disk.
      }
    }

    return result;
  }

  async function forwardMessage(userId, sourceChatId, messageId, payload = {}) {
    const parsed = forwardMessageSchema.parse(payload ?? {});
    const targetChatId = parsed.targetChatId;
    const targetStream = parsed.stream ?? "main";

    let sourceSnapshot = null;
    await store.read((db) => {
      ensureMembership(db, sourceChatId, userId);
      ensureMembership(db, targetChatId, userId);
      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === sourceChatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }

      const file = message.fileId ? db.files.find((entry) => entry.id === message.fileId) : null;
      sourceSnapshot = { message: { ...message }, file: file ? { ...file } : null };
    });

    const now = nowIso();
    let forwardedFile = null;
    if (sourceSnapshot?.message?.type === "file" && sourceSnapshot.file) {
      const ext = path.extname(sourceSnapshot.file.originalName || sourceSnapshot.file.storageName || "");
      const storageName = `${uuid()}${ext}`;
      const destinationPath = path.join(config.uploadDir, storageName);
      await fs.copyFile(path.resolve(sourceSnapshot.file.path), destinationPath);
      forwardedFile = {
        id: uuid(),
        chatId: targetChatId,
        uploaderId: userId,
        originalName: sourceSnapshot.file.originalName,
        storageName,
        mimeType: sourceSnapshot.file.mimeType,
        size: sourceSnapshot.file.size,
        path: destinationPath,
        createdAt: now,
        expiresAt: sourceSnapshot.file.expiresAt,
      };
    }

    try {
      return await store.transact((db) => {
        ensureNotBanned(db, userId);
        ensureNotChatBanned(db, targetChatId, userId);
        ensureNotMuted(db, targetChatId, userId);
        const chat = ensureCanPublishToStream(db, targetChatId, userId, targetStream);

        const sourceMessage = db.messages.find((entry) => entry.id === messageId && entry.chatId === sourceChatId);
        if (!sourceMessage) {
          throw new HttpError(404, "Message not found");
        }
        const forwardingVoice = sourceMessage.type === "file" && isVoiceLikeFile(sourceSnapshot?.file ?? {});
        ensureDirectDeliveryAllowed(db, chat, userId, { voice: forwardingVoice });

        enforceMonthLimit(db, userId, byteLength(sourceMessage.text), config.monthLimitBytes);

        if (forwardedFile) {
          db.files.push(forwardedFile);
        }

        const message = {
          id: uuid(),
          chatId: targetChatId,
          senderId: userId,
          type: sourceMessage.type,
          text: sourceMessage.text,
          fileId: forwardedFile?.id ?? null,
          location:
            sourceMessage?.location && typeof sourceMessage.location === "object"
              ? {
                  lat: Number(sourceMessage.location.lat),
                  lng: Number(sourceMessage.location.lng),
                  title: trimText(sourceMessage.location.title),
                  address: trimText(sourceMessage.location.address),
                  mapUrl: trimText(sourceMessage.location.mapUrl),
                }
              : null,
          poll: sourceMessage?.poll ? normalizeStoredPoll(sourceMessage.poll) : null,
          stream: targetStream,
          threadRootId: targetStream === "comment" ? trimText(sourceMessage.threadRootId) || null : null,
          replyToMessageId: null,
          reactions: [],
          readByUserIds: [],
          createdAt: now,
          forwardedFrom: {
            chatId: sourceChatId,
            messageId: sourceMessage.id,
            senderId: sourceMessage.senderId,
          },
        };
        db.messages.push(message);
        chat.updatedAt = now;
        return hydrateMessage(db, message, userId);
      });
    } catch (error) {
      if (forwardedFile?.path) {
        try {
          await fs.unlink(path.resolve(forwardedFile.path));
        } catch {
          // Ignore cleanup errors.
        }
      }
      throw error;
    }
  }

  async function updateChat(userId, chatId, payload) {
    const parsed = updateChatSchema.parse(payload ?? {});

    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        ensureMembership(db, chatId, userId);
        const hasUnsupportedDirectPatch =
          parsed.title !== undefined ||
          parsed.description !== undefined ||
          parsed.avatar !== undefined ||
          parsed.isPublic !== undefined ||
          parsed.handle !== undefined;
        if (hasUnsupportedDirectPatch) {
          throw new HttpError(400, "Direct chat cannot be edited");
        }
        const settingsPatch = parsed.settings ?? {};
        const directWallpaperPatch = {};
        if (settingsPatch.wallpaperPreset !== undefined) {
          directWallpaperPatch.wallpaperPreset = trimText(settingsPatch.wallpaperPreset ?? "").slice(0, 64);
        }
        if (settingsPatch.wallpaper !== undefined) {
          directWallpaperPatch.wallpaper = trimText(settingsPatch.wallpaper ?? "").slice(0, 15_000_000);
        }
        if (settingsPatch.wallpaperBlur !== undefined) {
          directWallpaperPatch.wallpaperBlur = Math.max(0, Math.min(100, Number.parseInt(settingsPatch.wallpaperBlur, 10) || 0));
        }
        if (settingsPatch.wallpaperDim !== undefined) {
          directWallpaperPatch.wallpaperDim = Math.max(0, Math.min(100, Number.parseInt(settingsPatch.wallpaperDim, 10) || 0));
        }
        if (!Object.keys(directWallpaperPatch).length) {
          throw new HttpError(400, "Direct chat cannot be edited");
        }
        chat.settings = mergeChatSettings(chat.type, chat.settings, directWallpaperPatch);
        chat.updatedAt = nowIso();
        return hydrateChatForUser(db, chat, userId);
      }

      ensureRole(db, chatId, userId, ["owner", "admin"]);

      if (parsed.title !== undefined) {
        const title = normalizeTitle(parsed.title);
        if (!title) {
          throw new HttpError(400, "Chat title is invalid");
        }
        if (chat.type === "group") {
          ensureGroupTitle(title);
        }
        chat.title = title;
      }

      if (parsed.description !== undefined) {
        chat.description = trimText(parsed.description ?? "");
      }

      if (parsed.avatar !== undefined) {
        chat.avatar = trimText(parsed.avatar ?? "");
      }

      if (parsed.settings !== undefined) {
        chat.settings = mergeChatSettings(chat.type, chat.settings, parsed.settings);
      }

      if (parsed.isPublic !== undefined || parsed.handle !== undefined) {
        if (chat.type !== "group" && chat.type !== "channel") {
          throw new HttpError(403, "Public publishing is available only for groups/channels");
        }

        const nextPublic = parsed.isPublic ?? chat.isPublic;
        let nextHandle = chat.handle;

        if (parsed.handle !== undefined) {
          const handleInput = parsed.handle === null ? "" : String(parsed.handle);
          nextHandle = normalizePublicHandle(handleInput);
          if (handleInput && !nextHandle) {
            throw new HttpError(400, "Chat handle format is invalid");
          }
        }

        if (nextPublic && !nextHandle) {
          throw new HttpError(400, "Public chat requires a valid handle");
        }

        if (!nextPublic) {
          nextHandle = null;
        }

        assertHandleUniqueness(db, nextHandle, chat.id);
        chat.isPublic = nextPublic;
        chat.handle = nextHandle;
      }

      chat.updatedAt = nowIso();
      return hydrateChatForUser(db, chat, userId);
    });
  }

  async function deleteChat(userId, chatId) {
    const result = await store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        ensureMembership(db, chatId, userId);
      } else {
        ensureRole(db, chatId, userId, ["owner", "admin"]);
      }

      const memberIds = db.memberships.filter((entry) => entry.chatId === chatId).map((entry) => entry.userId);
      const filePaths = db.files.filter((entry) => entry.chatId === chatId).map((entry) => entry.path);

      db.chats = db.chats.filter((entry) => entry.id !== chatId);
      db.memberships = db.memberships.filter((entry) => entry.chatId !== chatId);
      db.messages = db.messages.filter((entry) => entry.chatId !== chatId);
      db.files = db.files.filter((entry) => entry.chatId !== chatId);
      db.callLogs = db.callLogs.filter((entry) => entry.chatId !== chatId);
      db.reports = db.reports.filter((entry) => entry.chatId !== chatId);
      db.mutes = db.mutes.filter((entry) => entry.chatId !== chatId);

      return { chatId, memberIds, filePaths };
    });

    await Promise.all(
      result.filePaths.map(async (filePath) => {
        if (!filePath) {
          return;
        }
        try {
          await fs.unlink(path.resolve(filePath));
        } catch {
          // Ignore missing file entries on disk.
        }
      }),
    );

    return {
      chatId: result.chatId,
      memberIds: result.memberIds,
    };
  }

  function resolveUserForMemberPayload(db, payload) {
    const parsed = memberPayloadSchema.parse(payload ?? {});

    if (parsed.memberId) {
      const user = db.users.find((entry) => entry.id === parsed.memberId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      return user;
    }

    const user = findUserByLookup(db, parsed.memberUsername);
    if (!user) {
      throw new HttpError(404, "User not found");
    }
    return user;
  }

  function ensureCanManageMembers(db, chat, actorUserId) {
    const actor = ensureMembership(db, chat.id, actorUserId);
    const settings = mergeChatSettings(chat.type, chat.settings, {});
    const canInviteBySettings =
      chat.type === "group" &&
      settings.allowMemberInvites &&
      settings.permissions?.addMembers !== false &&
      actor.role === "member";

    if (["owner", "admin"].includes(actor.role) || canInviteBySettings) {
      return actor;
    }

    throw new HttpError(403, "Not enough permissions");
  }

  function ensureCanModerateChatMember(db, chatId, actorUserId, targetUserId) {
    const actor = ensureMembership(db, chatId, actorUserId);
    const target = ensureMembership(db, chatId, targetUserId);
    if (target.role === "owner") {
      throw new HttpError(403, "Owner cannot be moderated");
    }
    if (actor.userId === target.userId) {
      throw new HttpError(400, "You cannot moderate yourself");
    }
    if (actor.role === "owner") {
      return { actor, target };
    }
    if (actor.role === "admin" && target.role === "member") {
      return { actor, target };
    }
    throw new HttpError(403, "Not enough permissions");
  }

  function ensureChatBotAttachAllowed(chat, user, { allowBots = false } = {}) {
    if (!user?.isBot) {
      return;
    }

    if (user.isSystemBot) {
      throw new HttpError(400, "Yooh Support bot cannot be added to groups or channels");
    }

    if (!allowBots) {
      throw new HttpError(400, "Bots can be added only via add bots action");
    }

    if (chat.type !== "group" && chat.type !== "channel" && chat.type !== "server") {
      throw new HttpError(400, "Bots can be added only to groups, channels or servers");
    }
  }

  async function addMemberInternal(userId, chatId, payload, { allowBots = false } = {}) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Cannot add member to direct chat");
      }

      ensureCanManageMembers(db, chat, userId);
      const user = resolveUserForMemberPayload(db, payload);
      ensureChatBotAttachAllowed(chat, user, { allowBots });
      ensureNotChatBanned(db, chatId, user.id);
      if (!user.isBot && !canViewerInviteTarget(db, user, userId)) {
        throw new HttpError(403, "Inviting this user is restricted by privacy");
      }

      const exists = db.memberships.find((entry) => entry.chatId === chatId && entry.userId === user.id);
      if (exists) {
        return {
          userId: user.id,
          role: exists.role,
        };
      }

      db.memberships.push({
        id: uuid(),
        chatId,
        userId: user.id,
        role: "member",
        joinedAt: nowIso(),
      });
      chat.updatedAt = nowIso();

      return {
        userId: user.id,
        role: "member",
      };
    });
  }

  async function addMember(userId, chatId, payload) {
    return addMemberInternal(userId, chatId, payload, { allowBots: false });
  }

  async function addBotMember(userId, chatId, payload) {
    return addMemberInternal(userId, chatId, payload, { allowBots: true });
  }

  async function setMemberRole(userId, chatId, memberId, role) {
    const parsedRole = roleSchema.parse(role);
    return store.transact((db) => {
      ensureRole(db, chatId, userId, ["owner"]);
      const member = db.memberships.find((entry) => entry.chatId === chatId && entry.userId === memberId);
      if (!member) {
        throw new HttpError(404, "Chat member not found");
      }

      if (parsedRole === "owner") {
        throw new HttpError(400, "Owner role transfer is not supported");
      }

      member.role = parsedRole;
      const chat = findChat(db, chatId);
      chat.updatedAt = nowIso();
      return {
        userId: member.userId,
        role: member.role,
      };
    });
  }

  async function removeMember(userId, chatId, memberId) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Cannot remove member from direct chat");
      }

      const actor = ensureMembership(db, chatId, userId);
      const target = db.memberships.find((entry) => entry.chatId === chatId && entry.userId === memberId);
      if (!target) {
        throw new HttpError(404, "Chat member not found");
      }

      if (target.role === "owner") {
        throw new HttpError(400, "Owner cannot be removed");
      }

      const selfRemoval = userId === memberId;
      if (!selfRemoval) {
        if (actor.role === "owner") {
          // owner can remove admin/member
        } else if (actor.role === "admin" && target.role === "member") {
          // admin can remove member
        } else {
          throw new HttpError(403, "Not enough permissions");
        }
      }

      db.memberships = db.memberships.filter((entry) => !(entry.chatId === chatId && entry.userId === memberId));
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === memberId));
      chat.updatedAt = nowIso();

      return {
        removed: true,
        userId: memberId,
      };
    });
  }

  async function toggleMessageReaction(userId, chatId, messageId, emoji) {
    const safeEmoji = trimText(emoji).slice(0, 32);
    if (!safeEmoji) {
      throw new HttpError(400, "Reaction emoji is required");
    }

    return store.transact((db) => {
      const chat = findChat(db, chatId);
      ensureMembership(db, chatId, userId);
      const settings = mergeChatSettings(chat.type, chat.settings, {});
      if (settings.reactionsEnabled === false) {
        throw new HttpError(403, "Reactions are disabled in this chat");
      }
      if (Array.isArray(settings.allowedReactions) && settings.allowedReactions.length && !settings.allowedReactions.includes(safeEmoji)) {
        throw new HttpError(403, "This reaction is not allowed in this chat");
      }

      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }

      const reactions = normalizeMessageReactions(message.reactions);
      const existing = reactions.find((entry) => entry.emoji === safeEmoji);
      for (const reaction of reactions) {
        if (reaction.emoji === safeEmoji) {
          continue;
        }
        if (reaction.userIds.includes(userId)) {
          reaction.userIds = reaction.userIds.filter((entry) => entry !== userId);
        }
      }
      if (existing) {
        if (existing.userIds.includes(userId)) {
          existing.userIds = existing.userIds.filter((entry) => entry !== userId);
        } else {
          existing.userIds = uniqueIds([...existing.userIds, userId]);
        }
      } else {
        reactions.push({
          emoji: safeEmoji,
          userIds: [userId],
        });
      }
      message.reactions = reactions.filter((entry) => entry.userIds.length > 0);
      chat.updatedAt = nowIso();
      return hydrateMessage(db, message, userId);
    });
  }

  async function votePoll(userId, chatId, messageId, payload = {}) {
    const parsed = pollVoteSchema.parse(payload ?? {});
    const optionIds = uniqueIds((Array.isArray(parsed.optionIds) ? parsed.optionIds : []).map((entry) => trimText(entry)));
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      ensureMembership(db, chatId, userId);
      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }
      if (message.type !== "poll" || !message.poll) {
        throw new HttpError(400, "Message is not a poll");
      }

      const poll = normalizeStoredPoll(message.poll);
      if (!poll) {
        throw new HttpError(400, "Poll payload is invalid");
      }
      const validOptionIds = new Set(poll.options.map((entry) => entry.id));
      const selectedOptionIds = optionIds.filter((entry) => validOptionIds.has(entry));
      if (optionIds.length && !selectedOptionIds.length) {
        throw new HttpError(400, "Poll option is invalid");
      }
      const finalOptionIds = poll.multiple ? selectedOptionIds : selectedOptionIds.slice(0, 1);

      for (const option of poll.options) {
        option.voterIds = option.voterIds.filter((entry) => entry !== userId);
      }
      for (const option of poll.options) {
        if (!finalOptionIds.includes(option.id)) {
          continue;
        }
        option.voterIds = uniqueIds([...option.voterIds, userId]);
      }

      message.poll = poll;
      message.updatedAt = nowIso();
      chat.updatedAt = message.updatedAt;
      return hydrateMessage(db, message, userId);
    });
  }

  async function clearChatHistory(userId, chatId) {
    const result = await store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        ensureMembership(db, chatId, userId);
      } else {
        ensureRole(db, chatId, userId, ["owner", "admin"]);
      }

      const filePaths = db.files.filter((entry) => entry.chatId === chatId).map((entry) => entry.path);
      const removedMessages = db.messages.filter((entry) => entry.chatId === chatId).length;

      db.messages = db.messages.filter((entry) => entry.chatId !== chatId);
      db.files = db.files.filter((entry) => entry.chatId !== chatId);
      db.reports = db.reports.filter((entry) => entry.chatId !== chatId);
      chat.updatedAt = nowIso();
      const memberIds = db.memberships.filter((entry) => entry.chatId === chatId).map((entry) => entry.userId);

      return {
        chatId,
        removedMessages,
        filePaths,
        memberIds,
      };
    });

    await Promise.all(
      result.filePaths.map(async (filePath) => {
        if (!filePath) {
          return;
        }
        try {
          await fs.unlink(path.resolve(filePath));
        } catch {
          // Ignore missing files on disk.
        }
      }),
    );

    return {
      chatId: result.chatId,
      removedMessages: result.removedMessages,
      memberIds: result.memberIds,
    };
  }

  async function getFileForUser(userId, fileId) {
    return store.read((db) => {
      const file = db.files.find((entry) => entry.id === fileId);
      if (!file) {
        throw new HttpError(404, "File not found");
      }

      ensureMembership(db, file.chatId, userId);
      return file;
    });
  }

  async function reportMessage(userId, chatId, messageId, reason = "") {
    return store.transact((db) => {
      ensureMembership(db, chatId, userId);
      const message = db.messages.find((entry) => entry.id === messageId && entry.chatId === chatId);
      if (!message) {
        throw new HttpError(404, "Message not found");
      }

      const existing = db.reports.find((entry) => entry.messageId === messageId && entry.reporterId === userId);
      if (existing) {
        return existing;
      }

      const report = {
        id: uuid(),
        chatId,
        messageId,
        reporterId: userId,
        reportedUserId: message.senderId,
        reason: trimText(reason) || "Not specified",
        status: "open",
        createdAt: nowIso(),
      };
      db.reports.push(report);
      return report;
    });
  }

  async function setBan(userId, reason = "", expiresAt = null) {
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      db.bans = db.bans.filter((entry) => entry.userId !== userId);
      const ban = {
        id: uuid(),
        userId,
        reason: trimText(reason) || "Policy violation",
        createdAt: nowIso(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      db.bans.push(ban);
      return ban;
    });
  }

  async function removeBan(userId) {
    return store.transact((db) => {
      const before = db.bans.length;
      db.bans = db.bans.filter((entry) => entry.userId !== userId);
      return { removed: before - db.bans.length };
    });
  }

  async function setMute(chatId, userId, reason = "", expiresAt = null) {
    return store.transact((db) => {
      findChat(db, chatId);
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }

      ensureMembership(db, chatId, userId);
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      const mute = {
        id: uuid(),
        chatId,
        userId,
        reason: trimText(reason) || "Muted by admin",
        createdAt: nowIso(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      db.mutes.push(mute);
      return mute;
    });
  }

  async function removeMute(chatId, userId) {
    return store.transact((db) => {
      const before = db.mutes.length;
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      return { removed: before - db.mutes.length };
    });
  }

  async function setChatBan(actorUserId, chatId, userId, reason = "", expiresAt = null) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Direct chats do not support chat bans");
      }
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      ensureCanModerateChatMember(db, chatId, actorUserId, userId);
      db.chatBans = (db.chatBans ?? []).filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      const ban = {
        id: uuid(),
        chatId,
        userId,
        reason: trimText(reason) || "Banned by chat admin",
        createdAt: nowIso(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        actorUserId,
      };
      db.chatBans.push(ban);
      db.memberships = db.memberships.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      chat.updatedAt = nowIso();
      return ban;
    });
  }

  async function removeChatBan(actorUserId, chatId, userId) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Direct chats do not support chat bans");
      }
      ensureRole(db, chatId, actorUserId, ["owner", "admin"]);
      const before = (db.chatBans ?? []).length;
      db.chatBans = (db.chatBans ?? []).filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      return { removed: before - db.chatBans.length };
    });
  }

  async function setChatMute(actorUserId, chatId, userId, reason = "", expiresAt = null) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Direct chats do not support chat mutes");
      }
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      ensureCanModerateChatMember(db, chatId, actorUserId, userId);
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      const mute = {
        id: uuid(),
        chatId,
        userId,
        reason: trimText(reason) || "Muted by chat admin",
        createdAt: nowIso(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        actorUserId,
      };
      db.mutes.push(mute);
      chat.updatedAt = nowIso();
      return mute;
    });
  }

  async function removeChatMute(actorUserId, chatId, userId) {
    return store.transact((db) => {
      const chat = findChat(db, chatId);
      if (chat.type === "direct") {
        throw new HttpError(400, "Direct chats do not support chat mutes");
      }
      ensureRole(db, chatId, actorUserId, ["owner", "admin"]);
      const before = db.mutes.length;
      db.mutes = db.mutes.filter((entry) => !(entry.chatId === chatId && entry.userId === userId));
      return { removed: before - db.mutes.length };
    });
  }

  async function removeReport(reportId) {
    return store.transact((db) => {
      const safeReportId = trimText(reportId);
      if (!safeReportId) {
        throw new HttpError(400, "reportId is required");
      }

      const before = db.reports.length;
      db.reports = db.reports.filter((entry) => entry.id !== safeReportId);
      if (before === db.reports.length) {
        throw new HttpError(404, "Report not found");
      }

      return { removed: 1 };
    });
  }

  async function createFeedbackTicket(userId, payload = {}) {
    const parsed = feedbackTicketSchema.parse(payload ?? {});
    return store.transact((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      if (user.feedbackBlocked) {
        throw new HttpError(403, "Feedback is blocked for this user");
      }
      const ticket = {
        id: uuid(),
        userId,
        category: parsed.category,
        message: trimText(parsed.message),
        createdAt: nowIso(),
      };
      db.feedbackTickets = Array.isArray(db.feedbackTickets) ? db.feedbackTickets : [];
      db.feedbackTickets.push(ticket);
      return ticket;
    });
  }

  async function listFeedbackTickets() {
    return store.read((db) =>
      (Array.isArray(db.feedbackTickets) ? db.feedbackTickets : [])
        .map((entry) => {
          const user = db.users.find((candidate) => candidate.id === entry.userId) ?? null;
          return {
            ...entry,
            user: user
              ? {
                  id: user.id,
                  username: user.username,
                  displayName: user.displayName,
                  phone: user.phone,
                  feedbackBlocked: Boolean(user.feedbackBlocked),
                }
              : null,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    );
  }

  async function removeFeedbackTicket(ticketId) {
    return store.transact((db) => {
      const safeTicketId = trimText(ticketId);
      if (!safeTicketId) {
        throw new HttpError(400, "ticketId is required");
      }
      const before = (db.feedbackTickets ?? []).length;
      db.feedbackTickets = (db.feedbackTickets ?? []).filter((entry) => entry.id !== safeTicketId);
      if (before === db.feedbackTickets.length) {
        throw new HttpError(404, "Feedback ticket not found");
      }
      return { removed: 1 };
    });
  }

  async function logError(payload = {}) {
    const source = normalizeErrorSource(payload.source);
    const userId = trimText(payload.userId);
    const endpoint = sanitizeErrorText(payload.endpoint, 260);
    const message = sanitizeErrorText(payload.message, 2000);
    const stack = sanitizeErrorText(payload.stack, 8000);
    const url = sanitizeErrorText(payload.url, 2000);
    const userAgent = sanitizeErrorText(payload.userAgent, 500);
    const platform = sanitizeErrorText(payload.platform, 48);
    const extra = sanitizeErrorText(payload.extra, 2000);
    const statusCodeRaw = Number.parseInt(payload.statusCode, 10);
    const statusCode = Number.isFinite(statusCodeRaw) ? Math.max(0, Math.min(999, statusCodeRaw)) : null;

    if (!message) {
      throw new HttpError(400, "Error message is required");
    }

    if (shouldIgnoreErrorLogEntry({ message, statusCode, endpoint })) {
      return null;
    }

    return store.transact((db) => {
      if (userId && !db.users.some((entry) => entry.id === userId)) {
        throw new HttpError(404, "User not found");
      }

      const entry = {
        id: uuid(),
        source,
        userId: userId || null,
        endpoint: endpoint || null,
        message,
        stack: stack || null,
        url: url || null,
        userAgent: userAgent || null,
        platform: platform || null,
        extra: extra || null,
        statusCode,
        createdAt: nowIso(),
      };
      db.errorLogs.push(entry);
      if (db.errorLogs.length > ERROR_LOG_MAX_ENTRIES) {
        db.errorLogs = db.errorLogs
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, ERROR_LOG_MAX_ENTRIES);
      }
      return entry;
    });
  }

  async function listErrorLogs(options = {}) {
    const limitRaw = Number.parseInt(options.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 200 : Math.min(Math.max(limitRaw, 1), 1000);

    return store.read((db) =>
      db.errorLogs
        .filter((entry) => !shouldIgnoreErrorLogEntry(entry))
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map((entry) => {
          const user = entry.userId ? db.users.find((candidate) => candidate.id === entry.userId) ?? null : null;
          return {
            ...entry,
            user: user
              ? {
                  id: user.id,
                  chatId: user.chatId,
                  username: user.username,
                  displayName: user.displayName,
                }
              : null,
          };
        }),
    );
  }

  async function removeErrorLog(errorLogId) {
    return store.transact((db) => {
      const safeId = trimText(errorLogId);
      if (!safeId) {
        throw new HttpError(400, "errorLogId is required");
      }

      const before = db.errorLogs.length;
      db.errorLogs = db.errorLogs.filter((entry) => entry.id !== safeId);
      if (before === db.errorLogs.length) {
        throw new HttpError(404, "Error log not found");
      }
      return { removed: 1 };
    });
  }

  async function getModerationState() {
    return store.read((db) => {
      const activeBans = db.bans
        .filter((entry) => isActive(entry.expiresAt))
        .map((entry) => {
          const user = db.users.find((candidate) => candidate.id === entry.userId);
          return {
            ...entry,
            user: user
              ? {
                  id: user.id,
                  username: user.username,
                  displayName: user.displayName,
                }
              : null,
          };
        });

      const activeMutes = db.mutes
        .filter((entry) => isActive(entry.expiresAt))
        .map((entry) => {
          const user = db.users.find((candidate) => candidate.id === entry.userId);
          const chat = db.chats.find((candidate) => candidate.id === entry.chatId);
          return {
            ...entry,
            user: user
              ? {
                  id: user.id,
                  username: user.username,
                  displayName: user.displayName,
                }
              : null,
            chat: chat
              ? {
                  id: chat.id,
                  type: chat.type,
                  title: chat.title,
                  handle: chat.handle,
                }
              : null,
          };
        });

      const reports = db.reports
        .map((entry) => {
          const reporter = db.users.find((candidate) => candidate.id === entry.reporterId);
          const reportedUser = db.users.find((candidate) => candidate.id === entry.reportedUserId);
          const chat = db.chats.find((candidate) => candidate.id === entry.chatId);
          return {
            ...entry,
            reporter: reporter
              ? {
                  id: reporter.id,
                  username: reporter.username,
                  displayName: reporter.displayName,
                }
              : null,
            reportedUser: reportedUser
              ? {
                  id: reportedUser.id,
                  username: reportedUser.username,
                  displayName: reportedUser.displayName,
                }
              : null,
            chat: chat
              ? {
                  id: chat.id,
                  type: chat.type,
                  title: chat.title,
                  handle: chat.handle,
                }
              : null,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        bans: activeBans,
        mutes: activeMutes,
        chatBans: (db.chatBans ?? [])
          .filter((entry) => isActive(entry.expiresAt))
          .map((entry) => {
            const user = db.users.find((candidate) => candidate.id === entry.userId);
            const chat = db.chats.find((candidate) => candidate.id === entry.chatId);
            return {
              ...entry,
              user: user
                ? {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                  }
                : null,
              chat: chat
                ? {
                    id: chat.id,
                    type: chat.type,
                    title: chat.title,
                    handle: chat.handle,
                  }
                : null,
            };
          }),
        reports,
      };
    });
  }

  async function purgeExpiredFiles() {
    const now = Date.now();
    const filesToDelete = [];
    let deleted = 0;

    await store.transact((db) => {
      const removedIds = new Set();
      const keep = [];

      for (const file of db.files) {
        if (new Date(file.expiresAt).getTime() <= now) {
          deleted += 1;
          removedIds.add(file.id);
          filesToDelete.push(file.path);
        } else {
          keep.push(file);
        }
      }

      db.files = keep;
      db.messages = db.messages.filter((entry) => !(entry.fileId && removedIds.has(entry.fileId)));
    });

    await Promise.all(
      filesToDelete.map(async (filePath) => {
        if (!filePath) {
          return;
        }
        try {
          await fs.unlink(path.resolve(filePath));
        } catch {
          // Ignore broken paths during cleanup.
        }
      }),
    );

    return { deleted };
  }

  async function getAdminStats() {
    return store.read((db) => {
      const usersByUsage = [...db.users]
        .sort((a, b) => b.usedBytes - a.usedBytes)
        .slice(0, 20)
        .map((user) => ({
          id: user.id,
          chatId: user.chatId,
          username: user.username,
          displayName: user.displayName,
          usedBytes: user.usedBytes,
          usageMonth: user.usageMonth,
        }));

      return {
        users: db.users.length,
        plusUsers: db.users.filter((entry) => entry.isPremium).length,
        businessUsers: db.users.filter((entry) => entry.business?.enabled).length,
        starsInCirculation: db.users.reduce((sum, entry) => sum + (Number.parseInt(entry.starsBalance ?? 0, 10) || 0), 0),
        chats: db.chats.length,
        publicChats: db.chats.filter((entry) => entry.type !== "direct" && entry.isPublic).length,
        memberships: db.memberships.length,
        messages: db.messages.length,
        files: db.files.length,
        calls: db.callLogs.length,
        reports: db.reports.length,
        feedback: (db.feedbackTickets ?? []).length,
        supportTickets: (db.supportTickets ?? []).length,
        errors: db.errorLogs.length,
        bans: db.bans.filter((entry) => isActive(entry.expiresAt)).length,
        mutes: db.mutes.filter((entry) => isActive(entry.expiresAt)).length,
        monthLimitBytes: config.monthLimitBytes,
        fileLimitBytes: config.fileLimitBytes,
        fileRetentionDays: config.fileRetentionDays,
        usersByUsage,
      };
    });
  }

  async function listAdminUsers() {
    return store.read((db) => {
      const now = Date.now();

      const users = db.users
        .map((user) => {
          const sessions = db.sessions
            .filter((entry) => entry.userId === user.id && !entry.revokedAt)
            .sort((a, b) => new Date(b.lastSeenAt ?? b.createdAt).getTime() - new Date(a.lastSeenAt ?? a.createdAt).getTime());
          const latestSession = sessions[0] ?? null;
          const latestSeenAt = latestSession?.lastSeenAt ?? latestSession?.createdAt ?? null;
          const latestSeenAtMs = latestSeenAt ? new Date(latestSeenAt).getTime() : Number.NaN;
          const online = Number.isFinite(latestSeenAtMs) ? now - latestSeenAtMs <= 2 * 60 * 1000 : false;

          return {
            id: user.id,
            chatId: user.chatId,
            username: user.username,
            displayName: user.displayName,
            phone: user.phone ?? "",
            isPremium: Boolean(user.isPremium),
            starsBalance: Math.max(0, Number.parseInt(user.starsBalance ?? 0, 10) || 0),
            businessEnabled: Boolean(user.business?.enabled),
            feedbackBlocked: Boolean(user.feedbackBlocked),
            emojiStatus: trimText(user.emojiStatus),
            createdAt: user.createdAt,
            usedBytes: user.usedBytes ?? 0,
            online,
            lastSeenAt: latestSeenAt,
            activeSessions: sessions.length,
          };
        })
        .sort((a, b) => {
          if (a.online !== b.online) {
            return Number(b.online) - Number(a.online);
          }
          const aSeen = new Date(a.lastSeenAt ?? a.createdAt ?? 0).getTime();
          const bSeen = new Date(b.lastSeenAt ?? b.createdAt ?? 0).getTime();
          return bSeen - aSeen;
        });

      return users;
    });
  }

  return {
    listChats,
    listStickerPacks,
    createStickerPack,
    setStickerPackInstalled,
    searchUsers,
    syncContactHashes,
    searchPublicChats,
    joinPublicChatByHandle,
    assertChatAccess,
    markChatRead,
    getChatMemberIds,
    ensureSupportChat,
    sendSystemBotMessageToUser,
    sendSystemBotMessageToTarget,
    broadcastSystemBotMessage,
    broadcastSystemBotStory,
    getSystemBotState,
    getSupportTicketState,
    createSupportTicket,
    listAdminSupportTickets,
    getAdminSupportTicketMessages,
    claimSupportTicket,
    replySupportTicket,
    closeSupportTicket,
    listStories,
    publishStory,
    publishSystemStory,
    deleteStory,
    markStoryViewed,
    reactToStory,
    commentOnLiveStory,
    listCallLogs,
    removeCallLog,
    recordCallStatus,
    createChat,
    listMessages,
    searchMessages,
    listScheduledMessages,
    collectDueScheduledMessages,
    getMessageForUser,
    sendTextMessage,
    sendComment,
    sendFileMessage,
    editMessage,
    deleteMessage,
    forwardMessage,
    updateChat,
    deleteChat,
    addMember,
    addBotMember,
    setMemberRole,
    removeMember,
    clearChatHistory,
    toggleMessageReaction,
    votePoll,
    getFileForUser,
    reportMessage,
    setBan,
    removeBan,
    setMute,
    removeMute,
    setChatBan,
    removeChatBan,
    setChatMute,
    removeChatMute,
    removeReport,
    createFeedbackTicket,
    listFeedbackTickets,
    removeFeedbackTicket,
    logError,
    listErrorLogs,
    removeErrorLog,
    getModerationState,
    purgeExpiredFiles,
    getAdminStats,
    listAdminUsers,
  };
}


