import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showLogoutConfirm = false
    @State private var showLinkDevice = false
    @State private var showQR = false
    @State private var showDeleteAccount = false
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
                        appearanceCard
                        notificationsCard
                        privacyCard
                        storageCard
                        sessionsCard(settings)
                        securityCard(settings)
                        stickersCard
                        feedbackCard(settings)
                        helpCard
                        adminCard
                        serverCard(url: $settings.serverURL, onApply: { settings.applyServerURL() })
                        aboutCard
                        logoutCard
                    }
                    .padding(.horizontal, YoohTheme.Spacing.l)
                    .padding(.top, YoohTheme.Spacing.s)
                    .padding(.bottom, 100)
                }
            }
            .navigationTitle("Настройки")
            .navigationBarTitleDisplayMode(.large)
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
                        NoticeBanner(message: notice, onDismiss: { settings.clearNotice() })
                    }
                }
            }
            .confirmationDialog("Выйти из аккаунта?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { settings.logout() }
                Button("Отмена", role: .cancel) {}
            }
            .sheet(isPresented: $showLinkDevice) {
                NavigationStack {
                    LinkDeviceView()
                }
            }
            .sheet(isPresented: $showQR) {
                ShowQRView()
            }
            .sheet(isPresented: $showDeleteAccount) {
                DeleteAccountView()
            }
        }
    }

    private var hero: some View {
        VStack(spacing: YoohTheme.Spacing.s) {
            if let user = app.session.currentUser {
                AvatarView(dataURL: user.avatar, name: user.displayName, size: 110)
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
                settingRow(tile: "person.crop.circle.fill", color: .red, title: "Мой профиль")
            }
            .buttonStyle(.plain)
        }
    }

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
                Text("Язык")
                    .font(.system(size: 17))
                Spacer()
                Picker("Язык", selection: Binding(
                    get: { settings.language },
                    set: { code in Task { await settings.setLanguage(code) } }
                )) {
                    Text("Английский").tag("en")
                    Text("Русский").tag("ru")
                }
                .pickerStyle(.segmented)
                .frame(width: 120)
            }
            .padding(.vertical, 8)
        }
    }

    private var appearanceCard: some View {
        card {
            NavigationLink {
                AppearanceView()
            } label: {
                settingRow(tile: "paintpalette.fill", color: .purple, title: "Оформление")
            }
            .buttonStyle(.plain)
        }
    }

    private var notificationsCard: some View {
        card {
            NavigationLink {
                NotificationsView()
            } label: {
                settingRow(tile: "bell.badge.fill", color: .red, title: "Уведомления и звуки")
            }
            .buttonStyle(.plain)
        }
    }

    private var privacyCard: some View {
        card {
            NavigationLink {
                PrivacyView()
            } label: {
                settingRow(tile: "lock.shield.fill", color: .gray, title: "Конфиденциальность")
            }
            .buttonStyle(.plain)
        }
    }

    private var storageCard: some View {
        card {
            NavigationLink {
                StorageView()
            } label: {
                settingRow(tile: "internaldrive.fill", color: .green, title: "Данные и память")
            }
            .buttonStyle(.plain)
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
                        Text(s.name ?? s.client ?? "Сессия").font(.subheadline)
                        Text(YoohDates.relative(s.lastSeenAt)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if s.isCurrent == true {
                        Text("Это устройство").font(.caption).foregroundStyle(ThemeStore.shared.accent)
                    } else {
                        Button {
                            Task { await settings.deleteSession(s.id) }
                        } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(Text("Завершить сессию"))
                    }
                }
                .padding(.vertical, 6)
                Divider().background(Color(.separator).opacity(0.4))
            }
            Button("Завершить другие сессии") {
                Task { await settings.terminateOthers() }
            }
            .font(.system(size: 17))
            .foregroundStyle(ThemeStore.shared.accent)
            .padding(.vertical, 8)
            Button("Привязать устройство") {
                showLinkDevice = true
            }
            .font(.system(size: 17))
            .foregroundStyle(ThemeStore.shared.accent)
            .padding(.vertical, 4)
            Button("Показать код для нового устройства") {
                showQR = true
            }
            .font(.system(size: 17))
            .foregroundStyle(ThemeStore.shared.accent)
            .padding(.vertical, 4)
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
                Text("Двухэтапная аутентификация включена.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
                Button("Отключить", role: .destructive) {
                    Task { _ = await settings.setCloudPassword(nil) }
                }
                .padding(.vertical, 4)
            } else {
                SecureField("Новый облачный пароль (мин. 4 символа)", text: $cloudPassword)
                    .padding(.vertical, 8)
                Button("Включить двухэтапную аутентификацию") {
                    Task {
                        if await settings.setCloudPassword(cloudPassword) { cloudPassword = "" }
                    }
                }
                .disabled(cloudPassword.count < 4)
                .font(.system(size: 17))
                .foregroundStyle(ThemeStore.shared.accent)
                .padding(.bottom, 4)
            }
        }
    }

    private var stickersCard: some View {
        card {
            NavigationLink {
                StickerPacksView()
            } label: {
                settingRow(tile: "face.smiling.fill", color: .orange, title: "Стикеры")
            }
            .buttonStyle(.plain)
        }
    }

    private func feedbackCard(_ settings: SettingsViewModel) -> some View {
        card {
            Picker("Категория", selection: $feedbackCategory) {
                Text("Ошибка").tag("bug")
                Text("Улучшение").tag("improvement")
                Text("Пожелание").tag("wish")
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 4)
            TextField("Опишите проблему или идею…", text: $feedbackText, axis: .vertical)
                .lineLimit(2...5)
                .padding(.vertical, 4)
            AsyncButton(title: "Отправить отзыв", isBusy: false) {
                guard !feedbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                if await settings.sendFeedback(category: feedbackCategory, message: feedbackText) {
                    feedbackText = ""
                }
            }
            .padding(.bottom, 4)
        }
    }

    private var helpCard: some View {
        card {
            NavigationLink {
                SupportView()
            } label: {
                settingRow(tile: "questionmark.circle.fill", color: .blue, title: "Поддержка")
            }
            .buttonStyle(.plain)
            NavigationLink {
                FAQView()
            } label: {
                settingRow(tile: "book.fill", color: .teal, title: "Вопросы и ответы")
            }
            .buttonStyle(.plain)
        }
    }

    private var adminCard: some View {
        card {
            NavigationLink {
                AdminView()
            } label: {
                settingRow(tile: "shield.lefthalf.fill", color: .gray, title: "Админ-панель")
            }
            .buttonStyle(.plain)
        }
    }

    private func serverCard(url: Binding<String>, onApply: @escaping () -> Void) -> some View {
        card {
            TextField("URL сервера (пусто = тестовый)", text: url)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(.vertical, 8)
            Text("Default: \(AppConfig.apiURLString). Changing the server logs you out.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            Button("Применить URL сервера", action: onApply)
                .font(.system(size: 17))
                .foregroundStyle(ThemeStore.shared.accent)
                .padding(.bottom, 4)
        }
    }

    private var aboutCard: some View {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        return card {
            LabeledContent("Yooh for iOS", value: version)
                .padding(.vertical, 4)
            LabeledContent("Сервер", value: "Yooh server API + Socket.IO")
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
                    Label("Выйти", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 17, weight: .semibold))
                    Spacer()
                }
                .padding(.vertical, 8)
            }
            Divider().opacity(0.4)
            Button(role: .destructive) {
                showDeleteAccount = true
            } label: {
                HStack {
                    Spacer()
                    Label("Удалить аккаунт", systemImage: "trash.fill")
                        .font(.system(size: 17, weight: .semibold))
                    Spacer()
                }
                .padding(.vertical, 8)
            }
        }
    }
}

private struct StickerPacksView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        List(settings.stickerPacks, id: \.id) { pack in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(pack.coverEmoji ?? "🙂").font(.title2)
                    Text(pack.title ?? "Пак").font(.headline)
                    Spacer()
                    Text("\(pack.stickers?.count ?? 0)").font(.caption).foregroundStyle(.secondary)
                    Button(pack.installed ?? true ? "Убрать" : "Взять") {
                        Task { await settings.toggleStickerPack(pack) }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(pack.installed ?? true ? .secondary : ThemeStore.shared.accent)
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text((pack.installed ?? true ? "Убрать пак " : "Взять пак ") + (pack.title ?? "")))
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
        .navigationTitle("Стикеры")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await settings.loadStickerPacks()
        }
        .overlay {
            if settings.stickerPacks.isEmpty {
                EmptyStateView(symbol: "face.smiling", title: "Нет стикерпаков",
                               subtitle: "Паки, созданные в веб-версии, появятся здесь.")
            }
        }
    }
}
