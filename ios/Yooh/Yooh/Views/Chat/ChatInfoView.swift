import PhotosUI
import SwiftUI

/// Group/channel/direct info: members, roles, invites, profile editing,
/// notification + pin toggles, clear history, leave/delete.
///
/// Permission model mirrors the server: `myRole` owner/admin/member;
/// role changes require owner; handle/public toggles owner/admin.
struct ChatInfoView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let chatId: String

    @State private var title = ""
    @State private var description = ""
    @State private var handle = ""
    @State private var error: String?
    @State private var notice: String?
    @State private var isSaving = false
    @State private var confirmDelete = false
    @State private var showAddMember = false
    @State private var sharedImages: [YoohMessage] = []
    @State private var avatarItem: PhotosPickerItem?

    private var chat: YoohChat? {
        app.chatsViewModel.chats.first(where: { $0.id == chatId })
    }

    var body: some View {
        Group {
            if let chat {
                Form {
                    headerSection(chat)
                    quickActions(chat)
                    if chat.type != .direct {
                        detailsSection(chat)
                        if chat.isChannel {
                            channelSection(chat)
                        } else {
                            groupSection(chat)
                        }
                        if let link = publicLink(chat) {
                            Section("Invite link") {
                                ShareLink(item: link) {
                                    Label(link.absoluteString, systemImage: "link")
                                        .lineLimit(1)
                                }
                            }
                        }
                        membersSection(chat)
                    } else {
                        directSection(chat)
                    }
                    sharedMedia(chat)
                    optionsSection(chat)
                    dangerSection(chat)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Info")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .onAppear {
            if let chat {
                title = chat.title ?? ""
                description = chat.description
                handle = chat.handle ?? ""
            }
        }
        .sheet(isPresented: $showAddMember) {
            NavigationStack {
                AddMemberView(chatId: chatId)
            }
        }
        .confirmationDialog("Delete this chat?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if let chat {
                        await app.chatsViewModel.deleteChat(chat)
                    }
                    dismiss()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: - Sections

    private func headerSection(_ chat: YoohChat) -> some View {
        Section {
            VStack(spacing: 8) {
                ProfileStyle.banner(dataURL: nil, height: 96)
                    .clipShape(.rect(cornerRadius: 14))
                    .overlay(alignment: .bottomLeading) {
                        AvatarView(dataURL: chat.avatar, name: chat.displayTitle, size: 68)
                            .padding(.leading, 12)
                            .offset(y: 18)
                    }
                    .padding(.bottom, 18)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(chat.displayTitle).font(.title3.bold())
                        Text(typeLabel(chat)).font(.caption).foregroundStyle(.secondary)
                        if let h = chat.handle, !h.isEmpty {
                            Text("@\(h)").font(.caption).foregroundStyle(ThemeStore.shared.accent)
                        }
                    }
                    Spacer()
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
    }

    private func typeLabel(_ chat: YoohChat) -> String {
        switch chat.type {
        case .direct: return "direct chat"
        case .group: return "\(chat.membersCount) members"
        case .channel: return "channel"
        case .server: return "server"
        case .unknown: return ""
        }
    }

    @ViewBuilder
    private func detailsSection(_ chat: YoohChat) -> some View {
        if canEdit(chat) {
            Section("Details") {
                TextField("Title", text: $title)
                TextField("Description", text: $description, axis: .vertical)
                if chat.type == .group {
                    TextField("Public handle (optional)", text: $handle)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                AsyncButton(title: "Save changes", isBusy: isSaving) {
                    await saveDetails(chat)
                }
            }
        } else if !chat.description.isEmpty {
            Section("About") {
                Text(chat.description)
            }
        }
    }

    private func membersSection(_ chat: YoohChat) -> some View {
        Section("Members (\(chat.membersCount))") {
            if canInvite(chat) {
                Button {
                    showAddMember = true
                } label: {
                    Label("Add member", systemImage: "person.badge.plus")
                }
            }
            if chat.members.isEmpty {
                Text("Member list is hidden by chat settings.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(chat.members, id: \.userId) { m in
                HStack {
                    AvatarView(dataURL: m.avatar, name: m.displayName ?? m.username ?? "?",
                               size: YoohTheme.Layout.avatarS)
                    VStack(alignment: .leading) {
                        HStack(spacing: 6) {
                            Text(m.displayName ?? (m.username.map { "@\($0)" } ?? "User"))
                                .font(.subheadline)
                            if m.isBot {
                                BotTag()
                            }
                        }
                        if let role = m.role {
                            Text(role.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if canManageRoles(chat), m.userId != app.session.currentUser?.id {
                        Menu {
                            Button("Make admin") { setRole(chat, member: m, role: "admin") }
                            Button("Make member") { setRole(chat, member: m, role: "member") }
                            Divider()
                            Button("Mute") { moderate(chat, member: m, kind: .mute) }
                            Button("Unmute") { moderate(chat, member: m, kind: .unmute) }
                            Button("Ban", role: .destructive) { moderate(chat, member: m, kind: .ban) }
                            Button("Unban") { moderate(chat, member: m, kind: .unban) }
                            Divider()
                            Button("Remove", role: .destructive) { removeMember(chat, member: m) }
                        } label: {
                            Image(systemName: "ellipsis")
                                .foregroundStyle(.secondary)
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(Text("Manage member"))
                    }
                }
            }
        }
    }

    private func directSection(_ chat: YoohChat) -> some View {
        Section {
            if let me = app.session.currentUser?.id,
               let peer = chat.peer(myUserId: me)
            {
                VStack(spacing: 8) {
                    ProfileStyle.banner(dataURL: nil, height: 110)
                        .clipShape(.rect(cornerRadius: 14))
                        .overlay(alignment: .bottomLeading) {
                            ProfileStyle.decoratedAvatar(
                                avatarURL: peer.avatar,
                                name: peer.displayName ?? "?",
                                badge: peer.premiumBadge,
                                size: 72
                            )
                            .padding(.leading, 12)
                            .offset(y: 20)
                        }
                        .padding(.bottom, 20)
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(peer.displayName ?? "User")
                                    .font(.title3.bold())
                                if peer.isPremium {
                                    Image(systemName: "star.fill")
                                        .font(.caption)
                                        .foregroundStyle(.yellow)
                                }
                            }
                            if let u = peer.username {
                                Text("@\(u)").font(.subheadline).foregroundStyle(Color.accentColor)
                            }
                            if let about = peer.about, !about.isEmpty {
                                Text(about).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func optionsSection(_ chat: YoohChat) -> some View {
        Section("Options") {
            Toggle("Pin chat", isOn: Binding(
                get: { app.chatsViewModel.isPinned(chat.id) },
                set: { _ in app.chatsViewModel.togglePin(chat.id) }))
            Toggle("Mute notifications", isOn: Binding(
                get: { app.chatsViewModel.isMuted(chat.id) },
                set: { _ in app.chatsViewModel.toggleMute(chat.id) }))
            Button {
                Task { await app.chatsViewModel.clearHistory(chat) }
            } label: {
                Label("Clear history", systemImage: "eraser")
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
    }

    private func dangerSection(_ chat: YoohChat) -> some View {
        Section {
            Button(role: .destructive) {
                if chat.type == .direct {
                    Task {
                        await app.chatsViewModel.deleteChat(chat)
                        dismiss()
                    }
                } else {
                    confirmDelete = true
                }
            } label: {
                Label(chat.type == .direct ? "Delete conversation" : "Delete and leave",
                      systemImage: "trash")
            }
        }
    }

    // MARK: - Quick actions (call / video / mute / more)

    private func quickActions(_ chat: YoohChat) -> some View {
        Section {
            HStack(spacing: YoohTheme.Spacing.s) {
                if chat.type == .direct {
                    quickCell(symbol: "phone.fill", title: "Call") {
                        app.callsViewModel.unavailableNotice()
                    }
                    quickCell(symbol: "video.fill", title: "Video") {
                        app.callsViewModel.unavailableNotice()
                    }
                }
                quickCell(symbol: app.chatsViewModel.isMuted(chat.id) ? "bell.slash.fill" : "bell.fill",
                          title: "Mute") {
                    app.chatsViewModel.toggleMute(chat.id)
                }
                Menu {
                    Button { Task { await app.chatsViewModel.clearHistory(chat) } } label: {
                        Label("Clear history", systemImage: "eraser")
                    }
                    Button(role: .destructive) {
                        Task {
                            await app.chatsViewModel.deleteChat(chat)
                            dismiss()
                        }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    quickCellLabel(symbol: "ellipsis", title: "More")
                }
                .accessibilityLabel(Text("More actions"))
            }
            .buttonStyle(.plain)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    private func quickCell(symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            quickCellLabel(symbol: symbol, title: title)
        }
        .accessibilityLabel(Text(title))
    }

    private func quickCellLabel(symbol: String, title: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 14))
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Shared media (recent image attachments)

    private func sharedMedia(_ chat: YoohChat) -> some View {
        Section("Shared media") {
            if sharedImages.isEmpty {
                Text("No photos yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 4) {
                    ForEach(sharedImages.prefix(30), id: \.id) { m in
                        if let fileId = m.file?.id {
                            CachedFileImage(fileId: fileId, token: app.session.token, height: 110)
                                .clipShape(.rect(cornerRadius: 8))
                        }
                    }
                }
            }
        }
        .task {
            await loadSharedMedia(chat)
        }
    }

    private func loadSharedMedia(_ chat: YoohChat) async {
        do {
            let history = try await app.messageService.history(chatId: chat.id, limit: 100)
            sharedImages = history.filter {
                $0.type == .file && ($0.file?.mimeType?.hasPrefix("image/") ?? false)
            }
        } catch {
            // Shared media is best-effort; the info screen stays usable.
        }
    }

    // MARK: - Channel settings (server ChatSettings)

    private func channelSection(_ chat: YoohChat) -> some View {
        Section("Channel") {
            Toggle("Comments", isOn: Binding(
                get: { chat.settings?.commentsEnabled ?? true },
                set: { v in Task { await saveChatSettings(chat, ["commentsEnabled": v]) } }
            ))
            Toggle("Reactions", isOn: Binding(
                get: { chat.settings?.reactionsEnabled ?? true },
                set: { v in Task { await saveChatSettings(chat, ["reactionsEnabled": v]) } }
            ))
            Toggle("Sign messages", isOn: Binding(
                get: { chat.settings?.signMessages ?? false },
                set: { v in Task { await saveChatSettings(chat, ["signMessages": v]) } }
            ))
            if canEdit(chat) {
                PhotosPicker(selection: $avatarItem, matching: .images) {
                    Label("Change channel photo", systemImage: "photo")
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .onChange(of: avatarItem) { _, item in
            guard let item else { return }
            avatarItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let img = UIImage(data: data),
                      let url = ProfileViewModel.avatarDataURL(img) else
                {
                    error = "Couldn't process the image."
                    return
                }
                await saveChatSettings(chat, [:], avatar: url)
            }
        }
    }

    private func saveChatSettings(_ chat: YoohChat, _ settings: [String: Any], avatar: String? = nil, permissions: [String: Any]? = nil) async {
        error = nil
        notice = nil
        var fields: [String: Any] = [:]
        var merged = settings
        if let permissions {
            merged["permissions"] = permissions
        }
        if !merged.isEmpty { fields["settings"] = merged }
        if let avatar { fields["avatar"] = avatar }
        do {
            _ = try await app.chatsService.update(chatId: chat.id, fields: fields)
            await app.chatsViewModel.refresh()
            notice = "Saved."
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Shareable public link (the server resolves /y.ooh/:handle in web).
    private func publicLink(_ chat: YoohChat) -> URL? {
        guard chat.isPublic, let handle = chat.handle, !handle.isEmpty,
              let host = AppConfig.baseURL.host else { return nil }
        var c = URLComponents()
        c.scheme = AppConfig.baseURL.scheme
        c.host = host
        c.port = AppConfig.baseURL.port
        c.path = "/y.ooh/\(handle)"
        return c.url
    }

    // MARK: - Group settings (server ChatSettings)

    private func groupSection(_ chat: YoohChat) -> some View {
        Section("Group") {
            if canEdit(chat) {
                PhotosPicker(selection: $avatarItem, matching: .images) {
                    Label("Change group photo", systemImage: "photo")
                }
                Picker("Slow mode", selection: Binding(
                    get: { chat.settings?.slowModeSeconds ?? 0 },
                    set: { v in Task { await saveChatPermissions(chat, ["slowModeSeconds": v]) } }
                )) {
                    Text("Off").tag(0)
                    Text("10 sec").tag(10)
                    Text("30 sec").tag(30)
                    Text("1 min").tag(60)
                    Text("5 min").tag(300)
                    Text("15 min").tag(900)
                    Text("1 hour").tag(3600)
                }
                Picker("Auto-delete", selection: Binding(
                    get: { chat.settings?.autoDeleteDays ?? 0 },
                    set: { v in Task { await saveChatSettings(chat, ["autoDeleteDays": v]) } }
                )) {
                    Text("Off").tag(0)
                    Text("1 day").tag(1)
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                    Text("1 year").tag(365)
                }
                Toggle("Members can post", isOn: Binding(
                    get: { chat.settings?.membersCanPost ?? true },
                    set: { v in Task { await saveChatPermissions(chat, ["sendMessages": v]) } }
                ))
                Toggle("Members can invite", isOn: Binding(
                    get: { chat.settings?.allowMemberInvites ?? true },
                    set: { v in Task { await saveChatSettings(chat, ["allowMemberInvites": v]) } }
                ))
            }
            Picker("Chat wallpaper", selection: Binding(
                get: { chat.settings?.wallpaperPreset ?? "" },
                set: { v in Task { await saveChatSettings(chat, ["wallpaperPreset": v]) } }
            )) {
                Text("Default").tag("")
                Text("Midnight").tag("midnight")
                Text("Ocean").tag("ocean")
                Text("Royal").tag("royal")
                Text("Ember").tag("ember")
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .onChange(of: avatarItem) { _, item in
            guard canEdit(chat), let item else {
                if avatarItem != nil { avatarItem = nil }
                return
            }
            avatarItem = nil
            Task { await uploadChatAvatar(chat, item: item) }
        }
    }

    private func saveChatPermissions(_ chat: YoohChat, _ permissions: [String: Any]) async {
        await saveChatSettings(chat, [:], permissions: permissions)
    }

    private func uploadChatAvatar(_ chat: YoohChat, item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: data),
              let url = ProfileViewModel.avatarDataURL(img) else
        {
            error = "Couldn't process the image."
            return
        }
        await saveChatSettings(chat, [:], avatar: url)
    }

    // MARK: - Permissions (mirror server roles)

    private func canEdit(_ chat: YoohChat) -> Bool {
        chat.myRole == "owner" || chat.myRole == "admin"
    }

    private func canManageRoles(_ chat: YoohChat) -> Bool {
        chat.myRole == "owner"
    }

    private func canInvite(_ chat: YoohChat) -> Bool {
        chat.myRole == "owner" || chat.myRole == "admin"
    }

    // MARK: - Actions

    private func saveDetails(_ chat: YoohChat) async {
        error = nil
        notice = nil
        isSaving = true
        defer { isSaving = false }
        var fields: [String: Any] = [:]
        let t = title.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty, t != (chat.title ?? "") { fields["title"] = t }
        if description != chat.description { fields["description"] = description }
        let h = handle.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        if h != (chat.handle ?? "") { fields["handle"] = h }
        guard !fields.isEmpty else {
            notice = "Nothing to save."
            return
        }
        do {
            _ = try await app.chatsService.update(chatId: chat.id, fields: fields)
            await app.chatsViewModel.refresh()
            notice = "Saved."
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func setRole(_ chat: YoohChat, member: ChatMember, role: String) {
        Task {
            do {
                try await app.chatsService.setRole(chatId: chat.id, memberId: member.userId, role: role)
                await app.chatsViewModel.refresh()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private enum ModerationKind {
        case ban, unban, mute, unmute
    }

    private func moderate(_ chat: YoohChat, member: ChatMember, kind: ModerationKind) {
        error = nil
        notice = nil
        Task {
            do {
                switch kind {
                case .ban: try await app.chatsService.ban(chatId: chat.id, memberId: member.userId)
                case .unban: try await app.chatsService.unban(chatId: chat.id, memberId: member.userId)
                case .mute: try await app.chatsService.mute(chatId: chat.id, memberId: member.userId)
                case .unmute: try await app.chatsService.unmute(chatId: chat.id, memberId: member.userId)
                }
                Haptics.send()
                await app.chatsViewModel.refresh()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func removeMember(_ chat: YoohChat, member: ChatMember) {        Task {
            do {
                try await app.chatsService.removeMember(chatId: chat.id, memberId: member.userId)
                await app.chatsViewModel.refresh()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// Member picker reusing global user search (people or bots).
private struct AddMemberView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let chatId: String

    @State private var search = ""
    @State private var botsOnly = false
    @State private var error: String?

    var body: some View {
        ContactsSearchBody(
            search: $search,
            onPickUser: { user in
                Task {
                    do {
                        if botsOnly {
                            try await app.chatsService.addBot(chatId: chatId, memberId: user.id)
                        } else {
                            try await app.chatsService.addMember(chatId: chatId, memberId: user.id)
                        }
                        await app.chatsViewModel.refresh()
                        dismiss()
                    } catch {
                        self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                    }
                }
            },
            onJoinPublic: { _ in },
            botsOnly: botsOnly
        )
        .navigationTitle(botsOnly ? "Add bot" : "Add member")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(botsOnly ? "People" : "Bots") {
                    Haptics.selection()
                    botsOnly.toggle()
                }
            }
        }
        .overlay(alignment: .top) {
            if let error {
                ErrorBanner(message: error, onDismiss: { self.error = nil })
            }
        }
    }
}
