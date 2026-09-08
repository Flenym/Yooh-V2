import SwiftUI

/// Settings: language, sessions, cloud password, stickers, feedback,
/// support, backend URL override, about, logout.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showLogoutConfirm = false
    @State private var cloudPassword = ""
    @State private var feedbackCategory = "improvement"
    @State private var feedbackText = ""

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        NavigationStack {
            List {
                profileHeader
                generalSection(settings)
                sessionsSection(settings)
                securitySection(settings)
                stickersSection(settings)
                feedbackSection(settings)
                serverSection(url: $settings.serverURL, onApply: { settings.applyServerURL() })
                aboutSection
                logoutSection
            }
            .navigationTitle("Settings")
            .task {
                await settings.load()
                await settings.loadSessions()
            }
            .overlay(alignment: .top) {
                VStack(spacing: YoohTheme.Spacing.s) {
                    if let error = settings.error {
                        ErrorBanner(message: error, onDismiss: { settings.clearError() })
                    }
                    if let notice = settings.notice {
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(.green)
                            .padding(YoohTheme.Spacing.s)
                            .background(Color(.secondarySystemBackground),
                                        in: .rect(cornerRadius: YoohTheme.Radius.m))
                            .padding(.horizontal, YoohTheme.Spacing.l)
                    }
                }
            }
            .confirmationDialog("Log out?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
                Button("Log out", role: .destructive) { settings.logout() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    // MARK: - Sections

    private var profileHeader: some View {
        Section {
            NavigationLink {
                ProfileView()
            } label: {
                if let user = app.session.currentUser {
                    HStack(spacing: YoohTheme.Spacing.m) {
                        AvatarView(dataURL: user.avatar, name: user.displayName,
                                   size: YoohTheme.Layout.avatarL)
                        VStack(alignment: .leading) {
                            Text(user.displayName).font(.headline)
                            Text("@\(user.username)").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, YoohTheme.Spacing.xs)
                }
            }
        }
    }

    private func generalSection(_ settings: SettingsViewModel) -> some View {
        Section("General") {
            Picker("Language", selection: Binding(
                get: { settings.language },
                set: { code in Task { await settings.setLanguage(code) } }
            )) {
                Text("English").tag("en")
                Text("Русский").tag("ru")
            }
        }
    }

    private func sessionsSection(_ settings: SettingsViewModel) -> some View {
        Section("Active sessions") {
            ForEach(settings.sessions, id: \.id) { s in
                HStack {
                    Image(systemName: icon(for: s.platform))
                        .foregroundStyle(.secondary)
                        .frame(width: 28)
                    VStack(alignment: .leading) {
                        Text(s.name ?? s.client ?? "Session").font(.subheadline)
                        if let seen = s.lastSeenAt {
                            Text(YoohDates.fullDateTime(seen)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if s.isCurrent == true {
                        Text("This device").font(.caption).foregroundStyle(Color.accentColor)
                    } else {
                        Button {
                            Task { await settings.deleteSession(s.id) }
                        } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(Text("Terminate session"))
                    }
                }
            }
            Button("Terminate other sessions") {
                Task { await settings.terminateOthers() }
            }
        }
    }

    private func icon(for platform: String?) -> String {
        switch platform {
        case "iphone": return "iphone"
        case "android": return "smartphone"
        default: return "desktopcomputer"
        }
    }

    private func securitySection(_ settings: SettingsViewModel) -> some View {
        Section("Two-step verification") {
            if app.session.currentUser?.cloudPasswordEnabled == true {
                Text("Cloud password is enabled.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Disable", role: .destructive) {
                    Task { _ = await settings.setCloudPassword(nil) }
                }
            } else {
                SecureField("New cloud password (min 4 chars)", text: $cloudPassword)
                Button("Enable") {
                    Task {
                        if await settings.setCloudPassword(cloudPassword) { cloudPassword = "" }
                    }
                }
                .disabled(cloudPassword.count < 4)
            }
        }
    }

    private func stickersSection(_ settings: SettingsViewModel) -> some View {
        Section("Stickers") {
            NavigationLink {
                StickerPacksView()
            } label: {
                Label("Sticker packs", systemImage: "face.smiling")
            }
        }
    }

    private func feedbackSection(_ settings: SettingsViewModel) -> some View {
        Section("Help & feedback") {
            Picker("Category", selection: $feedbackCategory) {
                Text("Bug").tag("bug")
                Text("Improvement").tag("improvement")
                Text("Wish").tag("wish")
            }
            TextField("Describe the issue or idea…", text: $feedbackText, axis: .vertical)
                .lineLimit(2...5)
            AsyncButton(title: "Send feedback", isBusy: false) {
                guard !feedbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                if await settings.sendFeedback(category: feedbackCategory, message: feedbackText) {
                    feedbackText = ""
                }
            }
        }
    }

    private func serverSection(url: Binding<String>, onApply: @escaping () -> Void) -> some View {
        Section("Backend") {
            TextField("Server URL (empty = local default)", text: url)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
            Text("Applies on next login. Changing the server logs you out (sessions live server-side).")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Apply server URL", action: onApply)
        }
    }

    private var aboutSection: some View {
        Section("About") {
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
            LabeledContent("Yooh for iOS", value: version)
            LabeledContent("Backend", value: "Yooh server API + Socket.IO")
        }
    }

    private var logoutSection: some View {
        Section {
            Button(role: .destructive) {
                showLogoutConfirm = true
            } label: {
                Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        }
    }
}

/// Installed sticker packs (view-only in v1; creation stays in web/admin).
private struct StickerPacksView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        List(settings.stickerPacks, id: \.id) { pack in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(pack.coverEmoji ?? "🙂").font(.title2)
                    Text(pack.title ?? "Pack").font(.headline)
                    Spacer()
                    Text("\(pack.stickers?.count ?? 0)").font(.caption).foregroundStyle(.secondary)
                }
                if let desc = pack.description, !desc.isEmpty {
                    Text(desc).font(.caption).foregroundStyle(.secondary)
                }
                if let stickers = pack.stickers, !stickers.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(stickers.prefix(12)) { s in
                                Text(s.emoji ?? "")
                                    .font(.title)
                            }
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .navigationTitle("Stickers")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await settings.loadStickerPacks()
        }
        .overlay {
            if settings.stickerPacks.isEmpty {
                EmptyStateView(symbol: "face.smiling", title: "No sticker packs",
                               subtitle: "Packs created on web will appear here.")
            }
        }
    }
}
