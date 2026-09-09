import SwiftUI

/// New conversation sheet: user search, public chats, group/channel creation.
struct NewChatView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var search = ""
    @State private var showGroupForm = false
    @State private var showChannelForm = false
    @State private var groupTitle = ""
    @State private var channelTitle = ""
    @State private var pickedMembers: Set<String> = []

    var body: some View {
        NavigationStack {
            ContactsSearchBody(
                search: $search,
                onPickUser: { user in
                    Task {
                        // The new chat lands in the list; the sheet dismisses.
                        if await app.contactsViewModel.openDirect(with: user) != nil {
                            dismiss()
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
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showGroupForm = true } label: {
                            Label("New group", systemImage: "person.3")
                        }
                        Button { showChannelForm = true } label: {
                            Label("New channel", systemImage: "megaphone")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text("Create group or channel"))
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

    // MARK: - Group / channel forms

    private var groupForm: some View {
        NavigationStack {
            Form {
                TextField("Group name", text: $groupTitle)
                Section("Members (optional — add more later)") {
                    Text("Pick people from search results after creating, or invite them from group info.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                AsyncButton(title: "Create group", isBusy: false) {
                    guard !groupTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    if await app.contactsViewModel.createGroup(
                        title: groupTitle.trimmingCharacters(in: .whitespaces),
                        memberIds: Array(pickedMembers)) != nil
                    {
                        dismiss()
                    }
                }
            }
            .navigationTitle("New group")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var channelForm: some View {
        NavigationStack {
            Form {
                TextField("Channel name", text: $channelTitle)
                AsyncButton(title: "Create channel", isBusy: false) {
                    guard !channelTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    if await app.contactsViewModel.createChannel(
                        title: channelTitle.trimmingCharacters(in: .whitespaces)) != nil
                    {
                        dismiss()
                    }
                }
            }
            .navigationTitle("New channel")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Shared user/public-chat search body (used by NewChat sheet + Contacts tab).
struct ContactsSearchBody: View {
    @Environment(AppState.self) private var app
    @Binding var search: String
    var onPickUser: (PublicUser) -> Void
    var onJoinPublic: (DiscoveredChat) -> Void

    enum Scope: String, CaseIterable {
        case all = "All"
        case people = "People"
        case groups = "Groups"
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
                                    Text(user.title)
                                        .font(.system(size: 17))
                                    if let u = user.username {
                                        Text("@\(u)").font(.system(size: 15)).foregroundStyle(.secondary)
                                    } else {
                                        Text(app.isOnline(user.id) ? "online" : "last seen recently")
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
                    Text("People").foregroundStyle(.secondary)
                }
            }
            if showGroups, !contacts.publicChats.isEmpty {
                Section {
                    ForEach(contacts.publicChats, id: \.id) { dc in
                        HStack(spacing: YoohTheme.Spacing.m) {
                            AvatarView(dataURL: nil, name: dc.title ?? "?", size: 52)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(dc.title ?? "Group")
                                    .font(.system(size: 17))
                                if let h = dc.handle {
                                    Text("@\(h)").font(.system(size: 15)).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if dc.joined == true {
                                Text("Joined").font(.caption).foregroundStyle(.secondary)
                            } else {
                                Button("Join") { onJoinPublic(dc) }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                            }
                        }
                        .padding(.vertical, 6)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } header: {
                    Text("Public groups").foregroundStyle(.secondary)
                }
            }
            if search.trimmingCharacters(in: .whitespaces).count >= 2,
               contacts.users.isEmpty, contacts.publicChats.isEmpty, !contacts.isSearching
            {
                EmptyStateView(symbol: "magnifyingglass", title: "Nothing found",
                               subtitle: "Try a different name or @username.")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(YoohTheme.TG.background)
        .searchable(text: $search, prompt: "Name or @username")
        .onChange(of: search) { _, q in contacts.search(q) }
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
                        .background(active ? YoohTheme.TG.badge : YoohTheme.TG.field, in: .capsule)
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }
}
