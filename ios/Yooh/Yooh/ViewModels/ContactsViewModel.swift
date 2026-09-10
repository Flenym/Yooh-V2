import Contacts
import Foundation
import Observation

/// Global search (users + public chats) and new-chat creation.
@Observable
@MainActor
final class ContactsViewModel {
    var query = ""
    private(set) var users: [PublicUser] = []
    private(set) var publicChats: [DiscoveredChat] = []
    private(set) var isSearching = false
    private(set) var error: String?
    private(set) var notice: String?
    private(set) var isSyncing = false

    var app: AppState! = nil
    private var searchTask: Task<Void, Never>?

    func clearError() { error = nil }
    func clearNotice() { notice = nil }

    /// Reads device phone numbers (with permission) and uploads them for
    /// server-side matching. Mutual matches auto-create direct chats.
    func syncPhoneContacts() async {
        error = nil
        notice = nil
        let store = CNContactStore()
        do {
            let granted = try await store.requestAccess(for: .contacts)
            guard granted else {
                error = "Contacts access is required for sync. Allow it in Settings."
                return
            }
        } catch {
            self.error = "Contacts access is required for sync. Allow it in Settings."
            return
        }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let keys = [CNContactPhoneNumbersKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            var phones: [String] = []
            try store.enumerateContacts(with: request) { contact, _ in
                for labeled in contact.phoneNumbers {
                    phones.append(labeled.value.stringValue)
                }
            }
            phones = Array(Set(phones)).prefix(2000).map { $0 }
            guard !phones.isEmpty else {
                notice = "No phone numbers found on this device."
                return
            }
            let result = try await app.userService.syncContacts(phones: phones)
            await app.chatsViewModel.refresh()
            let n = result.matches?.count ?? 0
            notice = n > 0 ? "Found \(n) contact\(n == 1 ? "" : "s") on Yooh." : "No mutual contacts found yet."
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func search(_ text: String, botsOnly: Bool = false) {
        query = text
        searchTask?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            users.removeAll()
            publicChats.removeAll()
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let found: [PublicUser]
                let discovered: [DiscoveredChat]
                if botsOnly {
                    found = try await app.userService.searchBots(query: q)
                    discovered = []
                } else {
                    async let u = app.userService.searchUsers(query: q)
                    async let d = app.chatsService.discover(query: q)
                    (found, discovered) = try await (u, d)
                }
                guard !Task.isCancelled else { return }
                users = found
                publicChats = discovered
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// Saved Messages: the direct chat with yourself (no peer).
    /// The server dedupes it like any direct chat, so this is find-or-create.
    func openSaved() async -> YoohChat? {
        guard let me = app.session.currentUser?.id else { return nil }
        if let existing = app.chatsViewModel.chats.first(where: {
            $0.type == .direct && $0.peer(myUserId: me) == nil
        }) {
            return existing
        }
        do {
            let chat = try await app.chatsService.create(type: "direct", memberId: me)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(chat.id)
            return chat
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    /// Opens (or finds) a 1:1 chat with a user, then refreshes the list.
    func openDirect(with user: PublicUser) async -> YoohChat? {        do {
            if let existing = app.chatsViewModel.chats.first(where: {
                $0.type == .direct && $0.members.contains(where: { $0.userId == user.id })
            }) {
                return existing
            }
            let chat = try await app.chatsService.create(type: "direct", memberId: user.id)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(chat.id)
            return chat
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    func joinPublic(_ chat: DiscoveredChat) async -> YoohChat? {
        guard let handle = chat.handle else { return nil }
        do {
            let joined = try await app.chatsService.join(handle: handle)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(joined.id)
            return joined
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    func createGroup(title: String, memberIds: [String], isPublic: Bool = false) async -> YoohChat? {
        do {
            let chat = try await app.chatsService.create(
                type: "group", title: title, memberIds: memberIds, isPublic: isPublic)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(chat.id)
            return chat
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    func createChannel(title: String, description: String? = nil) async -> YoohChat? {
        do {
            let chat = try await app.chatsService.create(
                type: "channel", title: title, description: description)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(chat.id)
            return chat
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }
}
