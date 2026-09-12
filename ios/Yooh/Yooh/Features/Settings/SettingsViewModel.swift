import Foundation
import Observation

@Observable
@MainActor
final class SettingsViewModel {
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var notice: String?

    private(set) var language = "en"
    private(set) var sessions: [AuthSession] = []
    private(set) var currentSession: AuthSession?
    private(set) var stickerPacks: [StickerPack] = []

    var serverURL: String = UserDefaults.standard.string(forKey: AppConfig.Keys.serverURLOverride) ?? ""

    var app: AppState! = nil

    func clearError() { error = nil }
    func clearNotice() { notice = nil }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let settings = try await app.settingsService.fetch()
            if let lang = settings["language"]?.stringValue { language = lang }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func setLanguage(_ code: String) async {
        do {
            try await app.settingsService.patch(section: "language", value: code)
            language = code
            await app.profileViewModel.reload()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func loadSessions() async {
        do {
            let (current, others) = try await app.authService.sessions()
            currentSession = current
            sessions = (current.map { [$0] } ?? []) + others
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func terminateOthers() async {
        do {
            let removed = try await app.authService.terminateOtherSessions()
            notice = removed > 0 ? "Closed \(removed) session(s)." : "No other sessions."
            await loadSessions()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func deleteSession(_ id: String) async {
        do {
            try await app.authService.deleteSession(id)
            await loadSessions()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func setCloudPassword(_ password: String?) async -> Bool {
        do {
            _ = try await app.authService.setCloudPassword(password?.isEmpty == true ? nil : password)
            notice = password == nil ? "Cloud password disabled." : "Cloud password enabled."
            await app.profileViewModel.reload()
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func sendFeedback(category: String, message: String) async -> Bool {
        do {
            try await app.settingsService.sendFeedback(category: category, message: message)
            notice = "Thanks! Your feedback was sent."
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func loadStickerPacks() async {
        do {
            stickerPacks = try await app.settingsService.stickerPacks()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func applyServerURL() {
        let clean = serverURL.trimmingCharacters(in: .whitespaces)
        UserDefaults.standard.set(clean.isEmpty ? nil : clean, forKey: AppConfig.Keys.serverURLOverride)
        app.logout()
    }

    func logout() {
        app.logout()
    }
}
