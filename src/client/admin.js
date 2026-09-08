const elements = {
  tokenInput: document.getElementById("admin-token"),
  loadButton: document.getElementById("load-btn"),
  statusNode: document.getElementById("admin-status"),
  langSelect: document.getElementById("admin-lang-select"),
  statsGrid: document.getElementById("stats-grid"),
  codesTable: document.querySelector("#codes-table tbody"),
  usersTable: document.querySelector("#users-table tbody"),
  reportsTable: document.querySelector("#reports-table tbody"),
  feedbackTable: document.querySelector("#feedback-table tbody"),
  errorLogsTable: document.querySelector("#error-logs-table tbody"),
  bansTable: document.querySelector("#bans-table tbody"),
  mutesTable: document.querySelector("#mutes-table tbody"),
  banForm: document.getElementById("ban-form"),
  banUserId: document.getElementById("ban-user-id"),
  banReason: document.getElementById("ban-reason"),
  banExpiresAt: document.getElementById("ban-expires-at"),
  muteForm: document.getElementById("mute-form"),
  muteChatId: document.getElementById("mute-chat-id"),
  muteUserId: document.getElementById("mute-user-id"),
  muteReason: document.getElementById("mute-reason"),
  muteExpiresAt: document.getElementById("mute-expires-at"),
  botState: document.getElementById("bot-state"),
  botBroadcastForm: document.getElementById("bot-broadcast-form"),
  botBroadcastText: document.getElementById("bot-broadcast-text"),
  botStoryForm: document.getElementById("bot-story-form"),
  botStoryText: document.getElementById("bot-story-text"),
  botMessageForm: document.getElementById("bot-message-form"),
  botTarget: document.getElementById("bot-target"),
  botMessageText: document.getElementById("bot-message-text"),
  feedbackCategoryFilter: document.getElementById("feedback-category-filter"),
  feedbackUserFilter: document.getElementById("feedback-user-filter"),
  feedbackSort: document.getElementById("feedback-sort"),
  supportTicketsList: document.getElementById("support-tickets-list"),
  supportTicketMeta: document.getElementById("support-ticket-meta"),
  supportTicketEmpty: document.getElementById("support-ticket-empty"),
  supportTicketMessages: document.getElementById("support-ticket-messages"),
  supportTicketClaimBtn: document.getElementById("support-ticket-claim-btn"),
  supportTicketCloseBtn: document.getElementById("support-ticket-close-btn"),
  supportTicketReplyForm: document.getElementById("support-ticket-reply-form"),
  supportTicketReplyText: document.getElementById("support-ticket-reply-text"),
  adminTabButtons: Array.from(document.querySelectorAll("[data-admin-tab-btn]")),
  adminTabPanels: Array.from(document.querySelectorAll("[data-admin-tab]")),
  runtimeMonitorToggle: document.getElementById("runtime-monitor-toggle"),
  quickSearchInput: document.getElementById("admin-quick-search"),
  quickSearchClearBtn: document.getElementById("admin-quick-search-clear"),
  refreshNowButton: document.getElementById("admin-refresh-now"),
  autoRefreshToggle: document.getElementById("admin-auto-refresh-toggle"),
  lastUpdatedNode: document.getElementById("admin-last-updated"),
};

const I18N = {
  ru: {
    brandTitle: "Yooh Admin",
    brandHint: "Управление пользователями, модерацией и поддержкой",
    navTitle: "Навигация",
    adminToken: "Токен админки",
    loadBtn: "Загрузить",
    openApp: "Открыть приложение",
    quickSearchPlaceholder: "Быстрый поиск по данным админки",
    quickSearchClear: "Очистить",
    refreshNow: "Обновить",
    tabOverview: "Обзор",
    tabModeration: "Модерация",
    tabFeedback: "Обращения",
    tabTickets: "Тикеты поддержки",
    tabBot: "Системный бот",
    tabLogs: "Логи",
    otpTitle: "Активные OTP-коды",
    usersTitle: "Пользователи",
    statsTitle: "Статистика",
    reportsTitle: "Жалобы",
    moderationActions: "Действия модерации",
    banUserTitle: "Бан пользователя",
    muteUserTitle: "Мут пользователя в чате",
    banBtn: "Забанить",
    muteBtn: "Выдать мут",
    feedbackTitle: "Обращения",
    feedbackCategoryFilter: "Фильтр категории",
    feedbackUserFilter: "Фильтр пользователя",
    sortTitle: "Сортировка",
    sortNewest: "Сначала новые",
    sortOldest: "Сначала старые",
    sortUser: "По пользователю",
    sortCategory: "По категории",
    all: "Все",
    categoryBug: "Ошибки",
    categoryImprovement: "Улучшения",
    categoryWish: "Пожелания",
    ticketsSectionTitle: "Тикеты поддержки (Yooh Support)",
    claimTicket: "Принять тикет",
    closeTicket: "Закрыть тикет",
    sendReply: "Отправить",
    ticketSelectHint: "Выберите тикет слева.",
    botTitle: "Системный бот",
    botBroadcastTitle: "Рассылка всем пользователям",
    botStoryTitle: "Опубликовать сторис всем",
    botMessageTitle: "Сообщение одному пользователю",
    sendAll: "Отправить всем",
    publishStory: "Опубликовать",
    logsTitle: "Логи ошибок",
    activeBans: "Активные баны",
    activeMutes: "Активные муты",
    colTarget: "Цель",
    colPurpose: "Назначение",
    colCode: "Код",
    colCreated: "Создан",
    colExpires: "Истекает",
    colStatus: "Статус",
    colName: "Имя",
    colUsername: "Юзернейм",
    colPremium: "Plus",
    colStars: "Звезды",
    colBusiness: "Business",
    colPhone: "Телефон",
    colSessions: "Сессии",
    colLastSeen: "Последний вход",
    colActions: "Действия",
    colWhen: "Когда",
    colReporter: "Кто пожаловался",
    colReported: "На кого",
    colChat: "Чат",
    colReason: "Причина",
    colUser: "Пользователь",
    colCategory: "Категория",
    colMessage: "Сообщение",
    colSource: "Источник",
    colEndpoint: "Endpoint",
    colAction: "Действие",
    loadStatus: "Загружено. OTP: {otp}, жалоб: {reports}, обращений: {feedback}, тикетов: {tickets}, ошибок: {errors}",
    runtimeOn: "Мониторинг ресурсов: вкл",
    runtimeOff: "Мониторинг ресурсов: выкл",
    autoRefreshOn: "Автообновление: вкл",
    autoRefreshOff: "Автообновление: выкл",
    lastUpdatedNever: "Последнее обновление: еще не было",
    lastUpdatedAt: "Последнее обновление: {time}",
    never: "никогда",
    online: "Онлайн",
    offline: "Оффлайн",
    yes: "Да",
    no: "Нет",
    premiumGrant: "Выдать Plus",
    premiumRefresh: "Продлить Plus",
    premiumRevoke: "Забрать Plus",
    starsEdit: "Изменить звезды",
    businessEnable: "Включить Business",
    businessDisable: "Выключить Business",
    feedbackBlock: "Блок обращений",
    feedbackUnblock: "Разблок обращений",
    blocked: "Заблокирован",
    active: "Активен",
    remove: "Удалить",
    removeReport: "Удалить жалобу",
    ban: "Бан",
    mute: "Мут",
    unban: "Снять бан",
    unmute: "Снять мут",
    feedbackBug: "Ошибки",
    feedbackImprovement: "Улучшения",
    feedbackWish: "Пожелания",
    botNotConfigured: "Системный бот не настроен.",
    botState: "Бот: {name} (@{username}) | получателей: {recipients}",
    starsPrompt: "Введите число звезд. Отрицательное значение снимает звезды:",
    ticketOpen: "Открыт",
    ticketMine: "В работе (ваше устройство)",
    ticketOther: "В работе (другое устройство)",
    noTickets: "Открытых тикетов нет",
    pickTicket: "Выберите тикет слева.",
    ticketMeta: "Тикет #{number} · {category} · {user} · {status}",
    unknown: "Неизвестно",
    noResults: "Ничего не найдено",
    replyPlaceholder: "Ответ оператора",
    claimRequired: "Сначала примите тикет.",
    closeTicketConfirm: "Закрыть тикет и удалить его?",
    done: "Готово",
  },
  en: {
    brandTitle: "Yooh Admin",
    brandHint: "Users, moderation and support operations",
    navTitle: "Navigation",
    adminToken: "Admin token",
    loadBtn: "Load",
    openApp: "Open app",
    quickSearchPlaceholder: "Quick search across admin data",
    quickSearchClear: "Clear",
    refreshNow: "Refresh",
    tabOverview: "Overview",
    tabModeration: "Moderation",
    tabFeedback: "Feedback",
    tabTickets: "Support tickets",
    tabBot: "System bot",
    tabLogs: "Logs",
    otpTitle: "Active OTP codes",
    usersTitle: "Users",
    statsTitle: "Stats",
    reportsTitle: "Reports",
    moderationActions: "Moderation actions",
    banUserTitle: "Ban user",
    muteUserTitle: "Mute user in chat",
    banBtn: "Ban",
    muteBtn: "Mute",
    feedbackTitle: "Feedback",
    feedbackCategoryFilter: "Category filter",
    feedbackUserFilter: "User filter",
    sortTitle: "Sort",
    sortNewest: "Newest first",
    sortOldest: "Oldest first",
    sortUser: "By user",
    sortCategory: "By category",
    all: "All",
    categoryBug: "Errors",
    categoryImprovement: "Improvements",
    categoryWish: "Wishes",
    ticketsSectionTitle: "Support tickets (Yooh Support)",
    claimTicket: "Claim ticket",
    closeTicket: "Close ticket",
    sendReply: "Send",
    ticketSelectHint: "Select a ticket on the left.",
    botTitle: "System bot",
    botBroadcastTitle: "Broadcast to all users",
    botStoryTitle: "Publish story to all",
    botMessageTitle: "Message one user",
    sendAll: "Send to all",
    publishStory: "Publish",
    logsTitle: "Error logs",
    activeBans: "Active bans",
    activeMutes: "Active mutes",
    colTarget: "Target",
    colPurpose: "Purpose",
    colCode: "Code",
    colCreated: "Created",
    colExpires: "Expires",
    colStatus: "Status",
    colName: "Name",
    colUsername: "Username",
    colPremium: "Plus",
    colStars: "Stars",
    colBusiness: "Business",
    colPhone: "Phone",
    colSessions: "Sessions",
    colLastSeen: "Last seen",
    colActions: "Actions",
    colWhen: "When",
    colReporter: "Reporter",
    colReported: "Reported",
    colChat: "Chat",
    colReason: "Reason",
    colUser: "User",
    colCategory: "Category",
    colMessage: "Message",
    colSource: "Source",
    colEndpoint: "Endpoint",
    colAction: "Action",
    loadStatus: "Loaded. OTP: {otp}, reports: {reports}, feedback: {feedback}, tickets: {tickets}, errors: {errors}",
    runtimeOn: "Runtime monitor: on",
    runtimeOff: "Runtime monitor: off",
    autoRefreshOn: "Auto refresh: on",
    autoRefreshOff: "Auto refresh: off",
    lastUpdatedNever: "Last update: not yet",
    lastUpdatedAt: "Last update: {time}",
    never: "never",
    online: "Online",
    offline: "Offline",
    yes: "Yes",
    no: "No",
    premiumGrant: "Grant Plus",
    premiumRefresh: "Refresh Plus",
    premiumRevoke: "Revoke Plus",
    starsEdit: "Set stars",
    businessEnable: "Enable Business",
    businessDisable: "Disable Business",
    feedbackBlock: "Block feedback",
    feedbackUnblock: "Unblock feedback",
    blocked: "Blocked",
    active: "Active",
    remove: "Delete",
    removeReport: "Delete report",
    ban: "Ban",
    mute: "Mute",
    unban: "Unban",
    unmute: "Unmute",
    feedbackBug: "Bugs",
    feedbackImprovement: "Improvements",
    feedbackWish: "Wishes",
    botNotConfigured: "System bot is not configured.",
    botState: "Bot: {name} (@{username}) | recipients: {recipients}",
    starsPrompt: "Enter stars delta. Negative removes stars:",
    ticketOpen: "Open",
    ticketMine: "In progress (this device)",
    ticketOther: "In progress (other device)",
    noTickets: "No open tickets",
    pickTicket: "Select a ticket on the left.",
    ticketMeta: "Ticket #{number} · {category} · {user} · {status}",
    unknown: "Unknown",
    noResults: "No results found",
    replyPlaceholder: "Operator reply",
    claimRequired: "Claim ticket first.",
    closeTicketConfirm: "Close and delete this ticket?",
    done: "Done",
  },
};

let coreReloadInFlight = false;
let errorLogsReloadInFlight = false;
const ADMIN_CORE_POLL_INTERVAL_MS = 3000;
const ADMIN_ERROR_LOGS_POLL_INTERVAL_MS = 2000;
let activeLang = localStorage.getItem("yooh_admin_lang") || "ru";
const adminStatusState = {
  otp: 0,
  reports: 0,
  feedback: 0,
  tickets: 0,
  errors: 0,
};
let activeAdminTab = "overview";
let runtimeMonitorEnabled = false;
let autoRefreshEnabled = true;
let feedbackTicketsState = [];
let supportTicketsState = [];
let adminCodesState = [];
let adminUsersState = [];
let adminReportsState = [];
let adminBansState = [];
let adminMutesState = [];
let adminErrorLogsState = [];
let lastUpdatedAt = 0;
let activeSupportTicketId = "";
let activeSupportTicket = null;
let activeSupportMessages = [];
let activeSupportCanReply = false;

const TUNNEL_BYPASS_HEADER_NAME = "bypass-tunnel-reminder";
const TUNNEL_BYPASS_HEADER_VALUE = "1";

function applyTunnelBypassHeader(headers) {
  const hasBypassHeader = Object.keys(headers).some(
    (name) => String(name).toLowerCase() === TUNNEL_BYPASS_HEADER_NAME,
  );
  if (!hasBypassHeader) {
    headers[TUNNEL_BYPASS_HEADER_NAME] = TUNNEL_BYPASS_HEADER_VALUE;
  }
  return headers;
}

function tr(key, vars = {}) {
  const table = I18N[activeLang] || I18N.ru;
  let value = table[key] ?? I18N.ru[key] ?? key;
  for (const [name, tokenValue] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(tokenValue ?? ""));
  }
  return value;
}

function applyLocale() {
  if (!["ru", "en"].includes(activeLang)) {
    activeLang = "ru";
  }
  localStorage.setItem("yooh_admin_lang", activeLang);
  document.documentElement.lang = activeLang;
  if (elements.langSelect) {
    elements.langSelect.value = activeLang;
  }
  const table = I18N[activeLang] || I18N.ru;
  const fallback = I18N.ru;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (!key) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(table, key) || Object.prototype.hasOwnProperty.call(fallback, key)) {
      node.textContent = tr(key);
    }
  });
  if (elements.supportTicketReplyText) {
    elements.supportTicketReplyText.placeholder = tr("replyPlaceholder");
  }
  if (elements.quickSearchInput) {
    elements.quickSearchInput.placeholder = tr("quickSearchPlaceholder");
  }
  syncRuntimeMonitorToggle();
  syncAutoRefreshToggle();
  syncLastUpdatedLabel();
}

function setStatus(message, error = false) {
  elements.statusNode.textContent = message;
  elements.statusNode.classList.toggle("error", error);
}

function updateLoadedStatus() {
  setStatus(
    tr("loadStatus", {
      otp: adminStatusState.otp,
      reports: adminStatusState.reports,
      feedback: adminStatusState.feedback,
      tickets: adminStatusState.tickets,
      errors: adminStatusState.errors,
    }),
  );
}

function normalizeAdminSearchQuery(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getQuickSearchQuery() {
  return normalizeAdminSearchQuery(elements.quickSearchInput?.value);
}

function matchesQuickSearch(query, parts = []) {
  const safeQuery = normalizeAdminSearchQuery(query);
  if (!safeQuery) {
    return true;
  }
  const haystack = parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  return haystack.includes(safeQuery);
}

function syncAutoRefreshToggle() {
  if (!elements.autoRefreshToggle) {
    return;
  }
  elements.autoRefreshToggle.textContent = autoRefreshEnabled ? tr("autoRefreshOn") : tr("autoRefreshOff");
  elements.autoRefreshToggle.classList.toggle("active", autoRefreshEnabled);
}

function syncLastUpdatedLabel() {
  if (!elements.lastUpdatedNode) {
    return;
  }
  if (!lastUpdatedAt) {
    elements.lastUpdatedNode.textContent = tr("lastUpdatedNever");
    return;
  }
  elements.lastUpdatedNode.textContent = tr("lastUpdatedAt", {
    time: new Date(lastUpdatedAt).toLocaleTimeString(),
  });
}

function markLastUpdated() {
  lastUpdatedAt = Date.now();
  syncLastUpdatedLabel();
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const result = bytes / 1024 ** index;
  return `${result >= 100 ? Math.round(result) : result.toFixed(1)} ${units[index]}`;
}

function applyAdminTab() {
  for (const button of elements.adminTabButtons) {
    button.classList.toggle("active", button.dataset.adminTabBtn === activeAdminTab);
  }
  for (const panel of elements.adminTabPanels) {
    panel.classList.toggle("hidden", panel.dataset.adminTab !== activeAdminTab);
  }
}

function syncRuntimeMonitorToggle() {
  if (!elements.runtimeMonitorToggle) {
    return;
  }
  elements.runtimeMonitorToggle.textContent = runtimeMonitorEnabled ? tr("runtimeOn") : tr("runtimeOff");
  elements.runtimeMonitorToggle.classList.toggle("active", runtimeMonitorEnabled);
}

function rerenderAdminFromState() {
  renderCodes(adminCodesState);
  renderUsers(adminUsersState);
  renderReports(adminReportsState);
  renderFeedbackTickets(feedbackTicketsState);
  renderErrorLogs(adminErrorLogsState);
  renderBans(adminBansState);
  renderMutes(adminMutesState);
  renderSupportTickets(supportTicketsState);
}

function toIsoFromLocal(value) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

async function api(path, options = {}) {
  const headers = applyTunnelBypassHeader({
    "x-admin-token": elements.tokenInput.value.trim(),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  });
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 511) {
      throw new Error("HTTP 511: tunnel/network auth required. Reopen public URL and try again.");
    }
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : tr("never");
}

function escapeHtml(value) {
  const source = String(value ?? "");
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStats(stats, runtime) {
  const cards = [
    ["Users", stats.users],
    ["Chats", stats.chats],
    ["Messages", stats.messages],
    ["Files", stats.files],
    ["Reports", stats.reports],
    ["Feedback", stats.feedback],
    ["Support tickets", stats.supportTickets],
    ["Errors", stats.errors],
    ["Active bans", stats.bans],
    ["Active mutes", stats.mutes],
    ["Month limit", `${Math.round(stats.monthLimitBytes / 1024 / 1024 / 1024)} GB`],
    ["File limit", `${Math.round(stats.fileLimitBytes / 1024 / 1024)} MB`],
    ["Retention", `${stats.fileRetentionDays} days`],
  ];
  if (runtime?.runtime) {
    cards.push(["DB size", formatBytes(runtime.runtime.dbSizeBytes)]);
    cards.push(["App RSS", formatBytes(runtime.runtime.memory?.rss)]);
    cards.push(["Heap used", formatBytes(runtime.runtime.memory?.heapUsed)]);
    cards.push(["RAM free", formatBytes(runtime.runtime.system?.freeMem)]);
    cards.push(["RAM total", formatBytes(runtime.runtime.system?.totalMem)]);
    cards.push(["CPU", `${runtime.runtime.system?.cpuModel ?? "-"} (${runtime.runtime.system?.cpuCount ?? 0})`]);
  }

  elements.statsGrid.innerHTML = "";
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "auth-card admin-stat-card";
    card.innerHTML = `<div class="hint">${escapeHtml(label)}</div><div class="chat-title admin-stat-value">${escapeHtml(value)}</div>`;
    elements.statsGrid.appendChild(card);
  }
}

function renderCodes(codes) {
  const safeCodes = Array.isArray(codes) ? codes : [];
  const query = getQuickSearchQuery();
  elements.codesTable.innerHTML = "";
  for (const code of safeCodes) {
    const target = code.target || code.phone || "-";
    const channel = String(code.channel || "sms").toUpperCase();
    if (
      !matchesQuickSearch(query, [
        target,
        code.purpose,
        code.code,
        channel,
        formatDate(code.createdAt),
        formatDate(code.expiresAt),
      ])
    ) {
      continue;
    }
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(target)}</td>
      <td>${escapeHtml(`${code.purpose} (${channel})`)}</td>
      <td><strong>${escapeHtml(code.code)}</strong></td>
      <td>${escapeHtml(formatDate(code.createdAt))}</td>
      <td>${escapeHtml(formatDate(code.expiresAt))}</td>
    `;
    elements.codesTable.appendChild(row);
  }
}

function renderUsers(users) {
  if (!elements.usersTable) {
    return;
  }
  const safeUsers = Array.isArray(users) ? users : [];
  const query = getQuickSearchQuery();

  elements.usersTable.innerHTML = "";
  for (const user of safeUsers) {
    if (
      !matchesQuickSearch(query, [
        user.id,
        user.displayName,
        user.username ? `@${user.username}` : "",
        user.phone,
        user.lastSeenAt,
        user.createdAt,
        user.online ? tr("online") : tr("offline"),
        user.isPremium ? tr("yes") : tr("no"),
        user.businessEnabled ? tr("yes") : tr("no"),
      ])
    ) {
      continue;
    }
    const row = document.createElement("tr");
    const statusLabel = user.online ? tr("online") : tr("offline");
    row.innerHTML = `
      <td><span class="admin-user-status ${user.online ? "online" : "offline"}">${escapeHtml(statusLabel)}</span></td>
      <td>${escapeHtml(user.displayName || "-")}</td>
      <td>${escapeHtml(user.username ? `@${user.username}` : "-")}</td>
      <td>${user.isPremium ? tr("yes") : tr("no")}</td>
      <td>${escapeHtml(user.starsBalance ?? 0)}</td>
      <td>${user.businessEnabled ? tr("yes") : tr("no")}</td>
      <td>${escapeHtml(user.phone || "-")}</td>
      <td>${escapeHtml(user.activeSessions ?? 0)}</td>
      <td>${escapeHtml(formatDate(user.lastSeenAt))}</td>
      <td>${escapeHtml(formatDate(user.createdAt))}</td>
      <td class="admin-action-row">
        <button class="small" data-action="grant-plus" data-target="${escapeHtml(user.id)}">${user.isPremium ? tr("premiumRefresh") : tr("premiumGrant")}</button>
        ${
          user.isPremium
            ? `<button class="small ghost danger" data-action="revoke-plus" data-target="${escapeHtml(user.id)}">${tr("premiumRevoke")}</button>`
            : ""
        }
        <button class="small ghost" data-action="grant-stars" data-target="${escapeHtml(user.id)}">${tr("starsEdit")}</button>
        <button class="small ghost" data-action="toggle-business" data-target="${escapeHtml(user.id)}" data-enabled="${user.businessEnabled ? "0" : "1"}">
          ${user.businessEnabled ? tr("businessDisable") : tr("businessEnable")}
        </button>
        <button class="small ghost ${user.feedbackBlocked ? "danger" : ""}" data-action="toggle-feedback-block" data-target="${escapeHtml(user.id)}" data-feedback-blocked="${user.feedbackBlocked ? "1" : "0"}">
          ${user.feedbackBlocked ? tr("feedbackUnblock") : tr("feedbackBlock")}
        </button>
      </td>
    `;
    elements.usersTable.appendChild(row);
  }
}

function getFeedbackCategoryLabel(category) {
  switch (String(category || "").trim()) {
    case "bug":
      return tr("feedbackBug");
    case "improvement":
      return tr("feedbackImprovement");
    case "wish":
      return tr("feedbackWish");
    default:
      return category || "-";
  }
}

function renderFeedbackTickets(tickets) {
  if (!elements.feedbackTable) {
    return;
  }
  const query = getQuickSearchQuery();
  const categoryFilter = String(elements.feedbackCategoryFilter?.value || "all");
  const userFilter = String(elements.feedbackUserFilter?.value || "").trim().toLowerCase();
  const sortMode = String(elements.feedbackSort?.value || "newest");
  const filtered = [...(Array.isArray(tickets) ? tickets : [])]
    .filter((ticket) => {
      if (
        !matchesQuickSearch(query, [
          ticket.id,
          ticket.user?.id,
          ticket.user?.displayName,
          ticket.user?.username ? `@${ticket.user.username}` : "",
          ticket.user?.phone,
          ticket.category,
          getFeedbackCategoryLabel(ticket.category),
          ticket.message,
          formatDate(ticket.createdAt),
        ])
      ) {
        return false;
      }
      if (categoryFilter !== "all" && ticket.category !== categoryFilter) {
        return false;
      }
      if (!userFilter) {
        return true;
      }
      const haystack = [
        ticket.user?.displayName,
        ticket.user?.username ? `@${ticket.user.username}` : "",
        ticket.user?.phone,
        ticket.message,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(userFilter);
    })
    .sort((left, right) => {
      if (sortMode === "oldest") {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }
      if (sortMode === "user") {
        return String(left.user?.displayName || left.user?.username || "").localeCompare(
          String(right.user?.displayName || right.user?.username || ""),
        );
      }
      if (sortMode === "category") {
        return String(left.category || "").localeCompare(String(right.category || ""));
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  elements.feedbackTable.innerHTML = "";
  for (const ticket of filtered) {
    const row = document.createElement("tr");
    const userLabel = ticket.user
      ? `${ticket.user.displayName || "-"}${ticket.user.username ? ` (@${ticket.user.username})` : ""}`
      : ticket.userId;
    row.innerHTML = `
      <td>${escapeHtml(formatDate(ticket.createdAt))}</td>
      <td>${escapeHtml(userLabel)}</td>
      <td>${escapeHtml(getFeedbackCategoryLabel(ticket.category))}</td>
      <td title="${escapeHtml(ticket.message || "")}">${escapeHtml(ticket.message || "-")}</td>
      <td>${ticket.user?.feedbackBlocked ? tr("blocked") : tr("active")}</td>
      <td class="admin-action-row">
        <button class="small ghost ${ticket.user?.feedbackBlocked ? "" : "danger"}" data-action="toggle-feedback-block" data-target="${escapeHtml(ticket.userId)}" data-feedback-blocked="${ticket.user?.feedbackBlocked ? "1" : "0"}">
          ${ticket.user?.feedbackBlocked ? tr("feedbackUnblock") : tr("feedbackBlock")}
        </button>
        <button class="small ghost danger" data-action="delete-feedback" data-ticket-id="${escapeHtml(ticket.id)}">${tr("remove")}</button>
      </td>
    `;
    elements.feedbackTable.appendChild(row);
  }
}

function renderReports(reports) {
  const safeReports = Array.isArray(reports) ? reports : [];
  const query = getQuickSearchQuery();
  elements.reportsTable.innerHTML = "";
  for (const report of safeReports) {
    const row = document.createElement("tr");
    const reporter = report.reporter
      ? `${report.reporter.displayName} (@${report.reporter.username})`
      : report.reporterId;
    const target = report.reportedUser
      ? `${report.reportedUser.displayName} (@${report.reportedUser.username})`
      : report.reportedUserId;
    const chat = report.chat ? `${report.chat.type} ${report.chat.title ?? ""}`.trim() : report.chatId;
    if (
      !matchesQuickSearch(query, [report.id, reporter, target, chat, report.reason, formatDate(report.createdAt)])
    ) {
      continue;
    }

    row.innerHTML = `
      <td>${escapeHtml(formatDate(report.createdAt))}</td>
      <td>${escapeHtml(reporter)}</td>
      <td>${escapeHtml(target)}</td>
      <td>${escapeHtml(chat)}</td>
      <td>${escapeHtml(report.reason)}</td>
      <td class="admin-action-row">
        <button class="small" data-action="ban-user" data-user-id="${escapeHtml(report.reportedUserId)}">${tr("ban")}</button>
        <button class="small ghost" data-action="mute-user" data-user-id="${escapeHtml(report.reportedUserId)}" data-chat-id="${escapeHtml(report.chatId)}">
          ${tr("mute")}
        </button>
        <button class="small ghost danger" data-action="delete-report" data-report-id="${escapeHtml(report.id)}">
          ${tr("removeReport")}
        </button>
      </td>
    `;
    elements.reportsTable.appendChild(row);
  }
}

function renderErrorLogs(logs) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const query = getQuickSearchQuery();
  elements.errorLogsTable.innerHTML = "";
  for (const entry of safeLogs) {
    const row = document.createElement("tr");
    const userLabel = entry.user
      ? `${entry.user.displayName} (@${entry.user.username})`
      : entry.userId || "-";
    if (
      !matchesQuickSearch(query, [
        entry.id,
        entry.source,
        userLabel,
        entry.endpoint,
        entry.message,
        entry.statusCode,
        formatDate(entry.createdAt),
      ])
    ) {
      continue;
    }
    row.innerHTML = `
      <td>${escapeHtml(formatDate(entry.createdAt))}</td>
      <td>${escapeHtml(entry.source || "-")}</td>
      <td>${escapeHtml(userLabel)}</td>
      <td>${escapeHtml(entry.endpoint || "-")}</td>
      <td title="${escapeHtml(entry.message || "")}">${escapeHtml(entry.message || "-")}</td>
      <td>${escapeHtml(entry.statusCode || "-")}</td>
      <td>
        <button
          class="small ghost danger"
          data-action="delete-error-log"
          data-error-log-id="${escapeHtml(entry.id)}"
        >
          ${tr("remove")}
        </button>
      </td>
    `;
    elements.errorLogsTable.appendChild(row);
  }
}

function renderBans(bans) {
  const safeBans = Array.isArray(bans) ? bans : [];
  const query = getQuickSearchQuery();
  elements.bansTable.innerHTML = "";
  for (const ban of safeBans) {
    const user = ban.user ? `${ban.user.displayName} (@${ban.user.username})` : ban.userId;
    if (!matchesQuickSearch(query, [ban.id, user, ban.reason, formatDate(ban.expiresAt)])) {
      continue;
    }
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user)}</td>
      <td>${escapeHtml(ban.reason)}</td>
      <td>${escapeHtml(formatDate(ban.expiresAt))}</td>
      <td><button class="small ghost" data-action="unban" data-user-id="${escapeHtml(ban.userId)}">${tr("unban")}</button></td>
    `;
    elements.bansTable.appendChild(row);
  }
}

function renderMutes(mutes) {
  const safeMutes = Array.isArray(mutes) ? mutes : [];
  const query = getQuickSearchQuery();
  elements.mutesTable.innerHTML = "";
  for (const mute of safeMutes) {
    const user = mute.user ? `${mute.user.displayName} (@${mute.user.username})` : mute.userId;
    const chat = mute.chat ? `${mute.chat.type} ${mute.chat.title ?? ""}`.trim() : mute.chatId;
    if (!matchesQuickSearch(query, [mute.id, user, chat, mute.reason, formatDate(mute.expiresAt)])) {
      continue;
    }
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user)}</td>
      <td>${escapeHtml(chat)}</td>
      <td>${escapeHtml(mute.reason)}</td>
      <td>${escapeHtml(formatDate(mute.expiresAt))}</td>
      <td>
        <button
          class="small ghost"
          data-action="unmute"
          data-chat-id="${escapeHtml(mute.chatId)}"
          data-user-id="${escapeHtml(mute.userId)}"
        >
          ${tr("unmute")}
        </button>
      </td>
    `;
    elements.mutesTable.appendChild(row);
  }
}

function renderBotState(state) {
  if (!elements.botState) {
    return;
  }
  const bot = state?.bot ?? null;
  const recipients = Number.isFinite(state?.recipients) ? state.recipients : 0;
  if (!bot) {
    elements.botState.textContent = tr("botNotConfigured");
    return;
  }
  elements.botState.textContent = tr("botState", {
    name: bot.displayName,
    username: bot.username,
    recipients,
  });
}

function getSupportTicketStatusLabel(ticket) {
  if (ticket?.claimedByMe) {
    return tr("ticketMine");
  }
  if (ticket?.claimedByOther) {
    return tr("ticketOther");
  }
  return tr("ticketOpen");
}

function renderSupportTickets(tickets) {
  if (!elements.supportTicketsList) {
    return;
  }
  const query = getQuickSearchQuery();
  const list = (Array.isArray(tickets) ? tickets : []).filter((ticket) => {
    const user = ticket.user
      ? `${ticket.user.displayName || tr("unknown")}${ticket.user.username ? ` (@${ticket.user.username})` : ""}`
      : tr("unknown");
    return matchesQuickSearch(query, [
      ticket.id,
      ticket.number,
      ticket.category,
      ticket.categoryLabel,
      user,
      getSupportTicketStatusLabel(ticket),
    ]);
  });
  elements.supportTicketsList.innerHTML = "";
  if (!list.length) {
    elements.supportTicketsList.innerHTML = `<div class="hint">${escapeHtml(query ? tr("noResults") : tr("noTickets"))}</div>`;
    return;
  }
  for (const ticket of list) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `admin-support-ticket-item${activeSupportTicketId === ticket.id ? " active" : ""}`;
    row.dataset.ticketId = ticket.id;
    const user = ticket.user
      ? `${ticket.user.displayName || tr("unknown")}${ticket.user.username ? ` (@${ticket.user.username})` : ""}`
      : tr("unknown");
    row.innerHTML = `
      <strong>#${escapeHtml(ticket.number)}</strong>
      <span>${escapeHtml(user)}</span>
      <span class="hint">${escapeHtml(ticket.categoryLabel || ticket.category || "-")}</span>
      <span class="hint">${escapeHtml(getSupportTicketStatusLabel(ticket))}</span>
    `;
    elements.supportTicketsList.appendChild(row);
  }
}

function renderSupportThread() {
  const selected = Boolean(activeSupportTicket && activeSupportTicketId);
  elements.supportTicketEmpty?.classList.toggle("hidden", selected);
  elements.supportTicketMessages?.classList.toggle("hidden", !selected);
  elements.supportTicketReplyForm?.classList.toggle("hidden", !selected);

  if (!selected) {
    if (elements.supportTicketMeta) {
      elements.supportTicketMeta.textContent = tr("pickTicket");
    }
    if (elements.supportTicketClaimBtn) {
      elements.supportTicketClaimBtn.disabled = true;
    }
    if (elements.supportTicketCloseBtn) {
      elements.supportTicketCloseBtn.disabled = true;
    }
    return;
  }

  const user = activeSupportTicket.user
    ? `${activeSupportTicket.user.displayName || tr("unknown")}${
        activeSupportTicket.user.username ? ` (@${activeSupportTicket.user.username})` : ""
      }`
    : tr("unknown");

  if (elements.supportTicketMeta) {
    elements.supportTicketMeta.textContent = tr("ticketMeta", {
      number: activeSupportTicket.number,
      category: activeSupportTicket.categoryLabel || activeSupportTicket.category || "-",
      user,
      status: getSupportTicketStatusLabel(activeSupportTicket),
    });
  }

  if (elements.supportTicketClaimBtn) {
    elements.supportTicketClaimBtn.disabled = activeSupportTicket.claimedByOther;
  }
  if (elements.supportTicketCloseBtn) {
    elements.supportTicketCloseBtn.disabled = !activeSupportTicket.claimedByMe;
  }
  if (elements.supportTicketReplyText) {
    elements.supportTicketReplyText.disabled = !activeSupportCanReply;
  }

  if (!elements.supportTicketMessages) {
    return;
  }
  elements.supportTicketMessages.innerHTML = "";
  for (const message of activeSupportMessages) {
    const node = document.createElement("div");
    const fromOperator = Boolean(message.sender?.isSystemBot);
    node.className = `admin-support-message ${fromOperator ? "operator" : "user"}`;
    const sender = fromOperator
      ? "Yooh Support"
      : message.sender?.displayName || message.sender?.username || tr("unknown");
    node.innerHTML = `
      <div class="admin-support-message-head">
        <strong>${escapeHtml(sender)}</strong>
        <span class="hint">${escapeHtml(formatDate(message.createdAt))}</span>
      </div>
      <div class="admin-support-message-body">${escapeHtml(message.text || message.file?.originalName || "-")}</div>
    `;
    elements.supportTicketMessages.appendChild(node);
  }
  elements.supportTicketMessages.scrollTop = elements.supportTicketMessages.scrollHeight;
}

async function loadSupportThread(ticketId, options = {}) {
  const preserveSelection = Boolean(options.preserveSelection);
  const safeTicketId = String(ticketId || "").trim();
  if (!safeTicketId) {
    activeSupportTicketId = "";
    activeSupportTicket = null;
    activeSupportMessages = [];
    activeSupportCanReply = false;
    renderSupportThread();
    return;
  }
  if (!preserveSelection) {
    activeSupportTicketId = safeTicketId;
  }
  const payload = await api(`/api/admin/support-tickets/${safeTicketId}/messages`);
  activeSupportTicket = payload.ticket || null;
  activeSupportMessages = Array.isArray(payload.messages) ? payload.messages : [];
  activeSupportCanReply = Boolean(payload.canReply);
  renderSupportTickets(supportTicketsState);
  renderSupportThread();
}

async function reloadCore() {
  if (coreReloadInFlight) {
    return;
  }

  coreReloadInFlight = true;
  try {
    const [{ stats }, { codes }, { moderation }, { users }, { state: botState }, { tickets }, { tickets: supportTickets }] =
      await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/auth-codes"),
      api("/api/admin/moderation"),
      api("/api/admin/users"),
      api("/api/admin/system-bot"),
      api("/api/admin/feedback"),
      api("/api/admin/support-tickets"),
      ]);
    let runtimePayload = null;
    if (runtimeMonitorEnabled) {
      runtimePayload = await api("/api/admin/runtime");
    }
    renderStats(stats, runtimePayload);
    adminCodesState = Array.isArray(codes) ? codes : [];
    adminUsersState = Array.isArray(users) ? users : [];
    adminReportsState = Array.isArray(moderation?.reports) ? moderation.reports : [];
    adminBansState = Array.isArray(moderation?.bans) ? moderation.bans : [];
    adminMutesState = Array.isArray(moderation?.mutes) ? moderation.mutes : [];
    renderCodes(adminCodesState);
    renderUsers(adminUsersState);
    renderReports(adminReportsState);
    feedbackTicketsState = Array.isArray(tickets) ? tickets : [];
    renderFeedbackTickets(feedbackTicketsState);
    supportTicketsState = Array.isArray(supportTickets) ? supportTickets : [];
    renderSupportTickets(supportTicketsState);
    if (activeSupportTicketId) {
      const exists = supportTicketsState.some((entry) => entry.id === activeSupportTicketId);
      if (exists) {
        await loadSupportThread(activeSupportTicketId, { preserveSelection: true });
      } else {
        activeSupportTicketId = "";
        activeSupportTicket = null;
        activeSupportMessages = [];
        activeSupportCanReply = false;
        renderSupportThread();
      }
    } else {
      renderSupportThread();
    }
    renderBans(adminBansState);
    renderMutes(adminMutesState);
    renderBotState(botState);
    adminStatusState.otp = adminCodesState.length;
    adminStatusState.reports = adminReportsState.length;
    adminStatusState.feedback = feedbackTicketsState.length;
    adminStatusState.tickets = supportTicketsState.length;
    markLastUpdated();
    updateLoadedStatus();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    coreReloadInFlight = false;
  }
}

async function reloadErrorLogs({ silent = false } = {}) {
  if (errorLogsReloadInFlight) {
    return;
  }

  errorLogsReloadInFlight = true;
  try {
    const { logs } = await api("/api/admin/error-logs?limit=200");
    adminErrorLogsState = Array.isArray(logs) ? logs : [];
    renderErrorLogs(adminErrorLogsState);
    adminStatusState.errors = adminErrorLogsState.length;
    if (!silent) {
      updateLoadedStatus();
    }
  } catch (error) {
    if (!silent) {
      setStatus(`Error logs: ${error.message}`, true);
    }
  } finally {
    errorLogsReloadInFlight = false;
  }
}

async function reloadAll(options = {}) {
  const { silentErrorLogs = true } = options;
  await reloadCore();
  await reloadErrorLogs({ silent: silentErrorLogs });
  if (silentErrorLogs) {
    updateLoadedStatus();
  }
}

elements.loadButton.addEventListener("click", () => {
  reloadAll({ silentErrorLogs: false });
});

elements.refreshNowButton?.addEventListener("click", () => {
  reloadAll({ silentErrorLogs: false });
});

elements.quickSearchInput?.addEventListener("input", () => {
  rerenderAdminFromState();
});

elements.quickSearchClearBtn?.addEventListener("click", () => {
  if (elements.quickSearchInput) {
    elements.quickSearchInput.value = "";
    elements.quickSearchInput.focus();
  }
  rerenderAdminFromState();
});

elements.autoRefreshToggle?.addEventListener("click", () => {
  autoRefreshEnabled = !autoRefreshEnabled;
  syncAutoRefreshToggle();
});

if (elements.runtimeMonitorToggle) {
  elements.runtimeMonitorToggle.addEventListener("click", () => {
    runtimeMonitorEnabled = !runtimeMonitorEnabled;
    syncRuntimeMonitorToggle();
    reloadCore();
  });
}

elements.banForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/bans", {
      method: "POST",
      body: {
        userId: elements.banUserId.value.trim(),
        reason: elements.banReason.value.trim(),
        expiresAt: toIsoFromLocal(elements.banExpiresAt.value),
      },
    });
    elements.banUserId.value = "";
    elements.banReason.value = "";
    elements.banExpiresAt.value = "";
    await reloadAll({ silentErrorLogs: false });
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.muteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/mutes", {
      method: "POST",
      body: {
        chatId: elements.muteChatId.value.trim(),
        userId: elements.muteUserId.value.trim(),
        reason: elements.muteReason.value.trim(),
        expiresAt: toIsoFromLocal(elements.muteExpiresAt.value),
      },
    });
    elements.muteChatId.value = "";
    elements.muteUserId.value = "";
    elements.muteReason.value = "";
    elements.muteExpiresAt.value = "";
    await reloadAll({ silentErrorLogs: false });
  } catch (error) {
    setStatus(error.message, true);
  }
});

if (elements.botBroadcastForm) {
  elements.botBroadcastForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const text = String(elements.botBroadcastText?.value ?? "").trim();
      await api("/api/admin/system-bot/broadcast", {
        method: "POST",
        body: { text },
      });
      if (elements.botBroadcastText) {
        elements.botBroadcastText.value = "";
      }
      await reloadAll({ silentErrorLogs: false });
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

if (elements.botStoryForm) {
  elements.botStoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const text = String(elements.botStoryText?.value ?? "").trim();
      await api("/api/admin/system-bot/stories", {
        method: "POST",
        body: { text },
      });
      if (elements.botStoryText) {
        elements.botStoryText.value = "";
      }
      await reloadAll({ silentErrorLogs: false });
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

if (elements.botMessageForm) {
  elements.botMessageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const target = String(elements.botTarget?.value ?? "").trim();
      const text = String(elements.botMessageText?.value ?? "").trim();
      await api("/api/admin/system-bot/message", {
        method: "POST",
        body: {
          target,
          text,
        },
      });
      if (elements.botTarget) {
        elements.botTarget.value = "";
      }
      if (elements.botMessageText) {
        elements.botMessageText.value = "";
      }
      await reloadAll({ silentErrorLogs: false });
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

async function onTableAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  try {
    if (action === "unban") {
      await api(`/api/admin/bans/${button.dataset.userId}`, { method: "DELETE" });
    }
    if (action === "unmute") {
      await api(`/api/admin/mutes/${button.dataset.chatId}/${button.dataset.userId}`, { method: "DELETE" });
    }
    if (action === "ban-user") {
      await api("/api/admin/bans", {
        method: "POST",
        body: {
          userId: button.dataset.userId,
          reason: "Auto ban from reports",
        },
      });
    }
    if (action === "mute-user") {
      await api("/api/admin/mutes", {
        method: "POST",
        body: {
          chatId: button.dataset.chatId,
          userId: button.dataset.userId,
          reason: "Auto mute from reports",
        },
      });
    }
    if (action === "delete-report") {
      await api(`/api/admin/reports/${button.dataset.reportId}`, {
        method: "DELETE",
      });
    }
    if (action === "delete-error-log") {
      await api(`/api/admin/error-logs/${button.dataset.errorLogId}`, {
        method: "DELETE",
      });
    }
    if (action === "grant-plus") {
      await api("/api/admin/users/entitlements", {
        method: "POST",
        body: {
          target: button.dataset.target,
          isPremium: true,
          premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
    }
    if (action === "revoke-plus") {
      await api("/api/admin/users/entitlements", {
        method: "POST",
        body: {
          target: button.dataset.target,
          isPremium: false,
          premiumUntil: null,
        },
      });
    }
    if (action === "grant-stars") {
      const starsDelta = (() => {
        const raw = window.prompt(tr("starsPrompt"), "100");
        if (raw === null) {
          return null;
        }
        const value = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(value) || value === 0) {
          throw new Error("Stars delta must be a non-zero integer.");
        }
        return value;
      })();
      if (starsDelta === null) {
        return;
      }
      await api("/api/admin/users/entitlements", {
        method: "POST",
        body: {
          target: button.dataset.target,
          starsDelta,
        },
      });
    }
    if (action === "toggle-business") {
      await api("/api/admin/users/entitlements", {
        method: "POST",
        body: {
          target: button.dataset.target,
          businessEnabled: button.dataset.enabled === "1",
        },
      });
    }
    if (action === "toggle-feedback-block") {
      await api("/api/admin/users/entitlements", {
        method: "POST",
        body: {
          target: button.dataset.target,
          feedbackBlocked: button.dataset.feedbackBlocked !== "1",
        },
      });
    }
    if (action === "delete-feedback") {
      await api(`/api/admin/feedback/${button.dataset.ticketId}`, {
        method: "DELETE",
      });
    }
    await reloadAll({ silentErrorLogs: false });
    setStatus(tr("done"));
  } catch (error) {
    setStatus(error.message, true);
  }
}

elements.usersTable?.addEventListener("click", onTableAction);
elements.reportsTable.addEventListener("click", onTableAction);
elements.feedbackTable?.addEventListener("click", onTableAction);
elements.errorLogsTable.addEventListener("click", onTableAction);
elements.bansTable.addEventListener("click", onTableAction);
elements.mutesTable.addEventListener("click", onTableAction);
elements.supportTicketsList?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-ticket-id]");
  if (!row) {
    return;
  }
  const ticketId = String(row.dataset.ticketId || "").trim();
  if (!ticketId) {
    return;
  }
  loadSupportThread(ticketId).catch((error) => {
    setStatus(error.message, true);
  });
});
elements.supportTicketClaimBtn?.addEventListener("click", async () => {
  if (!activeSupportTicketId) {
    return;
  }
  try {
    await api(`/api/admin/support-tickets/${activeSupportTicketId}/claim`, { method: "POST" });
    await reloadCore();
    await loadSupportThread(activeSupportTicketId, { preserveSelection: true });
    setStatus(tr("done"));
  } catch (error) {
    setStatus(error.message, true);
  }
});
elements.supportTicketCloseBtn?.addEventListener("click", async () => {
  if (!activeSupportTicketId) {
    return;
  }
  if (!window.confirm(tr("closeTicketConfirm"))) {
    return;
  }
  try {
    await api(`/api/admin/support-tickets/${activeSupportTicketId}/close`, { method: "POST" });
    activeSupportTicketId = "";
    activeSupportTicket = null;
    activeSupportMessages = [];
    activeSupportCanReply = false;
    await reloadCore();
    renderSupportThread();
    setStatus(tr("done"));
  } catch (error) {
    setStatus(error.message, true);
  }
});
elements.supportTicketReplyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeSupportTicketId) {
    return;
  }
  if (!activeSupportCanReply) {
    setStatus(tr("claimRequired"), true);
    return;
  }
  const text = String(elements.supportTicketReplyText?.value ?? "").trim();
  if (!text) {
    return;
  }
  try {
    await api(`/api/admin/support-tickets/${activeSupportTicketId}/reply`, {
      method: "POST",
      body: { text },
    });
    if (elements.supportTicketReplyText) {
      elements.supportTicketReplyText.value = "";
    }
    await loadSupportThread(activeSupportTicketId, { preserveSelection: true });
    await reloadCore();
  } catch (error) {
    setStatus(error.message, true);
  }
});
elements.langSelect?.addEventListener("change", () => {
  activeLang = ["ru", "en"].includes(String(elements.langSelect?.value ?? "")) ? elements.langSelect.value : "ru";
  applyLocale();
  reloadAll({ silentErrorLogs: true });
});

applyLocale();
applyAdminTab();
renderSupportThread();
reloadAll({ silentErrorLogs: true });
for (const button of elements.adminTabButtons) {
  button.addEventListener("click", () => {
    activeAdminTab = button.dataset.adminTabBtn || "overview";
    applyAdminTab();
  });
}
elements.feedbackCategoryFilter?.addEventListener("change", () => renderFeedbackTickets(feedbackTicketsState));
elements.feedbackUserFilter?.addEventListener("input", () => renderFeedbackTickets(feedbackTicketsState));
elements.feedbackSort?.addEventListener("change", () => renderFeedbackTickets(feedbackTicketsState));
setInterval(() => {
  if (document.visibilityState !== "visible" || !autoRefreshEnabled) {
    return;
  }
  reloadCore();
}, ADMIN_CORE_POLL_INTERVAL_MS);
setInterval(() => {
  if (document.visibilityState !== "visible" || !autoRefreshEnabled) {
    return;
  }
  reloadErrorLogs({ silent: true });
}, ADMIN_ERROR_LOGS_POLL_INTERVAL_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && autoRefreshEnabled) {
    reloadAll({ silentErrorLogs: true });
  }
});
