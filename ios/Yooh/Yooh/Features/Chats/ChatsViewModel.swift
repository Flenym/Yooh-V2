import Foundation
import Observation

/// Chat list: REST refresh + debounced realtime row updates + local
/// pin/archive/mute/folders. Unread derives from `readByUserIds`.
@Observable
@MainActor
final class ChatsViewModel {
    private(set) var chats: [YoohChat] = []
    private(set) var isLoading = false
    private(set) var error: String?

    var searchText = ""

    enum Folder: String, CaseIterable {
        case all = "All"
        case unread = "Unread"
        case personal = "Personal"
        case groups = "Groups"
        case channels = "Channels"
        case archived = "Archived"
    }

    var folder: Folder = .all
    var customFolder: LocalPreferences.FolderDef?
    var customFolders: [LocalPreferences.FolderDef] = []
    var showArchived = false

    var app: AppState! = nil
    private var prefs: LocalPreferences?
    private var refreshTask: Task<Void, Never>?

    var myUserId: String? { app.session.currentUser?.id }

    private func ensurePrefs() {
        if prefs == nil, let id = myUserId {
            prefs = LocalPreferences(userId: id)
        }
    }

    func setFolder(_ f: Folder) {
        folder = f
        customFolder = nil
        showArchived = (f == .archived)
        Haptics.selection()
    }

    func setCustomFolder(_ f: LocalPreferences.FolderDef?) {
        customFolder = f
        showArchived = false
        Haptics.selection()
    }

    func reloadFolders() {
        ensurePrefs()
        customFolders = prefs?.customFolders ?? []
        if let cf = customFolder, !customFolders.contains(where: { $0.id == cf.id }) {
            customFolder = nil
        }
    }

    func saveCustomFolder(_ f: LocalPreferences.FolderDef) {
        ensurePrefs()
        prefs?.saveFolder(f)
        reloadFolders()
    }

    func deleteCustomFolder(_ id: String) {
        ensurePrefs()
        prefs?.deleteFolder(id)
        reloadFolders()
    }

    var visibleChats: [YoohChat] {
        ensurePrefs()
        let pinned = prefs?.pinnedChatIds ?? []
        let archived = prefs?.archivedChatIds ?? []
        var list = chats.filter { showArchived ? archived.contains($0.id) : !archived.contains($0.id) }
        if let me = myUserId {
            if let cf = customFolder {
                list = list.filter { chat in
                    let kindOK = (chat.type == .direct && cf.includeDirect)
                        || (chat.type == .group && cf.includeGroups)
                        || (chat.isChannel && cf.includeChannels)
                    return kindOK && (!cf.unreadOnly || chat.hasUnread(myUserId: me))
                }
            } else {
                switch folder {
                case .all, .archived:
                    break
                case .unread:
                    list = list.filter { $0.hasUnread(myUserId: me) }
                case .personal:
                    list = list.filter { $0.type == .direct }
                case .groups:
                    list = list.filter { $0.type == .group }
                case .channels:
                    list = list.filter { $0.isChannel }
                }
            }
        }
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

#if DEBUG
    /// Visual-QA seeding (simulator screenshots, no backend).
    func seedPreviewChats(_ items: [YoohChat]) {
        chats = items
        isLoading = false
        error = nil
    }
#endif

    func refresh() async {
        guard app.session.isAuthenticated else { return }
        guard !UITestPreview.isActive else { return }
        let uid = myUserId ?? ""
        // Instant open: show device cache first, sync in background.
        if chats.isEmpty, let cached = ChatCache.loadChats(userId: uid), !cached.isEmpty {
            chats = cached
        }
        reloadFolders()
        isLoading = true
        if chats.isEmpty { error = nil }
        defer { isLoading = false }
        do {
            chats = try await app.chatsService.list()
            error = nil
            ChatCache.saveChats(chats, userId: uid)
        } catch {
            if !((error as? APIError)?.isAuthExpired ?? false) {
                // Offline with cache: status pill covers it, no banner spam.
                if chats.isEmpty {
                    self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    func refreshAfterConnect() async {
        await refresh()
        for chat in chats {
            app.socket.joinChat(chat.id)
        }
    }

    func scheduleRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    func applyIncomingMessage(_ message: YoohMessage) {
        guard chats.contains(where: { $0.id == message.chatId }) else {
            scheduleRefresh()
            return
        }
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
