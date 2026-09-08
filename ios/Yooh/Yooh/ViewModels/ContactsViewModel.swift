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

    private let app: AppState
    private var searchTask: Task<Void, Never>?

    init(app: AppState) {
        self.app = app
    }

    func clearError() { error = nil }

    func search(_ text: String) {
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
            async let u = app.userService.searchUsers(query: q)
            async let d = app.chatsService.discover(query: q)
            do {
                let (found, discovered) = try await (u, d)
                guard !Task.isCancelled else { return }
                users = found
                publicChats = discovered
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// Opens (or finds) a 1:1 chat with a user, then refreshes the list.
    func openDirect(with user: PublicUser) async -> YoohChat? {
        do {
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
