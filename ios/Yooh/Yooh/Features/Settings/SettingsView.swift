import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showLogoutConfirm = false
    @State private var showAddAccountConfirm = false
    @State private var showQR = false
    @State private var showDeleteAccount = false
    @State private var cloudPassword = ""
    @State private var feedbackCategory = "improvement"
    @State private var feedbackText = ""
    @State private var openSavedChat: YoohChat?

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        NavigationStack {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: YoohTheme.Spacing.m) {
                        hero
                        quickActionsCard
                        accountCard
                        profileCard
                        libraryCard(settings)
                        prefsCard
                        starsCard
                        helpCard
                        feedbackCard(settings)
                        securityCard(settings)
                        adminCard
                        serverCard(url: $settings.serverURL, onApply: { settings.applyServerURL() })
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
            .confirmationDialog("Добавить аккаунт? Текущая сессия завершится, и откроется вход.",
                                isPresented: $showAddAccountConfirm, titleVisibility: .visible) {
                Button("Продолжить", role: .destructive) { settings.logout() }
                Button("Отмена", role: .cancel) {}
            }
            .sheet(isPresented: $showQR) {
                ShowQRView()
            }
            .sheet(isPresented: $showDeleteAccount) {
                DeleteAccountView()
            }
            .navigationDestination(item: $openSavedChat) { chat in
                ChatDetailView(chat: chat, app: app)
            }
        }
    }

    /// Telegram-style profile hero: banner backdrop, avatar, name,
    /// phone · username, QR shortcut and Edit.
    private var hero: some View {
        ZStack(alignment: .top) {
            heroBackdrop
            VStack(spacing: 0) {
                HStack {
                    Button { showQR = true } label: {
                        Image(systemName: "qrcode")
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 46, height: 46)
                            .background(Color.black.opacity(0.35), in: .circle)
                    }
                    .accessibilityLabel(Text("QR-код"))
                    Spacer()
                    NavigationLink {
                        ProfileView()
                    } label: {
                        Text("Изм.")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.35), in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Изменить профиль"))
                }
                .padding(.horizontal, YoohTheme.Spacing.l)
                .padding(.top, YoohTheme.Spacing.s)
                if let user = app.session.currentUser {
                    AvatarView(dataURL: user.avatar, name: user.displayName, size: 110)
                        .padding(.top, 54)
                    HStack(spacing: 4) {
                        Text(user.displayName)
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(.white)
                        if user.isPremium {
                            Image(systemName: "star.fill")
                                .font(.caption)
                                .foregroundStyle(.yellow)
                        }
                        if !user.emojiStatus.isEmpty {
                            Text(user.emojiStatus)
                                .font(.title3)
                        }
                    }
                    .padding(.top, 8)
                    Text("\(user.phone) · @\(user.username)")
                        .font(.system(size: 15))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.bottom, 20)
                }
            }
        }
        .clipShape(.rect(cornerRadius: 24))
    }

    private var heroBackdrop: some View {
        ZStack {
            if let banner = app.session.currentUser?.banner, !banner.isEmpty,
               let data = MediaService.data(fromDataURL: banner),
               let img = UIImage(data: data)
            {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(
                    colors: [ThemeStore.shared.accent, ThemeStore.shared.accent.opacity(0.55)],
                    startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 250, maxHeight: 250)
        .clipped()
        .overlay {
            LinearGradient(colors: [.clear, Color.black.opacity(0.25)],
                           startPoint: .top, endPoint: .bottom)
        }
    }

    private var quickActionsCard: some View {
        card {
            NavigationLink {
                ProfileView()
            } label: {
                plainRow(symbol: "face.smiling", title: "Сменить эмодзи-статус")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                ProfileView()
            } label: {
                plainRow(symbol: "camera.fill", title: "Сменить фото профиля")
            }
            .buttonStyle(.plain)
        }
    }

    private var accountCard: some View {
        card {
            if let user = app.session.currentUser {
                HStack(spacing: YoohTheme.Spacing.m) {
                    AvatarView(dataURL: user.avatar, name: user.displayName, size: 44)
                    Text(user.displayName)
                        .font(.system(size: 17))
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(ThemeStore.shared.accent)
                }
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("Текущий аккаунт"))
                Divider().opacity(0.4)
            }
            Button {
                showAddAccountConfirm = true
            } label: {
                HStack(spacing: YoohTheme.Spacing.m) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(.secondary)
                        .frame(width: 44)
                    Text("Добавить аккаунт")
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                    Spacer()
                }
                .padding(.vertical, 8)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Добавить аккаунт"))
        }
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

    private var libraryCard: some View {
        card {
            Button { openSaved() } label: {
                settingRow(tile: "bookmark.fill", color: .blue, title: "Избранное")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            Button {
                NotificationCenter.default.post(
                    name: MainTabView.switchTabNotification,
                    object: nil, userInfo: ["tab": "calls"])
            } label: {
                settingRow(tile: "phone.fill", color: .green, title: "Недавние звонки")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                DevicesView()
            } label: {
                let n = app.settingsViewModel.sessions.count
                settingRow(tile: "laptopcomputer", color: .orange,
                           title: "Устройства", value: n > 0 ? "\(n)" : nil)
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                FolderEditorView()
            } label: {
                settingRow(tile: "folder.fill", color: .teal, title: "Папки чатов")
            }
            .buttonStyle(.plain)
        }
    }

    private var prefsCard: some View {
        card {
            NavigationLink {
                NotificationsView()
            } label: {
                settingRow(tile: "bell.badge.fill", color: .red, title: "Уведомления и звуки")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                PrivacyView()
            } label: {
                settingRow(tile: "lock.shield.fill", color: .gray, title: "Конфиденциальность")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                StorageView()
            } label: {
                settingRow(tile: "internaldrive.fill", color: .green, title: "Данные и память")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                AppearanceView()
            } label: {
                settingRow(tile: "paintpalette.fill", color: .purple, title: "Оформление")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                LanguageView()
            } label: {
                settingRow(tile: "globe", color: .blue, title: "Язык",
                           value: app.settingsViewModel.language == "ru" ? "Русский" : "English")
            }
            .buttonStyle(.plain)
        }
    }

    private var starsCard: some View {
        card {
            NavigationLink {
                StarsView()
            } label: {
                settingRow(tile: "star.fill", color: .yellow,
                           title: "Мои звёзды",
                           value: "\(app.session.currentUser?.starsBalance ?? 0) ⭐")
            }
            .buttonStyle(.plain)
            Divider().opacity(0.4)
            NavigationLink {
                StickerPacksView()
            } label: {
                settingRow(tile: "face.smiling.fill", color: .orange, title: "Стикеры")
            }
            .buttonStyle(.plain)
        }
    }

    private func plainRow(symbol: String, title: String) -> some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(.secondary)
                .frame(width: 28)
            Text(title)
                .font(.system(size: 17))
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(.tertiaryLabel))
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(title))
    }

    private func openSaved() {
        guard let me = app.session.currentUser?.id else { return }
        if let chat = app.chatsViewModel.chats.first(where: {
            $0.type == .direct && $0.peer(myUserId: me) == nil
        }) {
            openSavedChat = chat
        } else {
            app.chatsViewModel.showError("Откройте Избранное во вкладке Чаты.")
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
            NavigationLink {
                AboutView()
            } label: {
                settingRow(tile: "info.circle.fill", color: .gray, title: "О приложении")
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
