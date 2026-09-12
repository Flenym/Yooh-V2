import SwiftUI

/// Contacts: native nav bar, native search, sync row, invite row,
/// presence rows (direct chat or message request on 403).
struct ContactsView: View {
    @Environment(AppState.self) private var app
    @State private var search = ""
    @State private var onlineFirst = false
    @State private var requestUser: PublicUser?

    var body: some View {
        @Bindable var contacts = app.contactsViewModel
        NavigationStack(path: Bindable(app).contactsPath) {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                contactsList(contacts)
            }
            .navigationTitle("Contacts")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $search, prompt: "Name or @username")
            .onChange(of: search) { _, q in contacts.search(q) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(onlineFirst ? "Online" : "Sort") {
                        Haptics.selection()
                        onlineFirst.toggle()
                    }
                    .accessibilityLabel(Text("Toggle sort order"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        NewChatView()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text("New chat"))
                }
            }
            .navigationDestination(for: String.self) { chatId in
                if let chat = app.chatsViewModel.chats.first(where: { $0.id == chatId }) {
                    ChatDetailView(chat: chat, app: app)
                }
            }
            .sheet(item: $requestUser) { user in
                MessageRequestSheet(user: user)
            }
            .overlay(alignment: .top) {
                VStack(spacing: YoohTheme.Spacing.s) {
                    if let error = contacts.error {
                        ErrorBanner(message: error, onDismiss: { contacts.clearError() })
                    }
                    if let notice = contacts.notice {
                        NoticeBanner(message: notice, onDismiss: { contacts.clearNotice() })
                    }
                }
            }
        }
    }

    private func contactsList(_ contacts: ContactsViewModel) -> some View {
        List {
            Button {
                Task { await contacts.syncPhoneContacts() }
            } label: {
                HStack(spacing: YoohTheme.Spacing.m) {
                    if contacts.isSyncing {
                        ProgressView()
                            .frame(width: 52)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 22))
                            .foregroundStyle(ThemeStore.shared.accent)
                            .frame(width: 52)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sync phone contacts")
                            .font(.system(size: 17))
                        Text("Find contacts already on Yooh")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .disabled(contacts.isSyncing)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityLabel(Text("Sync phone contacts"))

            ShareLink(item: "Join me on Yooh: \(AppConfig.apiURLString)") {
                HStack(spacing: YoohTheme.Spacing.m) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 22))
                        .foregroundStyle(.secondary)
                        .frame(width: 52)
                    Text("Invite Friends")
                        .font(.system(size: 17))
                    Spacer()
                }
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            ForEach(sortedUsers(contacts.users), id: \.id) { user in
                Button {
                    Task {
                        switch await contacts.openDirect(with: user) {
                        case .chat(let chat):
                            app.contactsPath.append(chat.id)
                        case .needsRequest(let u):
                            requestUser = u
                        case .none:
                            break
                        }
                    }
                } label: {
                    HStack(spacing: YoohTheme.Spacing.m) {
                        AvatarView(dataURL: user.avatar, name: user.title,
                                   size: 52, isOnline: app.isOnline(user.id))
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(user.title)
                                    .font(.system(size: 17, weight: .regular))
                                if user.isBot {
                                    BotTag()
                                }
                            }
                            Text(app.isOnline(user.id) ? "online" : presenceFallback(user))
                                .font(.system(size: 15))
                                .foregroundStyle(app.isOnline(user.id) ? YoohTheme.TG.presence : .secondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            if !contacts.publicChats.isEmpty {
                ForEach(contacts.publicChats, id: \.id) { dc in
                    HStack(spacing: YoohTheme.Spacing.m) {
                        AvatarView(dataURL: nil, name: dc.title ?? "?", size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(dc.title ?? "Group")
                                .font(.system(size: 17))
                            Text(dc.handle.map { "@\($0)" } ?? "public group")
                                .font(.system(size: 15))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(dc.joined == true ? "Open" : "Join") {
                            Task {
                                if let chat = await contacts.joinPublic(dc) {
                                    app.contactsPath.append(chat.id)
                                }
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.vertical, 6)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if contacts.isSearching {
                ProgressView().padding(.top, 40)
            }
        }
    }

    private func sortedUsers(_ users: [PublicUser]) -> [PublicUser] {
        guard onlineFirst else { return users }
        return users.sorted {
            let ao = app.isOnline($0.id), bo = app.isOnline($1.id)
            if ao != bo { return ao }
            return ($0.displayName ?? "") < ($1.displayName ?? "")
        }
    }

    private func presenceFallback(_ user: PublicUser) -> String {
        if let u = user.username, !u.isEmpty { return "@\(u)" }
        return "last seen recently"
    }
}
