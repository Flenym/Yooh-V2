import SwiftUI

/// Conversation screen: history (paginated), realtime updates, composer,
/// reactions, replies, edits, forwards, polls, locations, attachments,
/// typing indicator and read receipts.
struct ChatDetailView: View {
    @Environment(AppState.self) private var app
    @State private var vm: ChatViewModel
    @State private var showInfo = false
    @State private var showPoll = false
    @State private var isNearBottom = true

    init(chat: YoohChat, app: AppState) {
        _vm = State(initialValue: ChatViewModel(chat: chat, app: app))
    }

    var body: some View {
        @Bindable var vm = vm
        VStack(spacing: 0) {
            if vm.chat.isChannel {
                Picker("Stream", selection: Binding(
                    get: { vm.stream },
                    set: { vm.setStream($0) }
                )) {
                    Text("Posts").tag(MessageStream.main)
                    Text("Comments").tag(MessageStream.comment)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, YoohTheme.Spacing.l)
                .padding(.vertical, YoohTheme.Spacing.xs)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: YoohTheme.Spacing.s) {
                        if vm.hasMore, !vm.messages.isEmpty {
                            ProgressView()
                                .onAppear { vm.loadMore() }
                        }
                        ForEach(vm.messages, id: \.id) { m in
                            MessageBubbleView(message: m, vm: vm)
                                .id(m.id)
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                            .onAppear { isNearBottom = true }
                            .onDisappear { isNearBottom = false }
                    }
                    .padding(.horizontal, YoohTheme.Spacing.m)
                    .padding(.vertical, YoohTheme.Spacing.s)
                }
                .onChange(of: vm.messages.count) {
                    if isNearBottom {
                        withAnimation(.snappy) {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    // Initial jump without animation.
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
                .refreshable {
                    vm.loadInitial()
                }
            }

            if let typing = vm.typingText {
                HStack {
                    Text(typing)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, YoohTheme.Spacing.l)
                .padding(.bottom, 2)
                .transition(.opacity)
            }

            if let error = vm.error {
                ErrorBanner(message: error, onDismiss: { vm.clearError() })
            }

            ComposerView(vm: vm, onPoll: { showPoll = true })
        }
        .navigationTitle(chatTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { showInfo = true } label: {
                    HStack(spacing: YoohTheme.Spacing.s) {
                        AvatarView(dataURL: headerAvatar, name: chatTitle,
                                   size: 30, isOnline: headerOnline)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(chatTitle).font(.headline).lineLimit(1)
                            Text(chatSubtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Chat info for \(chatTitle)"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showInfo = true } label: {
                        Label("Info", systemImage: "info.circle")
                    }
                    Button {
                        app.callsViewModel.unavailableNotice()
                    } label: {
                        Label("Call", systemImage: "phone")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel(Text("Chat actions"))
            }
        }
        .sheet(isPresented: $showInfo) {
            NavigationStack {
                ChatInfoView(chatId: vm.chatId)
            }
        }
        .sheet(isPresented: $showPoll) {
            PollComposerView(vm: vm)
        }
        .sheet(item: $vm.forwardTarget) { m in
            ForwardSheetView(message: m, sourceChatId: vm.chatId)
        }
        .onAppear {
            vm.appear()
            vm.refreshChatRow()
        }
        .onDisappear {
            vm.disappear()
        }
    }

    // MARK: - Header

    private var chatTitle: String {
        if vm.chat.type == .direct,
           let me = app.session.currentUser?.id,
           let peer = vm.chat.peer(myUserId: me)
        {
            return peer.displayName ?? peer.username.map { "@\($0)" } ?? vm.chat.displayTitle
        }
        return vm.chat.displayTitle
    }

    private var headerAvatar: String? {
        if vm.chat.type == .direct,
           let me = app.session.currentUser?.id,
           let peer = vm.chat.peer(myUserId: me)
        {
            return peer.avatar ?? vm.chat.avatar
        }
        return vm.chat.avatar
    }

    private var headerOnline: Bool {
        guard vm.chat.type == .direct,
              let me = app.session.currentUser?.id,
              let peer = vm.chat.peer(myUserId: me) else { return false }
        return app.isOnline(peer.userId)
    }

    private var chatSubtitle: String {
        switch vm.chat.type {
        case .direct:
            if let me = app.session.currentUser?.id,
               let peer = vm.chat.peer(myUserId: me), app.isOnline(peer.userId)
            {
                return "online"
            }
            return "last seen recently"
        case .group:
            return "\(vm.chat.membersCount) members"
        case .channel:
            return "channel"
        case .server:
            return "server"
        case .unknown:
            return ""
        }
    }
}
