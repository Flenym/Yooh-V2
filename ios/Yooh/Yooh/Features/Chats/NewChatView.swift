import SwiftUI

/// New conversation sheet: saved messages, secret chat, user search with
/// web-style prefix scopes, public groups, group/channel creation.
struct NewChatView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var search = ""
    @State private var showGroupForm = false
    @State private var showChannelForm = false
    @State private var showSecretPicker = false
    @State private var secretSearch = ""
    @State private var openSecret: SecretChat?
    @State private var requestUser: PublicUser?
    @State private var groupTitle = ""
    @State private var channelTitle = ""
    @State private var pickedMembers: Set<String> = []

    var body: some View {
        NavigationStack {
            ContactsSearchBody(
                search: $search,
                onPickUser: { user in
                    Task {
                        switch await app.contactsViewModel.openDirect(with: user) {
                        case .chat:
                            dismiss()
                        case .needsRequest(let u):
                            requestUser = u
                        case .none:
                            break
                        }
                    }
                },
                onJoinPublic: { dc in
                    Task {
                        if await app.contactsViewModel.joinPublic(dc) != nil {
                            dismiss()
                        }
                    }
                }
            )
            .navigationTitle("Новый чат")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            Task {
                                if await app.contactsViewModel.openSaved() != nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Избранное", systemImage: "bookmark.fill")
                        }
                        Button { showSecretPicker = true } label: {
                            Label("Новый секретный чат", systemImage: "lock.fill")
                        }
                        Button { showGroupForm = true } label: {
                            Label("Новая группа", systemImage: "person.3")
                        }
                        Button { showChannelForm = true } label: {
                            Label("Новый канал", systemImage: "megaphone")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text("Варианты создания"))
                }
            }
            .sheet(isPresented: $showSecretPicker) {
                NavigationStack {
                    ContactsSearchBody(
                        search: $secretSearch,
                        onPickUser: { user in
                            if let me = app.session.currentUser?.id {
                                let chat = SecretStore(userId: me).createChat(
                                    peerUserId: user.id,
                                    peerName: user.title,
                                    peerAvatar: user.avatar,
                                    myId: me)
                                Haptics.send()
                                openSecret = chat
                            }
                        },
                        onJoinPublic: { _ in }
                    )
                    .navigationTitle("Новый секретный чат")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Закрыть") { showSecretPicker = false }
                        }
                    }
                }
            }
            .sheet(item: $openSecret) { sc in
                if let me = app.session.currentUser?.id {
                    SecretChatView(chat: sc, userId: me) {}
                }
            }
            .sheet(item: $requestUser) { user in
                MessageRequestSheet(user: user) {
                    dismiss()
                }
            }
            .sheet(isPresented: $showGroupForm) {
                groupForm
                    .presentationDetents([.medium])
            }
            .sheet(isPresented: $showChannelForm) {
                channelForm
                    .presentationDetents([.medium])
            }
        }
    }

    private var groupForm: some View {
        NavigationStack {
            Form {
                TextField("Название группы", text: $groupTitle)
                Section("Members (optional — add more later)") {
                    Text("Pick people from search results after creating, or invite them from group info.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                AsyncButton(title: "Создать группу", isBusy: false) {
                    guard !groupTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    if await app.contactsViewModel.createGroup(
                        title: groupTitle.trimmingCharacters(in: .whitespaces),
                        memberIds: Array(pickedMembers)) != nil
                    {
                        dismiss()
                    }
                }
            }
            .navigationTitle("Новая группа")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var channelForm: some View {
        NavigationStack {
            Form {
                TextField("Название канала", text: $channelTitle)
                AsyncButton(title: "Создать канал", isBusy: false) {
                    guard !channelTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    if await app.contactsViewModel.createChannel(
                        title: channelTitle.trimmingCharacters(in: .whitespaces)) != nil
                    {
                        dismiss()
                    }
                }
            }
            .navigationTitle("Новый канал")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Shared user/public-chat search with web-style prefix scopes:
/// `@` people, `%` channels, `&` groups, `$` servers, `*` bots.
struct ContactsSearchBody: View {
    @Environment(AppState.self) private var app
    @Binding var search: String
    var onPickUser: (PublicUser) -> Void
    var onJoinPublic: (DiscoveredChat) -> Void
    var botsOnly: Bool = false

    enum Scope: String, CaseIterable {
        case all = "Все"
        case people = "Люди"
        case groups = "Группы"
    }

    @State private var scope: Scope = .all

    private var showPeople: Bool { scope != .groups }
    private var showGroups: Bool { scope != .people }

    var body: some View {
        @Bindable var contacts = app.contactsViewModel
        List {
            Section {
                scopeChips
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
            }
            Section {
                Text("Подсказка: начните с @ % & $ *, чтобы искать среди людей, каналов, групп, серверов и ботов.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let error = contacts.error {
                ErrorBanner(message: error, onDismiss: { contacts.clearError() })
                    .listRowSeparator(.hidden)
            }
            if showPeople, !contacts.users.isEmpty {
                Section {
                    ForEach(contacts.users, id: \.id) { user in
                        Button { onPickUser(user) } label: {
                            HStack(spacing: YoohTheme.Spacing.m) {
                                AvatarView(dataURL: user.avatar, name: user.title,
                                           size: 52,
                                           isOnline: app.isOnline(user.id))
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(user.title)
                                            .font(.system(size: 17))
                                        if user.isBot {
                                            BotTag()
                                        }
                                    }
                                    if let u = user.username {
                                        Text("@\(u)").font(.system(size: 15)).foregroundStyle(.secondary)
                                    } else {
                                        Text(app.isOnline(user.id) ? "в сети" : "был(а) недавно")
                                            .font(.system(size: 15))
                                            .foregroundStyle(app.isOnline(user.id) ? YoohTheme.TG.presence : .secondary)
                                    }
                                }
                                Spacer()
                            }
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } header: {
                    Text("Люди").foregroundStyle(.secondary)
                }
            }
            if showGroups, !contacts.publicChats.isEmpty {
                Section {
                    ForEach(contacts.publicChats, id: \.id) { dc in
                        HStack(spacing: YoohTheme.Spacing.m) {
                            AvatarView(dataURL: nil, name: dc.title ?? "?", size: 52)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(dc.title ?? "Группа")
                                    .font(.system(size: 17))
                                if let h = dc.handle {
                                    Text("@\(h)").font(.system(size: 15)).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if dc.joined == true {
                                Text("Вы участник").font(.caption).foregroundStyle(.secondary)
                            } else {
                                Button("Вступить") { onJoinPublic(dc) }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                            }
                        }
                        .padding(.vertical, 6)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } header: {
                    Text("Публичные группы").foregroundStyle(.secondary)
                }
            }
            if search.trimmingCharacters(in: .whitespaces).count >= 2,
               contacts.users.isEmpty, contacts.publicChats.isEmpty, !contacts.isSearching
            {
                    EmptyStateView(symbol: "magnifyingglass", title: "Ничего не найдено",
                               subtitle: "Попробуйте другое имя или @username.")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(YoohTheme.TG.background)
        .searchable(text: $search, prompt: "Имя или @username")
        .onChange(of: search) { _, q in contacts.search(q, botsOnly: botsOnly) }
        .onChange(of: botsOnly) { contacts.search(search, botsOnly: botsOnly) }
        .overlay {
            if contacts.isSearching { ProgressView().padding(.top, 40) }
        }
    }

    private var scopeChips: some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            ForEach(Scope.allCases, id: \.self) { s in
                let active = (scope == s)
                Button {
                    Haptics.selection()
                    scope = s
                } label: {
                    Text(s.rawValue)
                        .font(.system(size: 14, weight: active ? .semibold : .regular))
                        .foregroundStyle(active ? .white : .primary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(active ? ThemeStore.shared.accent : YoohTheme.TG.field, in: .capsule)
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }
}
