import SwiftUI

/// Chat list: search, archive toggle, swipe + context actions, compose sheet.
///
/// The body is deliberately decomposed into small helpers: a single giant
/// ViewBuilder expression times out the type-checker in Release builds.
struct ChatsListView: View {
    @Environment(AppState.self) private var app
    @State private var showComposer = false
    @State private var selectedChatId: String?
    @State private var confirmDelete: YoohChat?
    @State private var confirmClear: YoohChat?

    var body: some View {
        @Bindable var chats = app.chatsViewModel
        NavigationStack {
            Group {
                if chats.chats.isEmpty, !chats.isLoading {
                    EmptyStateView(symbol: "bubble.left.and.bubble.right",
                                   title: "No chats yet",
                                   subtitle: "Start a conversation from Contacts or the compose button.")
                } else {
                    chatList(chats)
                }
            }
            .navigationTitle(chats.showArchived ? "Archived" : "Chats")
            .searchable(text: $chats.searchText, prompt: "Search chats")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        chats.showArchived.toggle()
                    } label: {
                        Image(systemName: chats.showArchived ? "archivebox.fill" : "archivebox")
                    }
                    .accessibilityLabel(Text(chats.showArchived ? "Show chats" : "Show archived"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showComposer = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel(Text("New chat"))
                }
            }
            .overlay(alignment: .top) {
                if let error = chats.error {
                    ErrorBanner(message: error, onDismiss: { chats.clearError() })
                }
            }
            .sheet(isPresented: $showComposer) {
                NewChatView()
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
                }
            }
            .overlay {
                if chats.isLoading, chats.chats.isEmpty {
                    ProgressView()
                }
            }
        }
    }

    // MARK: - List

    private func chatList(_ chats: ChatsViewModel) -> some View {
        List {
            ForEach(chats.visibleChats) { chat in
                chatRow(chat, chats)
            }
        }
        .listStyle(.plain)
        .refreshable { await chats.refresh() }
    }

    private func chatRow(_ chat: YoohChat, _ chats: ChatsViewModel) -> some View {
        Button {
            selectedChatId = chat.id
        } label: {
            ChatRowView(chat: chat,
                        myUserId: chats.myUserId ?? "",
                        isPinned: chats.isPinned(chat.id),
                        isMuted: chats.isMuted(chat.id),
                        isOnline: isPeerOnline(chat))
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .leading) {
            leadingActions(chat, chats)
        }
        .swipeActions(edge: .trailing) {
            trailingActions(chat, chats)
        }
        .contextMenu {
            rowMenu(chat, chats)
        }
    }

    private func leadingActions(_ chat: YoohChat, _ chats: ChatsViewModel) -> some View {
        Group {
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
    }

    private func trailingActions(_ chat: YoohChat, _ chats: ChatsViewModel) -> some View {
        Group {
            Button { chats.toggleMute(chat.id) } label: {
                Label(chats.isMuted(chat.id) ? "Unmute" : "Mute",
                      systemImage: chats.isMuted(chat.id) ? "bell" : "bell.slash")
            }
            .tint(.blue)
            Button(role: .destructive) { confirmDelete = chat } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func rowMenu(_ chat: YoohChat, _ chats: ChatsViewModel) -> some View {
        Group {
            Button { selectedChatId = chat.id } label: {
                Label("Open", systemImage: "bubble.left")
            }
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

    private func isPeerOnline(_ chat: YoohChat) -> Bool {
        guard chat.type == .direct,
              let me = app.chatsViewModel.myUserId,
              let peer = chat.peer(myUserId: me) else { return false }
        return app.isOnline(peer.userId)
    }
}
