import Foundation
import Observation

/// Owns authentication state: JWT (Keychain) + current user (memory).
///
/// - Token lives in Keychain (`authToken`), mirroring `localStorage yooh_token`.
/// - 401 from APIClient triggers `handleUnauthorized()` → logout,
///   exactly like the web client's `resetToAuth()`.
/// - Session revocation via realtime (`auth:session-revoked`) funnels here too.
@Observable
@MainActor
final class SessionStore {
    static let shared = SessionStore()

    private(set) var token: String?
    private(set) var currentUser: YoohUser?
    private(set) var isRestoring = true

    var isAuthenticated: Bool { token != nil }

    private init() {}

    /// Called once at app launch: wires APIClient and restores the session.
    func bootstrap(api: APIClient = .shared, auth: AuthService? = nil) async {
        // Read straight from Keychain: synchronous, thread-safe, and always
        // current (the in-memory copy is UI state only).
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
            // Validate the stored token the same way the web client does
            // on boot (GET /api/me); a dead token falls back to login.
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

    func updateUser(_ user: YoohUser) {
        currentUser = user
    }

    func logout() {
        KeychainStore.delete(for: .authToken)
        token = nil
        currentUser = nil
        Task { await ImageCache.shared.clear() }
    }

    /// Server rejected the token (401) or another device revoked this session.
    func handleUnauthorized() {
        logout()
    }
}

// The /api/me envelope is { user: SafeUser }.
private struct MeEnvelope: Decodable {
    let user: YoohUser
}
