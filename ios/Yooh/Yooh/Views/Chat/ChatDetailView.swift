import SwiftUI

/// Conversation screen in the reference style: floating glass header
/// (back circle, centered title pill, avatar), wallpaper, day chips,
/// Telegram-family bubbles and a circular composer.
struct ChatDetailView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var vm: ChatViewModel
    @State private var showInfo = false
    @State private var showPoll = false
    @State private var isNearBottom = true

    init(chat: YoohChat, app: AppState) {
        _vm = State(initialValue: ChatViewModel(chat: chat, app: app))
    }

    var body: some View {
        @Bindable var vm = vm
        ZStack {
            wallpaper
            VStack(spacing: 0) {
                header(vm)
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
                    .onChange(of: vm.messages.count) {
                        if isNearBottom {
                            withAnimation(.snappy) {
                                proxy.scrollTo("bottom", anchor: .bottom)
                            }
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

                ComposerView(vm: vm, onPoll: { showPoll = true })
            }
        }
        .toolbar(.hidden, for: .navigationBar)
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

    // MARK: - Wallpaper + header

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

    private func header(_ vm: ChatViewModel) -> some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Button {
                Haptics.selection()
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
            }
            .yoohGlass(.interactive, cornerRadius: 20)
            .accessibilityLabel(Text("Back"))

            Spacer()

            Button { showInfo = true } label: {
                VStack(spacing: 0) {
                    Text(chatTitle)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(chatSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
            }
            .buttonStyle(.plain)
            .yoohGlass(.regular, cornerRadius: 20)
            .accessibilityLabel(Text("Chat info for \(chatTitle)"))

            Spacer()

            Button {
                app.callsViewModel.unavailableNotice()
            } label: {
                Image(systemName: "phone.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 36, height: 36)
            }
            .yoohGlass(.interactive, cornerRadius: 18)
            .accessibilityLabel(Text("Voice call"))

            Button {
                app.callsViewModel.unavailableNotice()
            } label: {
                Image(systemName: "video.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 36, height: 36)
            }
            .yoohGlass(.interactive, cornerRadius: 18)
            .accessibilityLabel(Text("Video call"))

            Button { showInfo = true } label: {
                AvatarView(dataURL: headerAvatar, name: chatTitle, size: 40, isOnline: headerOnline)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Open chat info"))
        }
        .padding(.horizontal, YoohTheme.Spacing.m)
        .padding(.top, YoohTheme.Spacing.xs)
        .padding(.bottom, YoohTheme.Spacing.xs)
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
