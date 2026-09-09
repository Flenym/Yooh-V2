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
            HStack(spacing: YoohTheme.Spacing.m) {
                AvatarView(dataURL: chat.avatar, name: chat.displayTitle, size: YoohTheme.Layout.avatarL)
                VStack(alignment: .leading) {
                    Text(chat.displayTitle).font(.title3.bold())
                    Text(typeLabel(chat)).font(.caption).foregroundStyle(.secondary)
                    if let h = chat.handle, !h.isEmpty {
                        Text("@\(h)").font(.caption).foregroundStyle(Color.accentColor)
                    }
                }
            }
            .padding(.vertical, YoohTheme.Spacing.s)
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
                        Text(m.displayName ?? (m.username.map { "@\($0)" } ?? "User"))
                            .font(.subheadline)
                        if let role = m.role {
                            Text(role.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if canManageRoles(chat), m.userId != app.session.currentUser?.id {
                        Menu {
                            Button("Make admin") { setRole(chat, member: m, role: "admin") }
                            Button("Make member") { setRole(chat, member: m, role: "member") }
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
        Section("Contact") {
            if let me = app.session.currentUser?.id,
               let peer = chat.peer(myUserId: me)
            {
                if let about = peer.about, !about.isEmpty {
                    Text(about)
                }
                if let u = peer.username {
                    Text("@\(u)").foregroundStyle(Color.accentColor)
                }
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

    private func removeMember(_ chat: YoohChat, member: ChatMember) {
        Task {
            do {
                try await app.chatsService.removeMember(chatId: chat.id, memberId: member.userId)
                await app.chatsViewModel.refresh()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// Member picker reusing global user search.
private struct AddMemberView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let chatId: String

    @State private var search = ""
    @State private var error: String?

    var body: some View {
        ContactsSearchBody(
            search: $search,
            onPickUser: { user in
                Task {
                    do {
                        try await app.chatsService.addMember(chatId: chatId, memberId: user.id)
                        await app.chatsViewModel.refresh()
                        dismiss()
                    } catch {
                        self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                    }
                }
            },
            onJoinPublic: { _ in }
        )
        .navigationTitle("Add member")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close") { dismiss() }
            }
        }
        .overlay(alignment: .top) {
            if let error {
                ErrorBanner(message: error, onDismiss: { self.error = nil })
            }
        }
    }
}
