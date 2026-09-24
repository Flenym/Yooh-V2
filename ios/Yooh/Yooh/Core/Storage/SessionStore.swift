import Foundation
import Observation

/// Owns authentication state: JWT (Keychain) + current user (memory).
/// 401 from APIClient triggers logout, like the web client's resetToAuth.
/// Session revocation via realtime funnels here too.
@Observable
@MainActor
final class SessionStore {
    static let shared = SessionStore()

    private(set) var token: String?
    private(set) var currentUser: YoohUser?
    private(set) var isRestoring = true

    var isAuthenticated: Bool { token != nil }

    private init() {}

    func bootstrap(api: APIClient = .shared) async {
        api.tokenProvider = { KeychainStore.load(key: .authToken) }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        token = KeychainStore.load(key: .authToken)
        guard token != nil else {
            isRestoring = false
            return
        }
        do {
            let env: MeEnvelope = try await api.send(.me)
            currentUser = env.user
        } catch {
            logout()
        }
        isRestoring = false
    }

    func saveSession(token: String, user: YoohUser) {
        KeychainStore.save(token, for: .authToken)
        self.token = token
        self.currentUser = user
    }

#if DEBUG
    /// Visual-QA seeding: in-memory session, Keychain untouched.
    func seedPreviewSession(user: YoohUser, token: String) {
        self.token = token
        self.currentUser = user
        isRestoring = false
    }
#endif

    func updateUser(_ user: YoohUser) {
        currentUser = user
    }

    func logout() {
        KeychainStore.delete(for: .authToken)
        token = nil
        currentUser = nil
        Task { await ImageCache.shared.clear() }
    }

    func handleUnauthorized() {
        logout()
    }
}

private struct MeEnvelope: Decodable {
    let user: YoohUser
}
