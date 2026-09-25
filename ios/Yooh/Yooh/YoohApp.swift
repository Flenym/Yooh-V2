import SwiftUI

/// Native Yooh client: splash → auth → main tabs. No WebView.
@main
struct YoohApp: App {
    @State private var app = AppState()
    @State private var theme = ThemeStore.shared
    @State private var appLock = AppLockStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(theme)
                .preferredColorScheme(UITestPreview.forceDark ? .dark : theme.colorScheme)
                .overlay {
                    if appLock.isLocked, app.session.isAuthenticated {
                        LockScreenView()
                            .transition(.opacity)
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, app.session.isAuthenticated {
                Task { await app.chatsViewModel.refresh() }
            } else if phase == .background {
                appLock.lock()
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
                AuthView()
            }
        }
        .animation(.snappy, value: app.session.isAuthenticated)
        .task {
            if UITestPreview.isActive {
                await UITestPreview.configure(app: app)
                return
            }
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
        ZStack {
            YoohTheme.TG.background.ignoresSafeArea()
            VStack(spacing: YoohTheme.Spacing.m) {
                YoohLogoMark(size: 84)
                Text("Yooh")
                    .font(.system(size: 28, weight: .bold))
                ProgressView()
            }
        }
        .accessibilityLabel(Text("Загрузка Yooh"))
    }
}

/// Biometric lock screen overlay (App Lock feature).
private struct LockScreenView: View {
    @State private var lock = AppLockStore.shared
    @State private var isBusy = false

    var body: some View {
        @Bindable var lock = lock
        ZStack {
            YoohTheme.TG.background.ignoresSafeArea()
            VStack(spacing: YoohTheme.Spacing.m) {
                YoohLogoMark(size: 84)
                Text("Yooh заблокирован")
                    .font(.title3.bold())
                Button {
                    Task {
                        isBusy = true
                        defer { isBusy = false }
                        _ = await lock.unlock()
                    }
                } label: {
                    HStack {
                        if isBusy { ProgressView().tint(.white) }
                        Text("Разблокировать: \(lock.biometryName)")
                            .bold()
                            .foregroundStyle(.white)
                    }
                    .frame(maxWidth: 260)
                    .frame(height: 50)
                    .background(ThemeStore.shared.accent, in: .capsule)
                }
                .disabled(isBusy)
                if let error = lock.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .task {
            _ = await lock.unlock()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Yooh заблокирован"))
    }
}
