import SwiftUI

/// App root after login: native TabView (system tab bar = system glass).
/// Incoming-call alerts overlay any tab; auth screen shows when logged out.
struct MainTabView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        TabView {
            ChatsListView()
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right") }
                .yoohIf(app.chatsViewModel.unreadCount > 0) {
                    $0.badge(app.chatsViewModel.unreadCount)
                }

            ContactsView()
                .tabItem { Label("Contacts", systemImage: "person.2") }

            StoriesView()
                .tabItem { Label("Stories", systemImage: "circle.dashed") }

            CallsView()
                .tabItem { Label("Calls", systemImage: "phone") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .overlay(alignment: .top) {
            if let call = app.incomingCall {
                IncomingCallBanner(signal: call)
                    .padding(.top, YoohTheme.Spacing.s)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: app.incomingCall?.sessionId)
        .task {
            await app.chatsViewModel.refresh()
            await app.storiesViewModel.refresh()
        }
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
