import SwiftUI

/// Interface language: Русский / English, synced to the server.
struct LanguageView: View {
    @Environment(AppState.self) private var app

    private let options = [("ru", "Русский"), ("en", "English")]

    var body: some View {
        @Bindable var settings = app.settingsViewModel
        List {
            Section {
                ForEach(options, id: \.0) { code, name in
                    Button {
                        Task { await settings.setLanguage(code) }
                    } label: {
                        HStack {
                            Text(name)
                                .font(.system(size: 17))
                                .foregroundStyle(.primary)
                            Spacer()
                            if settings.language == code {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(ThemeStore.shared.accent)
                            }
                        }
                        .padding(.vertical, 6)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(name))
                }
            }
            Section {
                Text("Язык интерфейса синхронизируется с сервером и применяется на всех устройствах.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let error = settings.error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .navigationTitle("Язык")
        .navigationBarTitleDisplayMode(.inline)
    }
}
