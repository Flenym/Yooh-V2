function normalizeUserId(value) {
  return String(value ?? "").trim();
}

function normalizeAudience(value, fallback = "everyone") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "everyone" || normalized === "contacts" || normalized === "nobody" || normalized === "miniapps") {
    return normalized;
  }
  return fallback;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => normalizeUserId(entry)).filter(Boolean))];
}

function createDefaultPremiumBadge() {
  return {
    type: "star",
    star: "⭐",
    svg: "",
    photo: "",
    bgColor: "#f4c84c",
    size: 16,
    offsetX: 0,
    offsetY: 0,
  };
}

function normalizePremiumBadge(input = {}, fallback = createDefaultPremiumBadge()) {
  const source = input && typeof input === "object" ? input : {};
  const base = fallback && typeof fallback === "object" ? fallback : createDefaultPremiumBadge();
  const allowedTypes = new Set(["none", "star", "svg", "photo"]);
  const type = allowedTypes.has(String(source.type ?? "").trim()) ? String(source.type).trim() : String(base.type ?? "star");
  const star = String(source.star ?? base.star ?? "⭐").trim().slice(0, 8) || "⭐";
  const svg = String(source.svg ?? base.svg ?? "").trim().slice(0, 120_000);
  const photo = String(source.photo ?? base.photo ?? "").trim().slice(0, 2_000_000);
  const bgColorSource = String(source.bgColor ?? base.bgColor ?? "#f4c84c").trim().toLowerCase();
  const bgColor = /^#[0-9a-f]{6}$/i.test(bgColorSource) ? bgColorSource : "#f4c84c";
  const size = Math.max(12, Math.min(36, Number.parseInt(source.size ?? base.size ?? 16, 10) || 16));
  const offsetX = Math.max(-24, Math.min(24, Number.parseInt(source.offsetX ?? base.offsetX ?? 0, 10) || 0));
  const offsetY = Math.max(-24, Math.min(24, Number.parseInt(source.offsetY ?? base.offsetY ?? 0, 10) || 0));
  return {
    type,
    star,
    svg,
    photo,
    bgColor,
    size,
    offsetX,
    offsetY,
  };
}

function getUserPrivacyRules(user) {
  const raw = user?.settings?.privacy?.rules && typeof user.settings.privacy.rules === "object" ? user.settings.privacy.rules : {};
  const legacy = user?.settings?.privacy && typeof user.settings.privacy === "object" ? user.settings.privacy : {};
  const profileVisibility = raw.profileVisibility && typeof raw.profileVisibility === "object" ? raw.profileVisibility : {};

  return {
    phone: {
      whoCanSee: normalizeAudience(raw.phone?.whoCanSee ?? legacy.phone, "everyone"),
      whoCanFind: normalizeAudience(raw.phone?.whoCanFind, "contacts"),
      alwaysShowIds: normalizeIdList(raw.phone?.alwaysShowIds),
    },
    lastSeen: {
      whoCanSee: normalizeAudience(raw.lastSeen?.whoCanSee ?? legacy.lastSeen, "everyone"),
      alwaysShowIds: normalizeIdList(raw.lastSeen?.alwaysShowIds),
      hideReadTime: Boolean(raw.lastSeen?.hideReadTime ?? (typeof legacy.readReceipts === "boolean" ? !legacy.readReceipts : false)),
    },
    profilePhotos: {
      whoCanSee: normalizeAudience(raw.profilePhotos?.whoCanSee ?? legacy.profilePhoto, "everyone"),
      alwaysShowIds: normalizeIdList(raw.profilePhotos?.alwaysShowIds),
      alwaysHideIds: normalizeIdList(raw.profilePhotos?.alwaysHideIds),
    },
    forwards: {
      whoCanLink: normalizeAudience(raw.forwards?.whoCanLink ?? legacy.forwards, "contacts"),
      alwaysAllowIds: normalizeIdList(raw.forwards?.alwaysAllowIds),
      alwaysDenyIds: normalizeIdList(raw.forwards?.alwaysDenyIds),
    },
    calls: {
      whoCanCall: normalizeAudience(raw.calls?.whoCanCall ?? legacy.calls, "contacts"),
      alwaysAllowIds: normalizeIdList(raw.calls?.alwaysAllowIds),
      alwaysDenyIds: normalizeIdList(raw.calls?.alwaysDenyIds),
    },
    voice: {
      whoCanSend: normalizeAudience(raw.voice?.whoCanSend, "everyone"),
      alwaysDenyIds: normalizeIdList(raw.voice?.alwaysDenyIds),
    },
    messages: {
      whoCanSend: normalizeAudience(raw.messages?.whoCanSend ?? legacy.messages, "everyone"),
      alwaysAllowIds: normalizeIdList(raw.messages?.alwaysAllowIds),
      alwaysDenyIds: normalizeIdList(raw.messages?.alwaysDenyIds),
    },
    profileVisibility: {
      birthday: normalizeAudience(profileVisibility.birthday, "everyone"),
      gifts: normalizeAudience(profileVisibility.gifts, "miniapps"),
      about: normalizeAudience(profileVisibility.about, "contacts"),
      invites: normalizeAudience(profileVisibility.invites ?? legacy.groupsInvites, "everyone"),
      birthdayExceptionIds: normalizeIdList(profileVisibility.birthdayExceptionIds),
      giftsExceptionIds: normalizeIdList(profileVisibility.giftsExceptionIds),
      aboutExceptionIds: normalizeIdList(profileVisibility.aboutExceptionIds),
      invitesExceptionIds: normalizeIdList(profileVisibility.invitesExceptionIds),
    },
  };
}

function areUsersContacts(db, userAId, userBId) {
  const safeA = normalizeUserId(userAId);
  const safeB = normalizeUserId(userBId);
  if (!safeA || !safeB) {
    return false;
  }
  if (safeA === safeB) {
    return true;
  }

  const directChatIdsByA = new Set(
    db.memberships
      .filter((entry) => entry.userId === safeA)
      .map((entry) => entry.chatId)
      .filter((chatId) => {
        const chat = db.chats.find((candidate) => candidate.id === chatId);
        return chat?.type === "direct";
      }),
  );

  if (!directChatIdsByA.size) {
    return false;
  }

  return db.memberships.some((entry) => entry.userId === safeB && directChatIdsByA.has(entry.chatId));
}

function evaluateAudience({
  targetUserId,
  viewerUserId,
  audience,
  alwaysAllowIds = [],
  alwaysDenyIds = [],
  viewerIsContact = false,
}) {
  const targetId = normalizeUserId(targetUserId);
  const viewerId = normalizeUserId(viewerUserId);
  if (!targetId || !viewerId) {
    return false;
  }
  if (targetId === viewerId) {
    return true;
  }

  if (alwaysDenyIds.includes(viewerId)) {
    return false;
  }
  if (alwaysAllowIds.includes(viewerId)) {
    return true;
  }

  const mode = normalizeAudience(audience, "everyone");
  if (mode === "everyone" || mode === "miniapps") {
    return true;
  }
  if (mode === "contacts") {
    return Boolean(viewerIsContact);
  }
  return false;
}

function canViewerSeeLastSeen(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.lastSeen.whoCanSee,
    alwaysAllowIds: rules.lastSeen.alwaysShowIds,
    viewerIsContact,
  });
}

function canViewerSeePhone(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.phone.whoCanSee,
    alwaysAllowIds: rules.phone.alwaysShowIds,
    viewerIsContact,
  });
}

function canViewerSeeAbout(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.profileVisibility.about,
    alwaysAllowIds: rules.profileVisibility.aboutExceptionIds,
    viewerIsContact,
  });
}

function canViewerSeeAvatar(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.profilePhotos.whoCanSee,
    alwaysAllowIds: rules.profilePhotos.alwaysShowIds,
    alwaysDenyIds: rules.profilePhotos.alwaysHideIds,
    viewerIsContact,
  });
}

function canViewerCallTarget(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.calls.whoCanCall,
    alwaysAllowIds: rules.calls.alwaysAllowIds,
    alwaysDenyIds: rules.calls.alwaysDenyIds,
    viewerIsContact,
  });
}

function canViewerSendDirectMessage(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.messages.whoCanSend,
    alwaysAllowIds: rules.messages.alwaysAllowIds,
    alwaysDenyIds: rules.messages.alwaysDenyIds,
    viewerIsContact,
  });
}

function canViewerSendVoiceToTarget(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.voice.whoCanSend,
    alwaysDenyIds: rules.voice.alwaysDenyIds,
    viewerIsContact,
  });
}

function canViewerInviteTarget(db, targetUser, viewerUserId) {
  const rules = getUserPrivacyRules(targetUser);
  const viewerIsContact = areUsersContacts(db, targetUser?.id, viewerUserId);
  return evaluateAudience({
    targetUserId: targetUser?.id,
    viewerUserId,
    audience: rules.profileVisibility.invites,
    alwaysAllowIds: rules.profileVisibility.invitesExceptionIds,
    viewerIsContact,
  });
}

function getPublicUserForViewer(db, targetUser, viewerUserId, options = {}) {
  if (!targetUser) {
    return null;
  }

  const includePhone = Boolean(options.includePhone);
  const canSeeLastSeenValue = canViewerSeeLastSeen(db, targetUser, viewerUserId);
  const canSeeAboutValue = canViewerSeeAbout(db, targetUser, viewerUserId);
  const canSeeAvatarValue = canViewerSeeAvatar(db, targetUser, viewerUserId);
  const canSeePhoneValue = includePhone ? canViewerSeePhone(db, targetUser, viewerUserId) : false;

  const result = {
    id: targetUser.id,
    chatId: targetUser.chatId,
    username: targetUser.username,
    displayName: targetUser.displayName,
    isBot: Boolean(targetUser.isBot),
    isSystemBot: Boolean(targetUser.isSystemBot),
    isPremium: Boolean(targetUser.isPremium),
    premiumBadge: normalizePremiumBadge(targetUser.premiumBadge),
    about: canSeeAboutValue ? targetUser.about ?? "" : "",
    avatar: canSeeAvatarValue ? targetUser.avatar ?? "" : "",
    privacy: {
      lastSeenHidden: !canSeeLastSeenValue,
      aboutHidden: !canSeeAboutValue,
      avatarHidden: !canSeeAvatarValue,
    },
  };

  if (includePhone) {
    result.phone = canSeePhoneValue ? targetUser.phone ?? "" : "";
    result.privacy.phoneHidden = !canSeePhoneValue;
  }

  return result;
}

export {
  areUsersContacts,
  canViewerCallTarget,
  canViewerInviteTarget,
  canViewerSeeAbout,
  canViewerSeeAvatar,
  canViewerSeeLastSeen,
  canViewerSendDirectMessage,
  canViewerSendVoiceToTarget,
  evaluateAudience,
  getPublicUserForViewer,
  getUserPrivacyRules,
  normalizeIdList,
};

