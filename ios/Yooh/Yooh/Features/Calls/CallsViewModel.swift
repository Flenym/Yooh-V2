import Foundation
import Observation

@Observable
@MainActor
final class CallsViewModel {
    enum Filter { case all, missed }

    var filter: Filter = .all
    private(set) var calls: [CallLog] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var notice: String?

    var app: AppState! = nil

    var visible: [CallLog] {
        filter == .all ? calls : calls.filter(\.isMissed)
    }

    func refresh() async {
        guard app.session.isAuthenticated else { return }
        guard !UITestPreview.isActive else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            calls = try await app.callService.history()
        } catch {
            if !((error as? APIError)?.isAuthExpired ?? false) {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func delete(_ call: CallLog) async {
        do {
            try await app.callService.delete(call.id)
            calls.removeAll { $0.id == call.id }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func unavailableNotice() {
        notice = "Голосовые и видеозвонки появятся в следующем релизе — история и входящие уже работают."
        Haptics.error()
    }

    func clearError() { error = nil }
    func clearNotice() { notice = nil }

#if DEBUG
    /// Visual-QA seeding (simulator screenshots, no backend).
    func seedPreviewCalls(_ items: [CallLog]) {
        calls = items
        isLoading = false
        error = nil
    }
#endif
}
