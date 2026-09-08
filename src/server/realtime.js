import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const CALL_SESSION_TTL_MS = 5 * 60 * 1000;
const CALL_DISCONNECT_GRACE_MS = 12 * 1000;
const SIGNAL_TYPES = new Set(["offer", "answer", "ice-candidate"]);
const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;
const TYPING_ACTIONS = new Set(["text", "audio", "emoji", "file"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCallMode(value) {
  return normalizeString(value) === "video" ? "video" : "audio";
}

function normalizeTypingAction(value) {
  const action = normalizeString(value).toLowerCase();
  return TYPING_ACTIONS.has(action) ? action : "text";
}

function isSafeSignalPayload(signal) {
  if (!signal || typeof signal !== "object") {
    return false;
  }

  try {
    const size = Buffer.byteLength(JSON.stringify(signal), "utf8");
    return size > 0 && size <= MAX_SIGNAL_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function toPublicUser(user) {
  return {
    id: user.id,
    chatId: user.chatId,
    username: user.username,
    displayName: user.displayName,
    isPremium: Boolean(user.isPremium),
    premiumBadge: user.premiumBadge ?? null,
  };
}

function getAck(ack) {
  return typeof ack === "function" ? ack : null;
}

function ackResult(ack, payload) {
  if (ack) {
    ack(payload);
  }
}

function cleanupExpiredSessions(callSessions) {
  const now = Date.now();
  for (const [sessionId, session] of callSessions.entries()) {
    if (now - session.createdAt <= CALL_SESSION_TTL_MS) {
      continue;
    }

    callSessions.delete(sessionId);
  }
}

export function attachRealtime(httpServer, services) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 20000,
    pingTimeout: 120000,
    connectTimeout: 25000,
  });

  const callSessions = new Map();
  const callDisconnectTimersByUser = new Map();
  const onlineSocketsByUser = new Map();
  const lastSeenAtByUser = new Map();

  function emitToUsers(userIds, event, payload, exceptUserId = null) {
    for (const userId of userIds ?? []) {
      if (exceptUserId && userId === exceptUserId) {
        continue;
      }
      io.to(`user:${userId}`).emit(event, payload);
    }
  }

  function getSessionParticipants(session) {
    if (!session) {
      return [];
    }

    const activeIds = Array.isArray(session.activeParticipantIds) ? session.activeParticipantIds : [];
    const byUser = session.participantsByUser && typeof session.participantsByUser === "object" ? session.participantsByUser : {};
    return activeIds.map((userId) => byUser[userId]).filter(Boolean);
  }

  function emitSessionParticipants(session) {
    const participants = getSessionParticipants(session);
    if (!participants.length) {
      return;
    }

    emitToUsers(session.activeParticipantIds, "call:participants", {
      sessionId: session.id,
      chatId: session.chatId,
      mode: normalizeCallMode(session.mode),
      participants,
    });
  }

  function markUserOnline(userId) {
    const safeUserId = normalizeString(userId);
    if (!safeUserId) {
      return 0;
    }

    const nextCount = (onlineSocketsByUser.get(safeUserId) ?? 0) + 1;
    onlineSocketsByUser.set(safeUserId, nextCount);
    if (nextCount === 1) {
      lastSeenAtByUser.delete(safeUserId);
    }
    return nextCount;
  }

  function markUserOffline(userId) {
    const safeUserId = normalizeString(userId);
    if (!safeUserId) {
      return { online: false, lastSeenAt: null };
    }

    const currentCount = onlineSocketsByUser.get(safeUserId) ?? 0;
    if (currentCount > 1) {
      onlineSocketsByUser.set(safeUserId, currentCount - 1);
      return { online: true, lastSeenAt: null };
    }

    onlineSocketsByUser.delete(safeUserId);
    const lastSeenAt = new Date().toISOString();
    lastSeenAtByUser.set(safeUserId, lastSeenAt);
    return { online: false, lastSeenAt };
  }

  async function buildPresenceForViewer(viewerUserId, targetUserId, online, lastSeenAt = null) {
    const safeViewerId = normalizeString(viewerUserId);
    const safeTargetId = normalizeString(targetUserId);
    if (!safeViewerId || !safeTargetId) {
      return null;
    }

    if (safeViewerId === safeTargetId) {
      return {
        userId: safeTargetId,
        online: Boolean(online),
        lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
        lastSeenHidden: false,
      };
    }

    let canSeeLastSeen = true;
    try {
      if (typeof services.authService.canViewerSeeLastSeenByUserIds === "function") {
        canSeeLastSeen = await services.authService.canViewerSeeLastSeenByUserIds(safeViewerId, safeTargetId);
      }
    } catch {
      canSeeLastSeen = true;
    }

    if (!canSeeLastSeen) {
      return {
        userId: safeTargetId,
        online: false,
        lastSeenAt: null,
        lastSeenHidden: true,
      };
    }

    return {
      userId: safeTargetId,
      online: Boolean(online),
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
      lastSeenHidden: false,
    };
  }

  async function emitPresenceUpdateForAll(targetUserId, online, lastSeenAt = null) {
    const safeTargetId = normalizeString(targetUserId);
    if (!safeTargetId) {
      return;
    }

    const viewerIds = [...onlineSocketsByUser.keys()];
    await Promise.all(
      viewerIds.map(async (viewerId) => {
        const payload = await buildPresenceForViewer(viewerId, safeTargetId, online, lastSeenAt);
        if (!payload) {
          return;
        }
        io.to(`user:${viewerId}`).emit("presence:update", payload);
      }),
    );
  }

  async function getPresenceSnapshotForViewer(viewerUserId) {
    const safeViewerId = normalizeString(viewerUserId);
    if (!safeViewerId) {
      return {
        onlineUserIds: [],
        lastSeenAtByUser: {},
        hiddenUserIds: [],
      };
    }

    const ids = new Set([...onlineSocketsByUser.keys(), ...lastSeenAtByUser.keys()]);
    const onlineUserIds = [];
    const lastSeenAtByUserPayload = {};
    const hiddenUserIds = [];

    for (const targetUserId of ids) {
      const online = (onlineSocketsByUser.get(targetUserId) ?? 0) > 0;
      const lastSeenAt = lastSeenAtByUser.get(targetUserId) ?? null;
      const payload = await buildPresenceForViewer(safeViewerId, targetUserId, online, lastSeenAt);
      if (!payload) {
        continue;
      }
      if (payload.lastSeenHidden) {
        hiddenUserIds.push(payload.userId);
        continue;
      }
      if (payload.online) {
        onlineUserIds.push(payload.userId);
      } else if (payload.lastSeenAt) {
        lastSeenAtByUserPayload[payload.userId] = payload.lastSeenAt;
      }
    }

    return {
      onlineUserIds,
      lastSeenAtByUser: lastSeenAtByUserPayload,
      hiddenUserIds,
    };
  }

  async function resolveChatForCall(userId, chatId) {
    await services.chatService.assertChatAccess(userId, chatId);
    const chats = await services.chatService.listChats(userId);
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat) {
      throw new Error("Chat not found");
    }

    const callAllowed = chat.type === "direct" || chat.type === "group" || chat.type === "server";
    if (!callAllowed) {
      throw new Error("Calls are available only in direct, group and server chats");
    }

    const memberIds = [...new Set((await services.chatService.getChatMemberIds(chat.id)).filter(Boolean))];
    if (!memberIds.includes(userId)) {
      throw new Error("Call access denied");
    }
    if (chat.type === "direct" && memberIds.length < 2) {
      throw new Error("Call participants are invalid");
    }
    if ((chat.type === "server" || chat.type === "group") && memberIds.length < 2) {
      throw new Error("Add at least one more member before starting a call");
    }

    const peer = chat.type === "direct" ? chat.members.find((member) => member.userId !== userId) ?? null : null;
    if (chat.type === "direct" && peer?.isBot) {
      throw new Error("Calls are unavailable for bots");
    }
    const defaultCalleeId =
      chat.type === "direct" ? peer?.userId ?? null : memberIds.find((memberId) => memberId !== userId) ?? null;
    if (chat.type === "direct" && defaultCalleeId && typeof services.authService.canViewerCallTargetByUserIds === "function") {
      const allowed = await services.authService.canViewerCallTargetByUserIds(userId, defaultCalleeId);
      if (!allowed) {
        throw new Error("Calls are restricted by recipient privacy");
      }
    }

    return {
      chatId: chat.id,
      chatType: chat.type,
      memberIds,
      defaultCalleeId,
      peer: peer
        ? {
            id: peer.userId,
            chatId: peer.chatId,
            username: peer.username,
            displayName: peer.displayName,
          }
        : {
            id: chat.id,
            chatId: chat.id,
            username: chat.handle ?? "",
            displayName: chat.title ?? "Server",
          },
    };
  }

  function getCallSession(sessionId, chatId, userId) {
    cleanupExpiredSessions(callSessions);

    const safeSessionId = normalizeString(sessionId);
    if (!safeSessionId) {
      throw new Error("sessionId is required");
    }

    const session = callSessions.get(safeSessionId);
    if (!session) {
      throw new Error("Call session not found");
    }

    if (chatId && session.chatId !== chatId) {
      throw new Error("Call session does not match chat");
    }

    if (!session.memberIds.includes(userId)) {
      throw new Error("Call access denied");
    }

    return session;
  }

  function emitCallHistoryUpdated(memberIds) {
    for (const userId of memberIds ?? []) {
      io.to(`user:${userId}`).emit("calls:updated");
    }
  }

  function emitCallMessage(result) {
    if (!result?.message) {
      return;
    }

    io.to(result.message.chatId).emit("chat:message", result.message);
    for (const userId of result.memberIds ?? []) {
      io.to(`user:${userId}`).emit("chat:updated", { chatId: result.message.chatId });
    }
    emitCallHistoryUpdated(result.memberIds);
  }

  async function finalizeCallSession(session, status, durationSeconds = 0) {
    if (!session || session.finalized) {
      return null;
    }

    session.finalized = true;
    callSessions.delete(session.id);

    const result = await services.chatService.recordCallStatus({
      chatId: session.chatId,
      callerId: session.callerId,
      calleeId: session.calleeId,
      status,
      durationSeconds,
      mode: normalizeCallMode(session.mode),
      createdAt: new Date().toISOString(),
    });

    emitCallMessage(result);
    return result;
  }

  function clearScheduledCallDisconnect(userId) {
    const safeUserId = normalizeString(userId);
    if (!safeUserId) {
      return;
    }
    const timer = callDisconnectTimersByUser.get(safeUserId);
    if (timer) {
      clearTimeout(timer);
      callDisconnectTimersByUser.delete(safeUserId);
    }
  }

  function scheduleCallDisconnect(user) {
    const safeUserId = normalizeString(user?.id);
    if (!safeUserId) {
      return;
    }
    clearScheduledCallDisconnect(safeUserId);
    const timer = setTimeout(async () => {
      callDisconnectTimersByUser.delete(safeUserId);
      const socketsForUser = io.sockets.adapter.rooms.get(`user:${safeUserId}`)?.size ?? 0;
      if (socketsForUser > 0) {
        return;
      }

      cleanupExpiredSessions(callSessions);

      for (const [sessionId, session] of callSessions.entries()) {
        if (!session.memberIds.includes(safeUserId)) {
          continue;
        }

        const activeIds = Array.isArray(session.activeParticipantIds) ? session.activeParticipantIds : [];
        const isGroupSession = session.chatType === "server" || session.chatType === "group";
        const userIsCaller = safeUserId === session.callerId;
        if (isGroupSession && !userIsCaller) {
          if (!activeIds.includes(safeUserId)) {
            continue;
          }
          session.activeParticipantIds = activeIds.filter((entry) => entry !== safeUserId);
          if (session.participantsByUser && typeof session.participantsByUser === "object") {
            delete session.participantsByUser[safeUserId];
          }
          emitToUsers(session.activeParticipantIds, "call:participant-left", {
            sessionId,
            chatId: session.chatId,
            mode: normalizeCallMode(session.mode),
            fromUser: toPublicUser(user),
            userId: safeUserId,
            reason: "disconnect",
          });
          emitSessionParticipants(session);
          continue;
        }

        let status = "no_answer";
        let durationSeconds = 0;
        if (session.connectedAt) {
          status = "completed";
          durationSeconds = Math.max(0, Math.floor((Date.now() - session.connectedAt) / 1000));
        } else if (safeUserId === session.callerId) {
          status = "canceled";
        }

        try {
          await finalizeCallSession(session, status, durationSeconds);
        } catch {
          callSessions.delete(sessionId);
        }

        emitToUsers(session.memberIds, "call:hangup", {
          sessionId,
          chatId: session.chatId,
          mode: normalizeCallMode(session.mode),
          fromUser: toPublicUser(user),
          reason: "disconnect",
        });
      }
    }, CALL_DISCONNECT_GRACE_MS);
    callDisconnectTimersByUser.set(safeUserId, timer);
  }

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ?? null;
      const user = await services.authService.authenticate(token);
      socket.data.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    clearScheduledCallDisconnect(user.id);
    socket.join(`user:${user.id}`);
    const onlineSocketsCount = markUserOnline(user.id);
    if (onlineSocketsCount === 1) {
      emitPresenceUpdateForAll(user.id, true, null).catch(() => {
        // Ignore transient presence fanout errors.
      });
    }
    try {
      const snapshot = await getPresenceSnapshotForViewer(user.id);
      socket.emit("presence:snapshot", snapshot);
    } catch {
      socket.emit("presence:snapshot", {
        onlineUserIds: [],
        lastSeenAtByUser: {},
        hiddenUserIds: [],
      });
    }

    try {
      const chats = await services.chatService.listChats(user.id);
      chats.forEach((chat) => socket.join(chat.id));
    } catch {
      // Ignore initial join errors, client can recover by reconnecting.
    }

    socket.on("chat:join", async (chatId) => {
      try {
        await services.chatService.assertChatAccess(user.id, chatId);
        socket.join(chatId);
      } catch {
        // Ignore denied access requests.
      }
    });

    socket.on("chat:typing", async (payload) => {
      try {
        const chatId = normalizeString(payload?.chatId);
        if (!chatId) {
          return;
        }

        await services.chatService.assertChatAccess(user.id, chatId);
        io.to(chatId).except(socket.id).emit("chat:typing", {
          chatId,
          active: Boolean(payload?.active),
          action: normalizeTypingAction(payload?.action),
          fromUser: toPublicUser(user),
        });
      } catch {
        // Ignore typing updates for chats with denied access.
      }
    });

    socket.on("chat:read", async (payload, ack) => {
      const done = getAck(ack);
      try {
        const chatId = normalizeString(payload?.chatId);
        if (!chatId) {
          throw new Error("chatId is required");
        }
        const stream = normalizeString(payload?.stream) === "comment" ? "comment" : "main";
        const messageId = normalizeString(payload?.messageId);
        const readResult = await services.chatService.markChatRead(user.id, chatId, {
          stream,
          messageId: messageId || undefined,
        });
        io.to(chatId).except(socket.id).emit("chat:read", {
          chatId,
          stream,
          messageId: readResult?.messageId || messageId || null,
          fromUser: toPublicUser(user),
          readAt: readResult?.readAt ?? new Date().toISOString(),
        });
        ackResult(done, {
          ok: true,
          updatedCount: Number.parseInt(readResult?.updatedCount ?? 0, 10) || 0,
        });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to mark chat as read",
        });
      }
    });

    socket.on("call:start", async (payload, ack) => {
      const done = getAck(ack);
      try {
        cleanupExpiredSessions(callSessions);

        const chatId = normalizeString(payload?.chatId);
        if (!chatId) {
          throw new Error("chatId is required");
        }
        const mode = normalizeCallMode(payload?.mode);

        const chat = await resolveChatForCall(user.id, chatId);
        const existingSession = [...callSessions.values()].find((entry) => entry.chatId === chat.chatId);
        if (existingSession) {
          throw new Error("Call is already in progress");
        }

        const sessionId = randomUUID();
        const calleeId = chat.defaultCalleeId;
        if (!calleeId) {
          throw new Error("Call peer not found");
        }
        if (chat.chatType === "direct") {
          const targetBusy = [...callSessions.values()].some((entry) => {
            if (!entry || entry.finalized) {
              return false;
            }
            const activeIds = Array.isArray(entry.activeParticipantIds) ? entry.activeParticipantIds : [];
            return activeIds.includes(calleeId);
          });
          if (targetBusy) {
            throw new Error("Call target is busy");
          }
        }

        callSessions.set(sessionId, {
          id: sessionId,
          chatId: chat.chatId,
          chatType: chat.chatType,
          memberIds: chat.memberIds,
          invitedMemberIds: chat.memberIds,
          activeParticipantIds: [user.id],
          participantsByUser: {
            [user.id]: toPublicUser(user),
          },
          callerId: user.id,
          calleeId,
          acceptedBy: null,
          createdBy: user.id,
          createdAt: Date.now(),
          connectedAt: null,
          mode,
          finalized: false,
        });

        emitToUsers(chat.memberIds, "call:incoming", {
          sessionId,
          chatId: chat.chatId,
          mode,
          fromUser: toPublicUser(user),
        }, user.id);

        ackResult(done, {
          ok: true,
          sessionId,
          chatId: chat.chatId,
          mode,
          peer: chat.peer,
        });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to start call",
        });
      }
    });

    socket.on("call:accept", (payload, ack) => {
      const done = getAck(ack);
      try {
        const chatId = normalizeString(payload?.chatId);
        const session = getCallSession(payload?.sessionId, chatId, user.id);
        if (!Array.isArray(session.activeParticipantIds)) {
          session.activeParticipantIds = [session.callerId].filter(Boolean);
        }
        if (!session.activeParticipantIds.includes(user.id)) {
          session.activeParticipantIds.push(user.id);
        }
        if (!session.participantsByUser || typeof session.participantsByUser !== "object") {
          session.participantsByUser = {};
        }
        session.participantsByUser[user.id] = toPublicUser(user);

        if (!session.acceptedBy) {
          session.acceptedBy = user.id;
          session.calleeId = user.id;
        }
        session.acceptedAt = Date.now();
        const participants = getSessionParticipants(session);

        emitToUsers(session.activeParticipantIds, "call:accepted", {
          sessionId: session.id,
          chatId: session.chatId,
          mode: normalizeCallMode(session.mode),
          fromUser: toPublicUser(user),
          participants,
        });
        emitSessionParticipants(session);

        ackResult(done, { ok: true, participants });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to accept call",
        });
      }
    });

    socket.on("call:decline", async (payload, ack) => {
      const done = getAck(ack);
      try {
        const chatId = normalizeString(payload?.chatId);
        const session = getCallSession(payload?.sessionId, chatId, user.id);
        const reason = normalizeString(payload?.reason);
        const declineReason = reason === "busy" ? "busy" : "declined";
        if (session.chatType === "server" || session.chatType === "group") {
          const targets = Array.isArray(session.activeParticipantIds) ? session.activeParticipantIds : [session.callerId];
          emitToUsers(
            targets,
            "call:declined",
            {
              sessionId: session.id,
              chatId: session.chatId,
              mode: normalizeCallMode(session.mode),
              fromUser: toPublicUser(user),
              reason: declineReason,
            },
            user.id,
          );
        } else {
          await finalizeCallSession(session, declineReason === "busy" ? "busy" : "no_answer", 0);
          emitToUsers(
            session.memberIds,
            "call:declined",
            {
              sessionId: session.id,
              chatId: session.chatId,
              mode: normalizeCallMode(session.mode),
              fromUser: toPublicUser(user),
              reason: declineReason,
            },
            user.id,
          );
        }

        ackResult(done, { ok: true });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to decline call",
        });
      }
    });

    socket.on("call:hangup", async (payload, ack) => {
      const done = getAck(ack);
      try {
        const chatId = normalizeString(payload?.chatId);
        const session = getCallSession(payload?.sessionId, chatId, user.id);
        const isGroupSession = session.chatType === "server" || session.chatType === "group";

        if (isGroupSession && user.id !== session.callerId) {
          const activeIds = Array.isArray(session.activeParticipantIds) ? session.activeParticipantIds : [];
          session.activeParticipantIds = activeIds.filter((entry) => entry !== user.id);
          if (session.participantsByUser && typeof session.participantsByUser === "object") {
            delete session.participantsByUser[user.id];
          }

          emitToUsers(
            session.activeParticipantIds,
            "call:participant-left",
            {
              sessionId: session.id,
              chatId: session.chatId,
              mode: normalizeCallMode(session.mode),
              fromUser: toPublicUser(user),
              userId: user.id,
            },
            null,
          );
          emitSessionParticipants(session);
          ackResult(done, { ok: true });
          return;
        }

        let status = "no_answer";
        let durationSeconds = 0;
        if (session.connectedAt) {
          status = "completed";
          durationSeconds = Math.max(0, Math.floor((Date.now() - session.connectedAt) / 1000));
        } else if (user.id === session.callerId) {
          status = "canceled";
        }

        await finalizeCallSession(session, status, durationSeconds);

        emitToUsers(
          session.memberIds,
          "call:hangup",
          {
          sessionId: session.id,
          chatId: session.chatId,
          mode: normalizeCallMode(session.mode),
          fromUser: toPublicUser(user),
          },
          user.id,
        );

        ackResult(done, { ok: true });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to finish call",
        });
      }
    });

    socket.on("call:signal", (payload, ack) => {
      const done = getAck(ack);
      try {
        const chatId = normalizeString(payload?.chatId);
        const session = getCallSession(payload?.sessionId, chatId, user.id);
        const activeIds = Array.isArray(session.activeParticipantIds) ? session.activeParticipantIds : [];
        if (!activeIds.includes(user.id)) {
          throw new Error("Call participant is not connected");
        }

        const signalType = normalizeString(payload?.signalType);
        if (!SIGNAL_TYPES.has(signalType)) {
          throw new Error("signalType is invalid");
        }

        if (!isSafeSignalPayload(payload?.signal)) {
          throw new Error("signal payload is invalid");
        }

        if (signalType === "answer" && !session.connectedAt) {
          session.connectedAt = Date.now();
        }

        const toUserId = normalizeString(payload?.toUserId);
        const targetUserIds = toUserId
          ? [toUserId]
          : activeIds.filter((memberId) => memberId !== user.id);

        if (toUserId) {
          if (toUserId === user.id) {
            throw new Error("Cannot send signal to self");
          }
          if (!activeIds.includes(toUserId)) {
            throw new Error("Signal target is invalid");
          }
        }

        if (!targetUserIds.length) {
          ackResult(done, { ok: true });
          return;
        }

        emitToUsers(targetUserIds, "call:signal", {
          sessionId: session.id,
          chatId: session.chatId,
          mode: normalizeCallMode(session.mode),
          signalType,
          signal: payload.signal,
          fromUser: toPublicUser(user),
          toUserId: toUserId || null,
        });

        ackResult(done, { ok: true });
      } catch (error) {
        ackResult(done, {
          ok: false,
          error: error?.message ?? "Unable to process call signal",
        });
      }
    });

    socket.on("disconnect", async () => {
      const socketsForUser = io.sockets.adapter.rooms.get(`user:${user.id}`)?.size ?? 0;
      if (socketsForUser > 0) {
        return;
      }

      const presence = markUserOffline(user.id);
      if (!presence.online) {
        emitPresenceUpdateForAll(user.id, false, presence.lastSeenAt).catch(() => {
          // Ignore transient presence fanout errors.
        });
      }
      scheduleCallDisconnect(user);
    });
  });

  return io;
}
