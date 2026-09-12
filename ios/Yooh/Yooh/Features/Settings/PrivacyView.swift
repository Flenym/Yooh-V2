import SwiftUI

struct PrivacyView: View {
    @Environment(AppState.self) private var app

    @State private var lastSeen: Audience = .everyone
    @State private var profilePhoto: Audience = .everyone
    @State private var calls: Audience = .contacts
    @State private var forwards: Audience = .contacts
    @State private var directMessages: Audience = .everyone
    @State private var readReceipts = true
    @State private var error: String?

    var body: some View {
        List {
            Section("Visibility") {
                AudienceRow(title: "Last seen & online",
                            subtitle: "Approximate values are shown instead of exact time",
                            selection: $lastSeen)
                {
                    save(["lastSeen": $0.wire])
                }
                AudienceRow(title: "Profile photo",
                            subtitle: nil,
                            selection: $profilePhoto)
                {
                    save(["profilePhoto": $0.wire])
                }
                AudienceRow(title: "Who can call me",
                            subtitle: nil,
                            selection: $calls)
                {
                    save(["calls": $0.wire])
                }
                AudienceRow(title: "Forwarded messages",
                            subtitle: "Who can link back to your account",
                            selection: $forwards)
                {
                    save(["forwards": $0.wire])
                }
                AudienceRow(title: "Who can message me",
                            subtitle: "Strangers send requests instead",
                            selection: $directMessages)
                {
                    saveDirectMessages($0)
                }
            }
            Section("Messages") {
                SettingToggleRow(title: "Read receipts",
                                 subtitle: "If off, you won't see theirs either",
                                 isOn: $readReceipts)
                {
                    save(["readReceipts": $0])
                }
            }
            Section("App lock") {
                SettingToggleRow(title: "Lock with \(AppLockStore.shared.biometryName)",
                                 subtitle: "Require authentication on launch and return",
                                 isOn: Binding(
                                     get: { AppLockStore.shared.isEnabled },
                                     set: { v in
                                         AppLockStore.shared.isEnabled = v
                                         if v { AppLockStore.shared.lock() }
                                         Haptics.selection()
                                     }
                                 )) { _ in }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .navigationTitle("Privacy")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            let remote = try await app.settingsService.fetch()
            var s: [String: AnyCodable] = [:]
            if case .object(let o) = remote["privacy"] { s = o }
            lastSeen = Audience.from(SettingsReader.string("lastSeen", in: s, default: "everyone"))
            profilePhoto = Audience.from(SettingsReader.string("profilePhoto", in: s, default: "everyone"))
            calls = Audience.from(SettingsReader.string("calls", in: s, default: "contacts"))
            forwards = Audience.from(SettingsReader.string("forwards", in: s, default: "everyone"))
            directMessages = Audience.from(SettingsReader.string("messages", in: s, default: "everyone"))
            readReceipts = SettingsReader.bool("readReceipts", in: s, default: true)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func save(_ patch: [String: Any]) {
        Task {
            do {
                try await app.settingsService.patch(section: "privacy", value: patch)
                await app.profileViewModel.reload()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func saveDirectMessages(_ a: Audience) {
        directMessages = a
        save(["messages": a.wire])
    }
}
