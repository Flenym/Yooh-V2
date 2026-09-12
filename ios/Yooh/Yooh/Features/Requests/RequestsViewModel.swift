import Foundation
import Observation

/// Message-request inbox (incoming accept/decline, outgoing list).
@Observable
@MainActor
final class RequestsViewModel {
    private(set) var incoming: [MessageRequest] = []
    private(set) var outgoing: [MessageRequest] = []
    private(set) var isLoading = false
    private(set) var error: String?

    var app: AppState! = nil

    var badgeCount: Int { incoming.count }

    func refresh() async {
        guard app.session.isAuthenticated else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let box = try await app.requestsService.inbox()
            incoming = box.incoming
            outgoing = box.outgoing
        } catch {
            if !((error as? APIError)?.isAuthExpired ?? false) {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func accept(_ request: MessageRequest) async -> YoohChat? {
        do {
            let res: RequestResult = try await app.requestsService.accept(request.id)
            await refresh()
            await app.chatsViewModel.refresh()
            Haptics.send()
            if let chat = res.chat {
                app.socket.joinChat(chat.id)
                return chat
            }
            return nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    func decline(_ request: MessageRequest) async {
        do {
            try await app.requestsService.decline(request.id)
            await refresh()
            Haptics.selection()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func clearError() { error = nil }
}
