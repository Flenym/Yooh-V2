import SwiftUI

/// Conversation screen in the reference style: floating glass header
/// (back circle, centered title pill, avatar), wallpaper, day chips,
/// Telegram-family bubbles and a circular composer.
struct ChatDetailView: View {
    @Environment(AppState.self) private var app
    @State private var vm: ChatViewModel
    @State private var showInfo = false
    @State private var showPoll = false
    @State private var showSearch = false
    @State private var isNearBottom = true

    init(chat: YoohChat, app: AppState) {
        _vm = State(initialValue: ChatViewModel(chat: chat, app: app))
    }

    var body: some View {
        @Bindable var vm = vm
        ZStack {
            wallpaper
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
                    VStack(spacing: 0) {
                        pinnedStrip(proxy: proxy)
                    ZStack(alignment: .bottomTrailing) {
                        ScrollView {
                            LazyVStack(spacing: 0) {
                                if vm.hasMore, !vm.messages.isEmpty {
                                    ProgressView()
                                        .tint(.secondary)
                                        .padding(.vertical, 8)
                                        .onAppear { vm.loadMore() }
                                }
                                ForEach(vm.messages.indices, id: \.self) { i in
                                    let m = vm.messages[i]
                                    if isNewDay(i) {
                                        dayChip(for: m)
                                    }
                                    MessageBubbleView(message: m, vm: vm)
                                        .id(m.id)
                                        .padding(.top, bubbleTopSpacing(i))
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
                        if !isNearBottom, !vm.messages.isEmpty {
                            Button {
                                Haptics.selection()
                                withAnimation(.snappy) {
                                    proxy.scrollTo("bottom", anchor: .bottom)
                                }
                            } label: {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(.primary)
                                    .frame(width: 40, height: 40)
                            }
                            .yoohGlass(.interactive, cornerRadius: 20)
                            .padding(.trailing, YoohTheme.Spacing.m)
                            .padding(.bottom, YoohTheme.Spacing.m)
                            .transition(.scale.combined(with: .opacity))
                            .accessibilityLabel(Text("Scroll to latest messages"))
                        }
                    }
                    }
                    .onChange(of: vm.messages.count) {
                        if isNearBottom {
                            withAnimation(.snappy) {
                                proxy.scrollTo("bottom", anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: vm.jumpTarget) { _, target in
                        if let target {
                            withAnimation(.snappy) {
                                proxy.scrollTo(target, anchor: .center)
                            }
                            vm.jumpTarget = nil
                        }
                    }
                    .onAppear {
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

                if let notice = vm.notice {
                    HStack(spacing: YoohTheme.Spacing.s) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text(notice)
                            .font(.footnote)
                        Spacer()
                        Button(action: { vm.clearNotice() }) {
                            Image(systemName: "xmark")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(Text("Dismiss notice"))
                    }
                    .padding(YoohTheme.Spacing.s)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: YoohTheme.Radius.m))
                    .padding(.horizontal, YoohTheme.Spacing.l)
                }

                ComposerView(vm: vm, onPoll: { showPoll = true })
            }
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
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showSearch = true
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel(Text("Search in chat"))
                Button {
                    app.callsViewModel.unavailableNotice()
                } label: {
                    Image(systemName: "phone.fill")
                }
                .accessibilityLabel(Text("Voice call"))
                Button {
                    app.callsViewModel.unavailableNotice()
                } label: {
                    Image(systemName: "video.fill")
                }
                .accessibilityLabel(Text("Video call"))
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
        .sheet(isPresented: $showSearch) {
            MessageSearchView(vm: vm)
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

    // MARK: - Wallpaper

    private var wallpaper: some View {
        ZStack {
            LinearGradient(colors: [YoohTheme.TG.wallpaperTop, YoohTheme.TG.wallpaperBottom],
                           startPoint: .top, endPoint: .bottom)
            // Whisper-quiet accent glows: premium texture, theme-aware.
            Circle()
                .fill(ThemeStore.shared.accent.opacity(0.10))
                .frame(width: 320, height: 320)
                .blur(radius: 90)
                .offset(x: -140, y: -260)
            Circle()
                .fill(ThemeStore.shared.accent.opacity(0.07))
                .frame(width: 380, height: 380)
                .blur(radius: 110)
                .offset(x: 150, y: 300)
        }
        .ignoresSafeArea()
    }

    // MARK: - Pinned strip (local pin, like the web client)

    @ViewBuilder
    private func pinnedStrip(proxy: ScrollViewProxy) -> some View {
        if let pinned = vm.pinnedMessage {
            HStack(spacing: YoohTheme.Spacing.s) {
                Button {
                    Haptics.selection()
                    withAnimation(.snappy) {
                        proxy.scrollTo(pinned.id, anchor: .center)
                    }
                } label: {
                    HStack(spacing: YoohTheme.Spacing.s) {
                        Capsule()
                            .fill(ThemeStore.shared.accent)
                            .frame(width: 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Pinned message")
                                .font(.caption.bold())
                                .foregroundStyle(ThemeStore.shared.accent)
                            Text(pinned.text ?? pinned.file?.originalName ?? "Message")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Go to pinned message"))
                Button {
                    vm.togglePin(pinned)
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                }
                .accessibilityLabel(Text("Unpin message"))
            }
            .padding(.horizontal, YoohTheme.Spacing.m)
            .padding(.vertical, YoohTheme.Spacing.s)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 14))
            .padding(.horizontal, YoohTheme.Spacing.m)
            .padding(.vertical, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    // MARK: - Day chips

    /// Tight spacing inside same-sender chains, airy gaps between them.
    private func bubbleTopSpacing(_ index: Int) -> CGFloat {
        guard index > 0, index < vm.messages.count else { return YoohTheme.Spacing.s }
        let cur = vm.messages[index]
        let prev = vm.messages[index - 1]
        if cur.senderId == prev.senderId, !isNewDay(index) {
            return 2
        }
        return YoohTheme.Spacing.s
    }

    private func isNewDay(_ index: Int) -> Bool {
        guard index < vm.messages.count else { return false }
        guard index > 0 else { return true }
        let cal = Calendar.current
        guard let a = YoohDates.parse(vm.messages[index].createdAt),
              let b = YoohDates.parse(vm.messages[index - 1].createdAt) else { return false }
        return !cal.isDate(a, inSameDayAs: b)
    }

    private func dayChip(for m: YoohMessage) -> some View {
        Text(dayTitle(m.createdAt))
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(YoohTheme.TG.dayChip, in: .capsule)
            .padding(.vertical, 4)
            .accessibilityLabel(Text(dayTitle(m.createdAt)))
    }

    private func dayTitle(_ iso: String?) -> String {
        guard let date = YoohDates.parse(iso) else { return "" }
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: date)
    }

    // MARK: - Titles

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
