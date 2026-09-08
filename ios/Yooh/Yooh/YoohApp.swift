import SwiftUI

/// Yooh for iOS — native SwiftUI client for the existing Yooh backend.
///
/// - Auth state restores from Keychain on launch (GET /api/me validation).
/// - Realtime (Socket.IO) starts after login and stops on logout.
/// - No WebView, no mock data: every screen talks to the real server.
@main
struct YoohApp: App {
    @State private var app = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, app.session.isAuthenticated {
                // Re-sync after background: the socket auto-reconnects,
                // and the list refresh covers anything missed.
                Task { await app.chatsViewModel.refresh() }
            }
        }
    }
}

private struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Group {
            if app.session.isRestoring {
                splash
            } else if app.session.isAuthenticated {
                MainTabView()
            } else {
                AuthRootView()
            }
        }
        .animation(.snappy, value: app.session.isAuthenticated)
        .task {
            if !app.didBoot {
                app.didBoot = true
                await app.session.bootstrap()
                if app.session.isAuthenticated {
                    app.startRealtime()
                }
            }
        }
    }

    private var splash: some View {
        VStack(spacing: YoohTheme.Spacing.m) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.accentColor)
            ProgressView()
        }
        .accessibilityLabel(Text("Loading Yooh"))
    }
}
