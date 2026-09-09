import SwiftUI

/// Root shell after login: four sections (Contacts / Calls / Chats /
/// Settings) in one floating glass capsule plus a separate circular
/// search control — the reference bottom-shell layout.
///
/// Stories live as a strip inside Chats (not a fifth tab).
struct MainTabView: View {
    @Environment(AppState.self) private var app

    enum Tab: String, CaseIterable {
        case contacts, calls, chats, settings
    }

    @State private var tab: Tab = .chats
    @State private var showSearch = false
    @Namespace private var tabGlow

    var body: some View {
        @Bindable var appState = app
        ZStack(alignment: .bottom) {
            Group {
                switch tab {
                case .contacts:
                    ContactsView()
                case .calls:
                    CallsView()
                case .chats:
                    ChatsListView()
                case .settings:
                    SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if appState.isChatOpen == false {
                bottomShell
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: appState.isChatOpen)
        .background(YoohTheme.TG.background.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let call = app.incomingCall {
                IncomingCallBanner(signal: call)
                    .padding(.top, YoohTheme.Spacing.s)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: app.incomingCall?.sessionId)
        .sheet(isPresented: $showSearch) {
            NavigationStack {
                GlobalSearchView()
            }
        }
        .task {
            await app.chatsViewModel.refresh()
            await app.storiesViewModel.refresh()
        }
    }

    // MARK: - Bottom shell

    private var bottomShell: some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            HStack(spacing: 0) {
                tabButton(.contacts, symbol: "person.circle", activeSymbol: "person.circle.fill", title: "Contacts")
                tabButton(.calls, symbol: "phone", activeSymbol: "phone.fill", title: "Calls")
                tabButton(.chats, symbol: "bubble.left.and.bubble.right", activeSymbol: "bubble.left.and.bubble.right.fill", title: "Chats",
                          badge: app.chatsViewModel.unreadCount)
                tabButton(.settings, symbol: "person", activeSymbol: "person.fill", title: "Settings")
            }
            .padding(.horizontal, YoohTheme.Spacing.s)
            .padding(.vertical, YoohTheme.Spacing.xs)
            .yoohGlass(.interactive, cornerRadius: YoohTheme.Radius.pill)

            Button {
                Haptics.selection()
                showSearch = true
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 56, height: 56)
            }
            .yoohGlass(.interactive, cornerRadius: 28)
            .accessibilityLabel(Text("Search"))
        }
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.bottom, YoohTheme.Spacing.s)
    }

    private func tabButton(_ t: Tab, symbol: String, activeSymbol: String, title: String, badge: Int = 0) -> some View {
        let active = (tab == t)
        return Button {
            Haptics.selection()
            withAnimation(.snappy) { tab = t }
        } label: {
            VStack(spacing: 2) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: active ? activeSymbol : symbol)
                        .font(.system(size: 22))
                        .foregroundStyle(active ? .white : .primary)
                        .frame(width: 56, height: 30)
                        .background {
                            if active {
                                Capsule()
                                    .fill(ThemeStore.shared.accent)
                                    .frame(width: 56, height: 30)
                                    .matchedGeometryEffect(id: "tabActive", in: tabGlow)
                            }
                        }
                    if badge > 0 {
                        Text(badge > 99 ? "99+" : "\(badge)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(YoohTheme.TG.badge, in: .capsule)
                            .offset(x: 6, y: -6)
                            .accessibilityLabel(Text("\(badge) unread chats"))
                    }
                }
                Text(title)
                    .font(.system(size: 10, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? ThemeStore.shared.accent : .secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
    }
}

/// Slim incoming-call banner (alert only — media lands with WebRTC).
private struct IncomingCallBanner: View {
    @Environment(AppState.self) private var app
    let signal: CallSignal

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            AvatarView(dataURL: signal.from?.avatar, name: signal.from?.title ?? "Call",
                       size: YoohTheme.Layout.avatarS)
            VStack(alignment: .leading, spacing: 2) {
                Text(signal.from?.title ?? "Incoming call")
                    .font(.subheadline.bold())
                Text(signal.mode == "video" ? "Video call…" : "Voice call…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { try? await app.callService.decline(sessionId: signal.sessionId ?? "", chatId: signal.chatId ?? "") }
            } label: {
                Image(systemName: "phone.down.fill")
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(.red, in: .circle)
            }
            .accessibilityLabel(Text("Decline call"))
            Button {
                app.callsViewModel.unavailableNotice()
            } label: {
                Image(systemName: "phone.fill")
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(.green, in: .circle)
            }
            .accessibilityLabel(Text("Accept call"))
        }
        .padding(YoohTheme.Spacing.m)
        .yoohGlass(.interactive)
        .padding(.horizontal, YoohTheme.Spacing.l)
        .accessibilityElement(children: .contain)
    }
}

/// Global search sheet: people + public groups (one place, like the
/// reference search entry point).
private struct GlobalSearchView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var openedChat: YoohChat?

    var body: some View {
        ContactsSearchBody(
            search: $search,
            onPickUser: { user in
                Task {
                    if let chat = await app.contactsViewModel.openDirect(with: user) {
                        openedChat = chat
                    }
                }
            },
            onJoinPublic: { dc in
                Task {
                    if let chat = await app.contactsViewModel.joinPublic(dc) {
                        openedChat = chat
                    }
                }
            }
        )
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close") { dismiss() }
            }
        }
        .navigationDestination(item: $openedChat) { chat in
            ChatDetailView(chat: chat, app: app)
        }
    }
}
