import Foundation
import Observation

/// Chat list: REST refresh + realtime row updates + local pin/archive/mute.
///
/// Unread state uses the server's `readByUserIds` on `lastMessage`
/// (same heuristic as the web client). Pins/archive/mutes are local-only,
/// mirroring `yooh_pinned_chats` / `yooh_archived_chats` semantics.
@Observable
@MainActor
final class ChatsViewModel {
    private(set) var chats: [YoohChat] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isConnected = false

    var searchText = ""
    var showArchived = false

    private let app: AppState
    private var prefs: LocalPreferences?
    private var refreshTask: Task<Void, Never>?
    private var socketTask: Task<Void, Never>?

    init(app: AppState) {
        self.app = app
        // Socket state → UI dot. Assigned lazily on first refresh to
        // avoid retain issues during AppState init.
    }

    var myUserId: String? { app.session.currentUser?.id }

    private func ensurePrefs() {
        if prefs == nil, let id = myUserId {
            prefs = LocalPreferences(userId: id)
        }
    }

    // MARK: - Filtering / sorting

    var visibleChats: [YoohChat] {
        ensurePrefs()
        let pinned = prefs?.pinnedChatIds ?? []
        let archived = prefs?.archivedChatIds ?? []
        var list = chats.filter { showArchived ? archived.contains($0.id) : !archived.contains($0.id) }
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            list = list.filter { chat in
                chat.displayTitle.lowercased().contains(q)
                || (chat.handle?.lowercased().contains(q) ?? false)
                || chat.lastMessage?.text?.lowercased().contains(q) ?? false
            }
        }
        return list.sorted { a, b in
            let pa = pinned.contains(a.id), pb = pinned.contains(b.id)
            if pa != pb { return pa }
            return (a.lastMessage?.createdAt ?? a.updatedAt ?? "") > (b.lastMessage?.createdAt ?? b.updatedAt ?? "")
        }
    }

    var unreadCount: Int {
        guard let me = myUserId else { return 0 }
        let archived = prefs?.archivedChatIds ?? []
        return chats.filter { !archived.contains($0.id) && $0.hasUnread(myUserId: me) }.count
    }

    func isPinned(_ id: String) -> Bool { prefs?.pinnedChatIds.contains(id) ?? false }
    func isMuted(_ id: String) -> Bool { prefs?.mutedChatIds.contains(id) ?? false }
    func isArchived(_ id: String) -> Bool { prefs?.archivedChatIds.contains(id) ?? false }

    func togglePin(_ id: String) { ensurePrefs(); prefs?.togglePin(id); Haptics.selection() }
    func toggleArchive(_ id: String) { ensurePrefs(); prefs?.toggleArchive(id); Haptics.selection() }
    func toggleMute(_ id: String) { ensurePrefs(); prefs?.toggleMute(id); Haptics.selection() }

    func showError(_ message: String) { error = message }
    func clearError() { error = nil }

    // MARK: - Loading

    func refresh() async {
        guard app.session.isAuthenticated else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            chats = try await app.chatsService.list()
        } catch {
            // 401 auto-logs-out via APIClient; only surface other errors.
            if !((error as? APIError)?.isAuthExpired ?? false) {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// Called on every socket (re)connect: join rooms + full sync,
    /// mirroring web `loadChats` + `syncAppState`.
    func refreshAfterConnect() async {
        await refresh()
        for chat in chats {
            app.socket.joinChat(chat.id)
        }
        isConnected = true
    }

    /// Debounced full refresh for chat-level events.
    func scheduleRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    /// Optimistic row update from an incoming message without a full reload.
    func applyIncomingMessage(_ message: YoohMessage) {
        guard let idx = chats.firstIndex(where: { $0.id == message.chatId }) else {
            scheduleRefresh() // unknown chat (e.g. just added) → sync
            return
        }
        // YoohChat is a value type; refresh the row on next sync tick.
        // Immediate full decode of a list is wasteful per keystroke-burst,
        // so debounce instead.
        _ = idx
        scheduleRefresh()
    }

    func deleteChat(_ chat: YoohChat) async {
        do {
            try await app.chatsService.delete(chatId: chat.id)
            chats.removeAll { $0.id == chat.id }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func clearHistory(_ chat: YoohChat) async {
        do {
            _ = try await app.chatsService.clearHistory(chatId: chat.id)
            await refresh()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
