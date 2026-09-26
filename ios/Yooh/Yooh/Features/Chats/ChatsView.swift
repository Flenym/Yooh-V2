import SwiftUI

/// Chat list: official nav bar (Edit / compose), native search, folder
/// chips, dense dialog rows, bulk edit mode, saved row
/// and the device-local secret section.
struct ChatsView: View {
    @Environment(AppState.self) private var app
    @State private var showComposer = false
    @State private var showFolders = false
    @State private var confirmDelete: YoohChat?
    @State private var confirmClear: YoohChat?
    @State private var isEditing = false
    @State private var selection = Set<String>()
    @State private var secretChats: [SecretChat] = []
    @State private var openSecret: SecretChat?
    @State private var showRequests = false

    var body: some View {
        @Bindable var chats = app.chatsViewModel
        NavigationStack(path: Bindable(app).chatsPath) {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                RadialGradient(colors: [ThemeStore.shared.accent.opacity(0.08), .clear],
                               center: .topTrailing, startRadius: 10, endRadius: 420)
                    .ignoresSafeArea()
                VStack(spacing: 0) {
                    foldersStrip(folder: chats.folder)
                    chatList(chats)
                }
            }
            .navigationTitle(chats.showArchived ? "Архив" : "Чаты")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $chats.searchText, prompt: "Поиск чатов и сообщений")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Haptics.selection()
                        withAnimation(.snappy) {
                            isEditing.toggle()
                            selection.removeAll()
                        }
                    } label: {
                        Text(isEditing ? "Готово" : "Изм.")
                            .font(.system(size: 16, weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(YoohTheme.TG.field, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(isEditing ? "Закончить изменение" : "Изменить чаты"))
                }
                ToolbarItem(placement: .principal) {
                    if chats.isLoading {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Обновление…")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.selection()
                        showRequests = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "tray.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 38, height: 38)
                                .background(YoohTheme.TG.field, in: .circle)
                            if app.requestsViewModel.badgeCount > 0 {
                                Circle()
                                    .fill(YoohTheme.TG.badge)
                                    .frame(width: 16, height: 16)
                                    .overlay {
                                        Text("\(min(app.requestsViewModel.badgeCount, 9))")
                                            .font(.system(size: 9, weight: .bold))
                                            .foregroundStyle(.white)
                                    }
                                    .offset(x: 4, y: -2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Заявки на переписку"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.selection()
                        showComposer = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 38, height: 38)
                            .background(YoohTheme.TG.field, in: .circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Новый чат"))
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
            .sheet(isPresented: $showFolders) {
                FolderEditorView()
            }
            .sheet(isPresented: $showRequests) {
                RequestsInboxView()
            }
            .sheet(item: $openSecret) { sc in
                if let me = app.session.currentUser?.id {
                    SecretChatView(chat: sc, userId: me) {
                        reloadSecrets()
                    }
                }
            }
            .confirmationDialog("Удалить этот чат?", isPresented: Binding(
                get: { confirmDelete != nil },
                set: { if !$0 { confirmDelete = nil } }
            ), titleVisibility: .visible) {
                Button("Удалить", role: .destructive) {
                    if let chat = confirmDelete {
                        Task { await chats.deleteChat(chat) }
                    }
                    confirmDelete = nil
                }
                Button("Отмена", role: .cancel) { confirmDelete = nil }
            }
            .confirmationDialog("Очистить историю сообщений?", isPresented: Binding(
                get: { confirmClear != nil },
                set: { if !$0 { confirmClear = nil } }
            ), titleVisibility: .visible) {
                Button("Очистить", role: .destructive) {
                    if let chat = confirmClear {
                        Task { await chats.clearHistory(chat) }
                    }
                    confirmClear = nil
                }
                Button("Отмена", role: .cancel) { confirmClear = nil }
            }
            .navigationDestination(for: String.self) { chatId in
                if let chat = chats.chats.first(where: { $0.id == chatId }) {
                    ChatDetailView(chat: chat, app: app)
                } else {
                    EmptyStateView(symbol: "bubble.left.and.bubble.right",
                                   title: "Чат недоступен",
                                   subtitle: "Возможно, он был удалён. Потяните список вниз, чтобы обновить.")
                }
            }
        }
    }

    // MARK: - Folders

    private func foldersStrip(folder: ChatsViewModel.Folder) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: YoohTheme.Spacing.s) {
                folderChip(title: "Все", active: app.chatsViewModel.customFolder == nil && folder == .all) {
                    app.chatsViewModel.setFolder(.all)
                }
                ForEach(app.chatsViewModel.customFolders) { cf in
                    folderChip(title: cf.name, active: app.chatsViewModel.customFolder?.id == cf.id) {
                        app.chatsViewModel.setCustomFolder(cf)
                    }
                }
                folderChip(title: "Архив", active: app.chatsViewModel.customFolder == nil && folder == .archived) {
                    app.chatsViewModel.setFolder(.archived)
                }
                Button {
                    showFolders = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(YoohTheme.TG.field, in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Папки чатов"))
            }
            .padding(.horizontal, YoohTheme.Spacing.l)
            .padding(.vertical, YoohTheme.Spacing.xs)
        }
    }

    private func folderChip(title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: active ? .semibold : .regular))
                .foregroundStyle(active ? .white : .primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(active ? ThemeStore.shared.accent : YoohTheme.TG.field,
                            in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(title) chats"))
    }

    // MARK: - List

    private func chatList(_ chats: ChatsViewModel) -> some View {
        Group {
            if chats.chats.isEmpty, !chats.isLoading {
                emptyState(chats)
            } else if chats.visibleChats.isEmpty, secretChats.isEmpty, savedChat == nil {
                EmptyStateView(symbol: "magnifyingglass", title: "Ничего не найдено",
                               subtitle: "Попробуйте другой запрос или папку.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    if let saved = savedChat {
                        NavigationLink(value: saved.id) {
                            HStack(spacing: YoohTheme.Spacing.m) {
                                ZStack {
                                    Circle()
                                        .fill(ThemeStore.shared.accent.opacity(0.15))
                                        .frame(width: 60, height: 60)
                                    Image(systemName: "bookmark.fill")
                                        .font(.system(size: 24))
                                        .foregroundStyle(ThemeStore.shared.accent)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Избранное")
                                        .font(.system(size: 17, weight: .semibold))
                                    Text("Личные заметки в облаке")
                                        .font(.system(size: 15))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                    }
                    if !secretChats.isEmpty {
                        Section {
                            ForEach(secretChats) { sc in
                                Button {
                                    Haptics.selection()
                                    openSecret = sc
                                } label: {
                                    HStack(spacing: YoohTheme.Spacing.m) {
                                        AvatarView(dataURL: sc.peerAvatar, name: sc.peerName, size: 60)
                                        VStack(alignment: .leading, spacing: 2) {
                                            HStack(spacing: 6) {
                                                Text(sc.peerName)
                                                    .font(.system(size: 17, weight: .semibold))
                                                    .lineLimit(1)
                                                Image(systemName: "lock.fill")
                                                    .font(.system(size: 12))
                                                    .foregroundStyle(.green)
                                            }
                                            Text("Секретный чат на устройстве")
                                                .font(.system(size: 15))
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                    }
                                    .padding(.vertical, 6)
                                }
                                .buttonStyle(.plain)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                            }
                        } header: {
                            Text("Секретные чаты")
                                .foregroundStyle(.secondary)
                        }
                    }
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
                                        .foregroundStyle(selection.contains(chat.id) ? ThemeStore.shared.accent : .secondary)
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
                                    Label(chats.isPinned(chat.id) ? "Открепить" : "Закреп",
                                          systemImage: chats.isPinned(chat.id) ? "pin.slash" : "pin")
                                }
                                .tint(.orange)
                                Button { chats.toggleArchive(chat.id) } label: {
                                    Label("В архив", systemImage: "archivebox")
                                }
                                .tint(.gray)
                            }
                            .swipeActions(edge: .trailing) {
                                Button { chats.toggleMute(chat.id) } label: {
                                    Label(chats.isMuted(chat.id) ? "Со звуком" : "Без звука",
                                          systemImage: chats.isMuted(chat.id) ? "bell" : "bell.slash")
                                }
                                .tint(.blue)
                                Button(role: .destructive) { confirmDelete = chat } label: {
                                    Label("Удалить", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button { chats.togglePin(chat.id) } label: {
                                    Label(chats.isPinned(chat.id) ? "Открепить" : "Закреп",
                                          systemImage: chats.isPinned(chat.id) ? "pin.slash" : "pin")
                                }
                                Button { chats.toggleMute(chat.id) } label: {
                                    Label(chats.isMuted(chat.id) ? "Со звуком" : "Без звука",
                                          systemImage: chats.isMuted(chat.id) ? "bell" : "bell.slash")
                                }
                                Button { chats.toggleArchive(chat.id) } label: {
                                    Label(chats.isArchived(chat.id) ? "Из архива" : "В архив",
                                          systemImage: chats.isArchived(chat.id) ? "archivebox.fill" : "archivebox")
                                }
                                Button { confirmClear = chat } label: {
                                    Label("Очистить историю", systemImage: "eraser")
                                }
                                Button(role: .destructive) { confirmDelete = chat } label: {
                                    Label("Удалить", systemImage: "trash")
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
        .onAppear {
            reloadSecrets()
        }
    }

    // MARK: - Bulk edit bar

    private func editBar(_ chats: ChatsViewModel) -> some View {
        VStack(spacing: 6) {
            Text(selection.isEmpty ? "Выберите чаты" : "Выбрано: \(selection.count)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 0) {
                editAction(symbol: "pin.fill", title: "Закреп") {
                    for id in selection { chats.togglePin(id) }
                    doneEditing()
                }
                editAction(symbol: "bell.slash.fill", title: "Без звука") {
                    for id in selection { chats.toggleMute(id) }
                    doneEditing()
                }
                editAction(symbol: "archivebox.fill", title: "В архив") {
                    for id in selection { chats.toggleArchive(id) }
                    doneEditing()
                }
                editAction(symbol: "trash.fill", title: "Удалить", destructive: true) {
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
            .accessibilityLabel(Text("Выбрано чатов: \(selection.count)"))
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
                Button("Попробовать снова") {
                    Task { await chats.refresh() }
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, YoohTheme.Spacing.s)
            } else {
                EmptyStateView(symbol: "bubble.left.and.bubble.right",
                               title: "Пока нет чатов",
                               subtitle: "Начните общение из Контактов или кнопкой нового чата.")
                Button("Обновить") {
                    Task { await chats.refresh() }
                }
                .buttonStyle(.bordered)
                .padding(.top, YoohTheme.Spacing.s)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var savedChat: YoohChat? {
        guard let me = app.session.currentUser?.id else { return nil }
        return app.chatsViewModel.chats.first(where: {
            $0.type == .direct && $0.peer(myUserId: me) == nil
        })
    }

    private func reloadSecrets() {
        guard let me = app.session.currentUser?.id else {
            secretChats = []
            return
        }
        secretChats = SecretStore(userId: me).chats
    }

    private func isPeerOnline(_ chat: YoohChat) -> Bool {
        guard chat.type == .direct,
              let me = app.chatsViewModel.myUserId,
              let peer = chat.peer(myUserId: me) else { return false }
        return app.isOnline(peer.userId)
    }
}
