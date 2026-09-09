import SwiftUI

/// Settings in the reference style: identity hero (big avatar, name,
/// phone · username) and glass cards with colored tile icons.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showLogoutConfirm = false
    @State private var cloudPassword = ""
    @State private var feedbackCategory = "improvement"
    @State private var feedbackText = ""

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        NavigationStack {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: YoohTheme.Spacing.m) {
                        hero
                        profileCard
                        generalCard(settings)
                        sessionsCard(settings)
                        securityCard(settings)
                        stickersCard
                        feedbackCard(settings)
                        serverCard(url: $settings.serverURL, onApply: { settings.applyServerURL() })
                        aboutCard
                        logoutCard
                    }
                    .padding(.horizontal, YoohTheme.Spacing.l)
                    .padding(.top, YoohTheme.Spacing.s)
                    .padding(.bottom, 100)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
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

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: YoohTheme.Spacing.s) {
            if let user = app.session.currentUser {
                AvatarView(dataURL: user.avatar, name: user.displayName,
                           size: 110)
                HStack(spacing: 4) {
                    Text(user.displayName)
                        .font(.system(size: 26, weight: .bold))
                    if user.isPremium {
                        Image(systemName: "star.fill")
                            .font(.caption)
                            .foregroundStyle(.yellow)
                    }
                }
                Text("\(user.phone) · @\(user.username)")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, YoohTheme.Spacing.l)
    }

    private var profileCard: some View {
        card {
            NavigationLink {
                ProfileView()
            } label: {
                settingRow(tile: "person.crop.circle.fill", color: .red, title: "My Profile")
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Cards

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .padding(.horizontal, YoohTheme.Spacing.m)
        .padding(.vertical, YoohTheme.Spacing.s)
        .background(YoohTheme.TG.card, in: .rect(cornerRadius: 20))
    }

    private func settingRow(tile: String, color: Color, title: String, value: String? = nil) -> some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            Image(systemName: tile)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(color, in: .rect(cornerRadius: 7))
            Text(title)
                .font(.system(size: 17))
            Spacer()
            if let value {
                Text(value)
                    .font(.system(size: 17))
                    .foregroundStyle(.secondary)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(.tertiaryLabel))
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(title))
    }

    private func generalCard(_ settings: SettingsViewModel) -> some View {
        card {
            HStack(spacing: YoohTheme.Spacing.m) {
                Image(systemName: "globe")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.blue, in: .rect(cornerRadius: 7))
                Text("Language")
                    .font(.system(size: 17))
                Spacer()
                Picker("Language", selection: Binding(
                    get: { settings.language },
                    set: { code in Task { await settings.setLanguage(code) } }
                )) {
                    Text("EN").tag("en")
                    Text("RU").tag("ru")
                }
                .pickerStyle(.segmented)
                .frame(width: 120)
            }
            .padding(.vertical, 8)
        }
    }

    private func sessionsCard(_ settings: SettingsViewModel) -> some View {
        card {
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
                        Text("This device").font(.caption).foregroundStyle(YoohTheme.TG.badge)
                    } else {
                        Button {
                            Task { await settings.deleteSession(s.id) }
                        } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(Text("Terminate session"))
                    }
                }
                .padding(.vertical, 6)
                Divider().background(Color(.separator).opacity(0.4))
            }
            Button("Terminate other sessions") {
                Task { await settings.terminateOthers() }
            }
            .font(.system(size: 17))
            .foregroundStyle(YoohTheme.TG.badge)
            .padding(.vertical, 8)
        }
    }

    private func icon(for platform: String?) -> String {
        switch platform {
        case "iphone": return "iphone"
        case "android": return "smartphone"
        default: return "desktopcomputer"
        }
    }

    private func securityCard(_ settings: SettingsViewModel) -> some View {
        card {
            if app.session.currentUser?.cloudPasswordEnabled == true {
                Text("Two-step verification is on.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
                Button("Disable", role: .destructive) {
                    Task { _ = await settings.setCloudPassword(nil) }
                }
                .padding(.vertical, 4)
            } else {
                SecureField("Cloud password (min 4 chars)", text: $cloudPassword)
                    .padding(.vertical, 8)
                Button("Enable two-step verification") {
                    Task {
                        if await settings.setCloudPassword(cloudPassword) { cloudPassword = "" }
                    }
                }
                .disabled(cloudPassword.count < 4)
                .font(.system(size: 17))
                .foregroundStyle(YoohTheme.TG.badge)
                .padding(.bottom, 4)
            }
        }
    }

    private var stickersCard: some View {
        card {
            NavigationLink {
                StickerPacksView()
            } label: {
                settingRow(tile: "face.smiling.fill", color: .orange, title: "Stickers")
            }
            .buttonStyle(.plain)
        }
    }

    private func feedbackCard(_ settings: SettingsViewModel) -> some View {
        card {
            Picker("Category", selection: $feedbackCategory) {
                Text("Bug").tag("bug")
                Text("Improvement").tag("improvement")
                Text("Wish").tag("wish")
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 4)
            TextField("Describe the issue or idea…", text: $feedbackText, axis: .vertical)
                .lineLimit(2...5)
                .padding(.vertical, 4)
            AsyncButton(title: "Send feedback", isBusy: false) {
                guard !feedbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                if await settings.sendFeedback(category: feedbackCategory, message: feedbackText) {
                    feedbackText = ""
                }
            }
            .padding(.bottom, 4)
        }
    }

    private func serverCard(url: Binding<String>, onApply: @escaping () -> Void) -> some View {
        card {
            TextField("Server URL (empty = test server)", text: url)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(.vertical, 8)
            Text("Default: \(AppConfig.apiURLString). Changing the server logs you out.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            Button("Apply server URL", action: onApply)
                .font(.system(size: 17))
            .foregroundStyle(YoohTheme.TG.badge)
            .padding(.bottom, 4)
        }
    }

    private var aboutCard: some View {
        card {
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
            LabeledContent("Yooh for iOS", value: version)
                .padding(.vertical, 4)
            LabeledContent("Backend", value: "Yooh server API + Socket.IO")
                .padding(.vertical, 4)
        }
    }

    private var logoutCard: some View {
        card {
            Button(role: .destructive) {
                showLogoutConfirm = true
            } label: {
                HStack {
                    Spacer()
                    Text("Log out").font(.system(size: 17, weight: .semibold))
                    Spacer()
                }
                .padding(.vertical, 8)
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
