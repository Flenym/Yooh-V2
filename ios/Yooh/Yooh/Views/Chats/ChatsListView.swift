import SwiftUI

/// Chat list: official Apple navigation bar (large title, toolbar,
/// native search) + folder chips, stories strip and dense dialog rows.
///
/// Rows are `NavigationLink(value:)` — the canonical in-List routing.
struct ChatsListView: View {
    @Environment(AppState.self) private var app
    @State private var showComposer = false
    @State private var showStories = false
    @State private var showStoryCreator = false
    @State private var confirmDelete: YoohChat?
    @State private var confirmClear: YoohChat?
    @State private var isEditing = false
    @State private var selection = Set<String>()

    var body: some View {
        @Bindable var chats = app.chatsViewModel
        NavigationStack(path: Bindable(app).chatsPath) {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    foldersStrip(folder: chats.folder)
                    storiesStrip
                    chatList(chats)
                }
            }
            .navigationTitle(chats.showArchived ? "Archived" : "Chats")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $chats.searchText, prompt: "Search chats and messages")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(isEditing ? "Done" : "Edit") {
                        Haptics.selection()
                        withAnimation(.snappy) {
                            isEditing.toggle()
                            selection.removeAll()
                        }
                    }
                    .accessibilityLabel(Text(isEditing ? "Done editing" : "Edit chats"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.selection()
                        showComposer = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel(Text("New chat"))
                }
            }
            .overlay(alignment: .bottom) {
                if isEditing {
                    editBar(chats)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .padding(.bottom, 96)
                }
            }
            .animation(.snappy, value: isEditing)
            .sheet(isPresented: $showComposer) {
                NewChatView()
            }
            .sheet(isPresented: $showStories) {
                NavigationStack { StoriesView() }
            }
            .sheet(isPresented: $showStoryCreator) {
                StoryCreatorView()
            }
            .confirmationDialog("Delete this chat?", isPresented: Binding(
                get: { confirmDelete != nil },
                set: { if !$0 { confirmDelete = nil } }
            ), titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let chat = confirmDelete {
                        Task { await chats.deleteChat(chat) }
                    }
                    confirmDelete = nil
                }
                Button("Cancel", role: .cancel) { confirmDelete = nil }
            }
            .confirmationDialog("Clear message history?", isPresented: Binding(
                get: { confirmClear != nil },
                set: { if !$0 { confirmClear = nil } }
            ), titleVisibility: .visible) {
                Button("Clear", role: .destructive) {
                    if let chat = confirmClear {
                        Task { await chats.clearHistory(chat) }
                    }
                    confirmClear = nil
                }
                Button("Cancel", role: .cancel) { confirmClear = nil }
            }
            .navigationDestination(for: String.self) { chatId in
                if let chat = chats.chats.first(where: { $0.id == chatId }) {
                    ChatDetailView(chat: chat, app: app)
                } else {
                    EmptyStateView(symbol: "bubble.left.and.bubble.right",
                                   title: "Chat unavailable",
                                   subtitle: "It may have been deleted. Pull to refresh the list.")
                }
            }
        }
    }

    // MARK: - Folders

    private func foldersStrip(folder: ChatsViewModel.Folder) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: YoohTheme.Spacing.s) {
                ForEach(ChatsViewModel.Folder.allCases, id: \.self) { f in
                    let active = (folder == f)
                    Button {
                        app.chatsViewModel.setFolder(f)
                    } label: {
                        Text(f.rawValue)
                            .font(.system(size: 15, weight: active ? .semibold : .regular))
                            .foregroundStyle(active ? .white : .primary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(active ? YoohTheme.TG.badge : YoohTheme.TG.field,
                                        in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("\(f.rawValue) chats"))
                }
            }
            .padding(.horizontal, YoohTheme.Spacing.l)
            .padding(.vertical, YoohTheme.Spacing.xs)
        }
    }

    // MARK: - Stories strip

    @ViewBuilder
    private var storiesStrip: some View {
        let groups = app.storiesViewModel.groups
        if !groups.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: YoohTheme.Spacing.m) {
                    Button {
                        Haptics.selection()
                        showStoryCreator = true
                    } label: {
                        VStack(spacing: 4) {
                            ZStack {
                                Circle()
                                    .fill(YoohTheme.TG.field)
                                    .frame(width: 56, height: 56)
                                Image(systemName: "plus")
                                    .font(.system(size: 22, weight: .semibold))
                                    .foregroundStyle(YoohTheme.TG.badge)
                            }
                            Text("Add")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Create story"))
                    ForEach(groups.indices, id: \.self) { i in
                        let g = groups[i]
                        let seen = isGroupSeen(g.stories)
                        Button {
                            Haptics.selection()
                            showStories = true
                        } label: {
                            VStack(spacing: 4) {
                                AvatarView(dataURL: g.author?.avatar ?? g.stories.first?.image,
                                           name: g.author?.title ?? "?",
                                           size: 56)
                                .overlay {
                                    Circle()
                                        .stroke(seen ? Color(.systemGray3) : YoohTheme.TG.badge, lineWidth: 2)
                                        .frame(width: 62, height: 62)
                                }
                                Text(g.author?.title ?? "")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .frame(width: 62)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, YoohTheme.Spacing.l)
                .padding(.vertical, YoohTheme.Spacing.xs)
            }
        }
    }

    private func isGroupSeen(_ stories: [YoohStory]) -> Bool {
        guard let me = app.session.currentUser?.id, !stories.isEmpty else { return true }
        return stories.allSatisfy { s in
            (s.viewers ?? []).contains(where: { $0.userId == me })
        }
    }

    // MARK: - List

    private func chatList(_ chats: ChatsViewModel) -> some View {
        Group {
            if chats.chats.isEmpty, !chats.isLoading {
                emptyState(chats)
            } else if chats.visibleChats.isEmpty {
                EmptyStateView(symbol: "magnifyingglass", title: "Nothing found",
                               subtitle: "Try a different search or folder.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(chats.visibleChats) { chat in
                        if isEditing {
                            Button {
                                Haptics.selection()
                                if selection.contains(chat.id) {
                                    selection.remove(chat.id)
                                } else {
                                    selection.insert(chat.id)
                                }
                            } label: {
                                HStack(spacing: YoohTheme.Spacing.m) {
                                    Image(systemName: selection.contains(chat.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(selection.contains(chat.id) ? YoohTheme.TG.badge : .secondary)
                                    ChatRowView(chat: chat,
                                                myUserId: chats.myUserId ?? "",
                                                isPinned: chats.isPinned(chat.id),
                                                isMuted: chats.isMuted(chat.id),
                                                isOnline: isPeerOnline(chat))
                                }
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                        } else {
                            NavigationLink(value: chat.id) {
                                ChatRowView(chat: chat,
                                            myUserId: chats.myUserId ?? "",
                                            isPinned: chats.isPinned(chat.id),
                                            isMuted: chats.isMuted(chat.id),
                                            isOnline: isPeerOnline(chat))
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                            .swipeActions(edge: .leading) {
                                Button { chats.togglePin(chat.id) } label: {
                                    Label(chats.isPinned(chat.id) ? "Unpin" : "Pin",
                                          systemImage: chats.isPinned(chat.id) ? "pin.slash" : "pin")
                                }
                                .tint(.orange)
                                Button { chats.toggleArchive(chat.id) } label: {
                                    Label("Archive", systemImage: "archivebox")
                                }
                                .tint(.gray)
                            }
                            .swipeActions(edge: .trailing) {
                                Button { chats.toggleMute(chat.id) } label: {
                                    Label(chats.isMuted(chat.id) ? "Unmute" : "Mute",
                                          systemImage: chats.isMuted(chat.id) ? "bell" : "bell.slash")
                                }
                                .tint(.blue)
                                Button(role: .destructive) { confirmDelete = chat } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button { chats.togglePin(chat.id) } label: {
                                    Label(chats.isPinned(chat.id) ? "Unpin" : "Pin",
                                          systemImage: chats.isPinned(chat.id) ? "pin.slash" : "pin")
                                }
                                Button { chats.toggleMute(chat.id) } label: {
                                    Label(chats.isMuted(chat.id) ? "Unmute" : "Mute",
                                          systemImage: chats.isMuted(chat.id) ? "bell" : "bell.slash")
                                }
                                Button { chats.toggleArchive(chat.id) } label: {
                                    Label(chats.isArchived(chat.id) ? "Unarchive" : "Archive",
                                          systemImage: chats.isArchived(chat.id) ? "archivebox.fill" : "archivebox")
                                }
                                Button { confirmClear = chat } label: {
                                    Label("Clear history", systemImage: "eraser")
                                }
                                Button(role: .destructive) { confirmDelete = chat } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { await chats.refresh() }
            }
        }
        .overlay(alignment: .top) {
            if let error = chats.error {
                ErrorBanner(message: error, onDismiss: { chats.clearError() })
            }
        }
        .overlay {
            if chats.isLoading, chats.chats.isEmpty {
                ProgressView()
            }
        }
    }

    // MARK: - Bulk edit bar

    private func editBar(_ chats: ChatsViewModel) -> some View {
        VStack(spacing: 6) {
            Text(selection.isEmpty ? "Select chats" : "\(selection.count) selected")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 0) {
                editAction(symbol: "pin.fill", title: "Pin") {
                    for id in selection { chats.togglePin(id) }
                    doneEditing()
                }
                editAction(symbol: "bell.slash.fill", title: "Mute") {
                    for id in selection { chats.toggleMute(id) }
                    doneEditing()
                }
                editAction(symbol: "archivebox.fill", title: "Archive") {
                    for id in selection { chats.toggleArchive(id) }
                    doneEditing()
                }
                editAction(symbol: "trash.fill", title: "Delete", destructive: true) {
                    Task {
                        for id in selection {
                            if let chat = chats.chats.first(where: { $0.id == id }) {
                                await chats.deleteChat(chat)
                            }
                        }
                        doneEditing()
                    }
                }
            }
            .padding(.horizontal, YoohTheme.Spacing.m)
            .padding(.vertical, YoohTheme.Spacing.s)
            .yoohGlass(.interactive, cornerRadius: 24)
            .padding(.horizontal, YoohTheme.Spacing.l)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("\(selection.count) chats selected"))
        }
    }

    private func editAction(symbol: String, title: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: {
            Haptics.selection()
            action()
        }) {
            VStack(spacing: 4) {
                Image(systemName: symbol)
                    .font(.system(size: 20))
                    .foregroundStyle(destructive ? .red : .primary)
                    .frame(maxWidth: .infinity)
                Text(title)
                    .font(.system(size: 11))
                    .foregroundStyle(destructive ? .red : .secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(selection.isEmpty)
        .opacity(selection.isEmpty ? 0.4 : 1)
    }

    private func doneEditing() {
        selection.removeAll()
        withAnimation(.snappy) { isEditing = false }
    }

    private func emptyState(_ chats: ChatsViewModel) -> some View {
        VStack(spacing: YoohTheme.Spacing.m) {
            if let error = chats.error {
                ErrorBanner(message: error, onDismiss: { chats.clearError() })
                Button("Try again") {
                    Task { await chats.refresh() }
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, YoohTheme.Spacing.s)
            } else {
                EmptyStateView(symbol: "bubble.left.and.bubble.right",
                               title: "No chats yet",
                               subtitle: "Start a conversation from Contacts or the compose button.")
                Button("Reload") {
                    Task { await chats.refresh() }
                }
                .buttonStyle(.bordered)
                .padding(.top, YoohTheme.Spacing.s)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func isPeerOnline(_ chat: YoohChat) -> Bool {
        guard chat.type == .direct,
              let me = app.chatsViewModel.myUserId,
              let peer = chat.peer(myUserId: me) else { return false }
        return app.isOnline(peer.userId)
    }
}
