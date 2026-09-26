import SwiftUI

/// Active sessions (Telegram: Devices): current + others, terminate,
/// link desktop via QR or manual token.
struct DevicesView: View {
    @Environment(AppState.self) private var app
    @State private var showLinkDevice = false
    @State private var showQR = false

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        List {
            Section {
                ForEach(settings.sessions, id: \.id) { s in
                    HStack {
                        Image(systemName: icon(for: s.platform))
                            .foregroundStyle(.secondary)
                            .frame(width: 28)
                        VStack(alignment: .leading) {
                            Text(s.name ?? s.client ?? "Сессия").font(.subheadline)
                            Text(YoohDates.relative(s.lastSeenAt)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if s.isCurrent == true {
                            Text("Это устройство").font(.caption).foregroundStyle(ThemeStore.shared.accent)
                        } else {
                            Button {
                                Task { await settings.deleteSession(s.id) }
                            } label: {
                                Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
                            }
                            .accessibilityLabel(Text("Завершить сессию"))
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
            Section {
                Button("Завершить другие сессии") {
                    Task { await settings.terminateOthers() }
                }
                .foregroundStyle(ThemeStore.shared.accent)
            }
            Section("Новое устройство") {
                Button("Привязать устройство") { showLinkDevice = true }
                    .foregroundStyle(ThemeStore.shared.accent)
                Button("Показать код для нового устройства") { showQR = true }
                    .foregroundStyle(ThemeStore.shared.accent)
            }
            if let error = settings.error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice = settings.notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Устройства")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await settings.loadSessions()
        }
        .refreshable {
            await settings.loadSessions()
        }
        .sheet(isPresented: $showLinkDevice) {
            NavigationStack { LinkDeviceView() }
        }
        .sheet(isPresented: $showQR) {
            ShowQRView()
        }
    }

    private func icon(for platform: String?) -> String {
        switch platform {
        case "iphone": return "iphone"
        case "android": return "smartphone"
        default: return "desktopcomputer"
        }
    }
}
