import PhotosUI
import SwiftUI

/// Own profile: banner art, decorated avatar, emoji status, bio, birthday
/// and identity rows — all server-backed.
struct ProfileView: View {
    @Environment(AppState.self) private var app
    @State private var showEditor = false

    var body: some View {
        @Bindable var profile = app.profileViewModel
        Group {
            if let user = profile.user {
                ScrollView {
                    VStack(spacing: 0) {
                        ProfileStyle.banner(dataURL: user.banner.isEmpty ? nil : user.banner)

                        VStack(alignment: .leading, spacing: YoohTheme.Spacing.m) {
                            HStack(alignment: .bottom) {
                                ProfileStyle.decoratedAvatar(
                                    avatarURL: user.avatar.isEmpty ? nil : user.avatar,
                                    name: user.displayName,
                                    badge: user.premiumBadge,
                                    size: 96
                                )
                                .offset(y: -30)
                                .padding(.bottom, -30)
                                Spacer()
                                Button("Изменить профиль") { showEditor = true }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                            }

                            nameBlock(user)

                            if !user.about.isEmpty {
                                Text(user.about)
                                    .font(.subheadline)
                                    .padding(YoohTheme.Spacing.m)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(YoohTheme.TG.card, in: .rect(cornerRadius: 16))
                            }

                            infoCard(user)
                        }
                        .padding(.horizontal, YoohTheme.Spacing.l)
                        .padding(.bottom, YoohTheme.Spacing.xl)
                    }
                }
                .background(YoohTheme.TG.background)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Профиль")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            if let error = profile.error {
                ErrorBanner(message: error, onDismiss: { profile.clearError() })
            }
        }
        .sheet(isPresented: $showEditor) {
            NavigationStack {
                ProfileEditorView()
            }
        }
        .task {
            await profile.reload()
        }
    }

    private func nameBlock(_ user: YoohUser) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(user.displayName)
                    .font(.system(size: 24, weight: .bold))
                if !user.emojiStatus.isEmpty {
                    Text(user.emojiStatus)
                        .font(.title3)
                        .accessibilityLabel(Text("Статус"))
                }
                if user.isPremium {
                    Image(systemName: "star.fill")
                        .font(.caption)
                        .foregroundStyle(.yellow)
                        .accessibilityLabel(Text("Премиум"))
                }
            }
            Text("@\(user.username) · \(user.phone)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func infoCard(_ user: YoohUser) -> some View {
        VStack(spacing: 0) {
            infoRow(icon: "star.fill", color: .yellow, title: "Звёзды", value: "\(user.starsBalance)")
            Divider().opacity(0.4)
            if !user.birthday.isEmpty {
                infoRow(icon: "gift.fill", color: .pink, title: "День рождения", value: user.birthday)
                Divider().opacity(0.4)
            }
            infoRow(icon: user.cloudPasswordEnabled ? "lock.fill" : "lock.open.fill",
                    color: .green,
                    title: "Двухэтапная аутентификация",
                    value: user.cloudPasswordEnabled ? "Вкл" : "Выкл")
            Divider().opacity(0.4)
            infoRow(icon: "calendar", color: ThemeStore.shared.accent,
                    title: "В Yooh с",
                    value: YoohDates.fullDateTime(user.createdAt))
        }
        .padding(.horizontal, YoohTheme.Spacing.m)
        .padding(.vertical, YoohTheme.Spacing.s)
        .background(YoohTheme.TG.card, in: .rect(cornerRadius: 16))
    }

    private func infoRow(icon: String, color: Color, title: String, value: String) -> some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 24)
            Text(title).font(.subheadline)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
    }
}

private struct ProfileEditorView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var displayName = ""
    @State private var username = ""
    @State private var about = ""
    @State private var status = ""
    @State private var hasBirthday = false
    @State private var birthday = Date()
    @State private var badgeStyle = "none"
    @State private var star = "⭐"
    @State private var badgeColor = "#f4c84c"
    @State private var avatarItem: PhotosPickerItem?
    @State private var bannerItem: PhotosPickerItem?
    @State private var decorItem: PhotosPickerItem?
    @State private var avatarPreview: UIImage?
    @State private var bannerPreview: UIImage?
    @State private var decorPreview: UIImage?
    @State private var error: String?

    private static let birthdayFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()

    var body: some View {
        @Bindable var profile = app.profileViewModel
        Form {
            Section("Фото и баннер") {
                if let avatarPreview {
                    Image(uiImage: avatarPreview)
                        .resizable().scaledToFill()
                        .frame(width: 72, height: 72).clipShape(Circle())
                }
                ProfilePhotoPicker(item: $avatarItem, title: "Сменить аватар", symbol: "person.crop.circle")
                if let bannerPreview {
                    Image(uiImage: bannerPreview)
                        .resizable().scaledToFill()
                        .frame(height: 90).clipShape(.rect(cornerRadius: 12))
                }
                ProfilePhotoPicker(item: $bannerItem, title: "Сменить баннер", symbol: "photo")
            }
            Section("Основное") {
                TextField("Имя", text: $displayName)
                TextField("username", text: $username)

                TextField("О себе", text: $about, axis: .vertical)
                Toggle("День рождения", isOn: $hasBirthday)
                if hasBirthday {
                    DatePicker("Дата рождения", selection: $birthday, displayedComponents: .date)
                }
            }
            Section("Эмодзи-статус") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))]) {
                    ForEach(ProfileStyle.statusPresets, id: \.self) { e in
                        Button {
                            Haptics.selection()
                            status = e
                        } label: {
                            Text(e.isEmpty ? "✕" : e)
                                .font(.title2)
                                .frame(width: 44, height: 44)
                                .background(status == e ? ThemeStore.shared.accent.opacity(0.25) : Color.clear,
                                            in: .circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(e.isEmpty ? "Убрать статус" : "Статус \(e)"))
                    }
                }
            }
            Section("Украшение аватара") {
                Picker("Стиль", selection: $badgeStyle) {
                    Text("Нет").tag("none")
                    Text("Звезда").tag("star")
                    Text("Фоторамка").tag("photo")
                }
                .pickerStyle(.segmented)
                if badgeStyle == "star" {
                    TextField("Эмодзи звезды", text: $star)
                }
                if badgeStyle == "photo" {
                    if let decorPreview {
                        Image(uiImage: decorPreview)
                            .resizable().scaledToFill()
                            .frame(width: 72, height: 72).clipShape(Circle())
                    }
                    ProfilePhotoPicker(item: $decorItem, title: "Картинка украшения", symbol: "sparkles")
                }
                if badgeStyle != "none" {
                    HStack {
                        ForEach(ProfileStyle.colorPresets, id: \.self) { hex in
                            Button {
                                badgeColor = hex
                            } label: {
                                Circle()
                                    .fill(Color(hex: hex))
                                    .frame(width: 30, height: 30)
                                    .overlay {
                                        if badgeColor == hex {
                                            Circle().stroke(Color.white, lineWidth: 2)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("Цвет \(hex)"))
                        }
                    }
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            AsyncButton(title: "Сохранить", isBusy: profile.isSaving) {
                await save(profile)
            }
        }
        .navigationTitle("Изменить профиль")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Отмена") { dismiss() }
            }
        }
        .onAppear(perform: prefill)
        .onChange(of: avatarItem) { _, v in loadImage(v, into: $avatarPreview) }
        .onChange(of: bannerItem) { _, v in loadImage(v, into: $bannerPreview) }
        .onChange(of: decorItem) { _, v in loadImage(v, into: $decorPreview) }
    }

    private func prefill() {
        guard let u = app.session.currentUser else { return }
        displayName = u.displayName
        username = u.username
        about = u.about
        status = u.emojiStatus
        if u.birthday.count == 10, let date = Self.birthdayFormat.date(from: u.birthday) {
            hasBirthday = true
            birthday = date
        } else {
            hasBirthday = false
        }
        if let b = u.premiumBadge {
            badgeStyle = (b.type == "star" || b.type == "photo") ? (b.type ?? "none") : "none"
            if let s = b.star, !s.isEmpty { star = s }
            if let c = b.bgColor, !c.isEmpty { badgeColor = c }
        }
        error = nil
    }

    private func loadImage(_ item: PhotosPickerItem?, into binding: Binding<UIImage?>) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self),
               let img = UIImage(data: data)
            {
                binding.wrappedValue = img
            }
        }
    }

    private func save(_ profile: ProfileViewModel) async {
        error = nil
        guard Validation.validateDisplayName(displayName) else { error = "Введите ваше имя."; return }
        guard Validation.validateUsername(username) else { error = "Username: 5–32 letters, digits or _."; return }
        let cleanUsername = username.trimmingCharacters(in: .whitespaces).lowercased()
        if cleanUsername != app.session.currentUser?.username.lowercased() {
            do {
                let verdict = try await app.userService.usernameAvailability(cleanUsername)
                guard verdict.available || verdict.isCurrent else {
                    error = "Этот username уже занят."
                    return
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                return
            }
        }
        var fields: [String: Any] = [
            "displayName": displayName.trimmingCharacters(in: .whitespaces),
            "username": cleanUsername,
            "about": about,
            "emojiStatus": status,
            "birthday": hasBirthday ? Self.birthdayFormat.string(from: birthday) : "",
        ]
        if let img = avatarPreview, let url = ProfileViewModel.avatarDataURL(img) {
            fields["avatar"] = url
        }
        if let img = bannerPreview, let url = ProfileViewModel.bannerDataURL(img) {
            fields["banner"] = url
        }
        switch badgeStyle {
        case "star":
            fields["premiumBadge"] = ["type": "star", "star": star.isEmpty ? "⭐" : star,
                                      "photo": "", "svg": "", "bgColor": badgeColor,
                                      "size": 16, "offsetX": 0, "offsetY": 0] as [String: Any]
        case "photo":
            if let img = decorPreview, let url = ProfileViewModel.avatarDataURL(img) {
                fields["premiumBadge"] = ["type": "photo", "star": "", "photo": url,
                                          "svg": "", "bgColor": badgeColor,
                                          "size": 16, "offsetX": 0, "offsetY": 0] as [String: Any]
            } else {
                error = "Выберите картинку украшения или другой стиль."
                return
            }
        default:
            fields["premiumBadge"] = ["type": "none", "star": "", "photo": "",
                                      "svg": "", "bgColor": badgeColor,
                                      "size": 16, "offsetX": 0, "offsetY": 0] as [String: Any]
        }
        if await profile.saveFields(fields) {
            dismiss()
        } else {
            error = profile.error
        }
    }
}
