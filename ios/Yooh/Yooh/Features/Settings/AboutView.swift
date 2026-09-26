import SwiftUI

/// About Yooh: version, server, links.
struct AboutView: View {
    var body: some View {
        List {
            Section {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        YoohLogoMark(size: 72)
                        Text("Yooh")
                            .font(.title2.bold())
                        Text("Быстрый нативный мессенджер")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.vertical, 8)
            }
            Section("Приложение") {
                LabeledContent("Версия", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                LabeledContent("Сборка", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
            }
            Section("Сервер") {
                LabeledContent("API", value: AppConfig.apiURLString)
                    .font(.footnote)
                Text("Yooh server API + Socket.IO")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("О приложении")
        .navigationBarTitleDisplayMode(.inline)
    }
}
