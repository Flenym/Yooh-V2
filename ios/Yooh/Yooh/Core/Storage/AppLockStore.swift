import Foundation
import LocalAuthentication
import Observation

/// App lock (Face ID / device passcode). Presentation-only and local:
/// shows a lock screen on launch and on return from background.
@Observable
final class AppLockStore {
    static let shared = AppLockStore()

    var isEnabled: Bool {
        didSet { UserDefaults.standard.set(isEnabled, forKey: Keys.enabled) }
    }

    var isLocked = false
    var error: String?

    private init() {
        isEnabled = UserDefaults.standard.bool(forKey: Keys.enabled)
        isLocked = isEnabled
    }

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "device passcode"
        }
    }

    @MainActor
    func unlock() async -> Bool {
        error = nil
        let ctx = LAContext()
        do {
            let ok = try await ctx.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock Yooh")
            if ok { isLocked = false }
            return ok
        } catch {
            self.error = (error as? LAError)?.localizedDescription ?? error.localizedDescription
            return false
        }
    }

    func lock() {
        if isEnabled { isLocked = true }
    }

    func clearError() { error = nil }

    enum Keys {
        static let enabled = "yooh.applock.enabled"
    }
}
