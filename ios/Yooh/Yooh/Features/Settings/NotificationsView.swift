import SwiftUI

struct NotificationsView: View {
    @Environment(AppState.self) private var app

    @State private var privateChats = true
    @State private var groups = true
    @State private var channels = true
    @State private var preview = true
    @State private var sounds = true
    @State private var vibration = true
    @State private var error: String?

    var body: some View {
        List {
            Section("Показывать уведомления") {
                SettingToggleRow(title: "Личные чаты", subtitle: nil, isOn: $privateChats) {
                    save(["privateChats": $0])
                }
                SettingToggleRow(title: "Группы", subtitle: nil, isOn: $groups) {
                    save(["groups": $0])
                }
                SettingToggleRow(title: "Каналы", subtitle: nil, isOn: $channels) {
                    save(["channels": $0])
                }
            }
            Section("Содержимое сообщений") {
                SettingToggleRow(title: "Предпросмотр", subtitle: "Показывать текст в уведомлениях", isOn: $preview) {
                    save(["messagePreview": $0])
                }
                SettingToggleRow(title: "Звуки", subtitle: nil, isOn: $sounds) {
                    save(["sounds": $0])
                }
                SettingToggleRow(title: "Вибрация", subtitle: nil, isOn: $vibration) {
                    save(["vibration": $0])
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .navigationTitle("Уведомления")
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
