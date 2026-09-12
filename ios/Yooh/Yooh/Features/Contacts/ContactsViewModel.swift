import Contacts
import Foundation
import Observation

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

    private enum Scope {
        case all, people, channels, groups, servers
    }

    func search(_ text: String, botsOnly: Bool = false) {
        query = text
        searchTask?.cancel()
        var q = text.trimmingCharacters(in: .whitespaces)
        var scopeBots = botsOnly
        var scope: Scope = .all
        if let first = q.first, "@%&$*".contains(first) {
            switch first {
            case "@": scope = .people
            case "%": scope = .channels
            case "&": scope = .groups
            case "$": scope = .servers
            case "*": scopeBots = true
            default: break
            }
            q = String(q.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
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
                if scopeBots {
                    users = try await app.userService.searchBots(query: q)
                    publicChats = []
                    return
                }
                async let u = app.userService.searchUsers(query: q)
                async let d = app.chatsService.discover(query: q)
                let (found, discovered) = try await (u, d)
                guard !Task.isCancelled else { return }
                users = scope == .all || scope == .people ? found : []
                publicChats = discovered.filter { dc in
                    switch scope {
                    case .all, .people: return true
                    case .channels: return (dc.type ?? "") == "channel"
                    case .groups: return (dc.type ?? "") == "group"
                    case .servers: return (dc.type ?? "") == "server"
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func openDirect(with user: PublicUser) async -> OpenDirectResult? {
        do {
            if let existing = app.chatsViewModel.chats.first(where: {
                $0.type == .direct && $0.members.contains(where: { $0.userId == user.id })
            }) {
                return .chat(existing)
            }
            let chat = try await app.chatsService.create(type: "direct", memberId: user.id)
            await app.chatsViewModel.refresh()
            app.socket.joinChat(chat.id)
            return .chat(chat)
        } catch {
            if case APIError.forbidden(let message) = error,
               message.localizedCaseInsensitiveContains("restrict")
            {
                return .needsRequest(user)
            }
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

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
}
