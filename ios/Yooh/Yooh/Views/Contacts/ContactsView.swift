import SwiftUI

/// Contacts tab in the reference style: Sort pill + centered title +
/// add button, search pill, Invite row and presence rows.
struct ContactsView: View {
    @Environment(AppState.self) private var app
    @State private var search = ""
    @State private var onlineFirst = false

    var body: some View {
        @Bindable var contacts = app.contactsViewModel
        NavigationStack(path: Bindable(app).contactsPath) {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    header
                    searchPill(contacts)
                    contactsList(contacts)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { chatId in
                if let chat = app.chatsViewModel.chats.first(where: { $0.id == chatId }) {
                    ChatDetailView(chat: chat, app: app)
                }
            }
            .overlay(alignment: .top) {
                if let error = contacts.error {
                    ErrorBanner(message: error, onDismiss: { contacts.clearError() })
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                Haptics.selection()
                onlineFirst.toggle()
            } label: {
                Text(onlineFirst ? "Online" : "Sort")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 72, height: 40)
            }
            .yoohGlass(.interactive, cornerRadius: 20)
            .accessibilityLabel(Text("Toggle sort order"))

            Spacer()
            Text("Contacts")
                .font(.system(size: 20, weight: .bold))
            Spacer()

            NavigationLink {
                NewChatView()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
            }
            .yoohGlass(.interactive, cornerRadius: 20)
            .accessibilityLabel(Text("New chat"))
        }
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.top, YoohTheme.Spacing.s)
        .padding(.bottom, YoohTheme.Spacing.xs)
    }

    private func searchPill(_ contacts: ContactsViewModel) -> some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search", text: $search)
                .autocapitalization(.none)
                .disableAutocorrection(true)
            if !search.isEmpty {
                Button {
                    search = ""
                    contacts.search("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel(Text("Clear search"))
            }
        }
        .padding(.horizontal, YoohTheme.Spacing.m)
        .frame(height: 44)
        .background(YoohTheme.TG.field, in: .rect(cornerRadius: 22))
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.vertical, YoohTheme.Spacing.xs)
        .onChange(of: search) { _, q in contacts.search(q) }
    }

    // MARK: - List

    private func contactsList(_ contacts: ContactsViewModel) -> some View {
        List {
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
                        if let chat = await contacts.openDirect(with: user) {
                            app.contactsPath.append(chat.id)
                        }
                    }
                } label: {
                    HStack(spacing: YoohTheme.Spacing.m) {
                        AvatarView(dataURL: user.avatar, name: user.title,
                                   size: 52, isOnline: app.isOnline(user.id))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.title)
                                .font(.system(size: 17, weight: .regular))
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
