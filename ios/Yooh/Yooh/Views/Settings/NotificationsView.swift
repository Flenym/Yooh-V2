import SwiftUI

/// Notification preferences, persisted server-side (PATCH settings →
/// `notifications`, deep-merged by the backend like the web client).
struct NotificationsView: View {
    @Environment(AppState.self) private var app

    @State private var privateChats = true
    @State private var groups = true
    @State private var channels = true
    @State private var preview = true
    @State private var sounds = true
    @State private var vibration = true
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        List {
            Section("Show notifications for") {
                SettingToggleRow(title: "Private chats", subtitle: nil, isOn: $privateChats) {
                    save(["privateChats": $0])
                }
                SettingToggleRow(title: "Groups", subtitle: nil, isOn: $groups) {
                    save(["groups": $0])
                }
                SettingToggleRow(title: "Channels", subtitle: nil, isOn: $channels) {
                    save(["channels": $0])
                }
            }
            Section("Message content") {
                SettingToggleRow(title: "Message preview", subtitle: "Show text in alerts", isOn: $preview) {
                    save(["messagePreview": $0])
                }
                SettingToggleRow(title: "Sounds", subtitle: nil, isOn: $sounds) {
                    save(["sounds": $0])
                }
                SettingToggleRow(title: "Vibration", subtitle: nil, isOn: $vibration) {
                    save(["vibration": $0])
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            let remote = try await app.settingsService.fetch()
            let s = remote["notifications"]?.objectValue ?? [:]
            privateChats = SettingsReader.bool("privateChats", in: s, default: true)
            groups = SettingsReader.bool("groups", in: s, default: true)
            channels = SettingsReader.bool("channels", in: s, default: true)
            preview = SettingsReader.bool("messagePreview", in: s, default: true)
            sounds = SettingsReader.bool("sounds", in: s, default: true)
            vibration = SettingsReader.bool("vibration", in: s, default: true)
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func save(_ patch: [String: Any]) {
        Task {
            do {
                try await app.settingsService.patch(section: "notifications", value: patch)
                await app.profileViewModel.reload()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

private extension AnyCodable {
    var objectValue: [String: AnyCodable]? {
        if case .object(let o) = self { return o }
        return nil
    }
}
