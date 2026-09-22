import SwiftUI

struct StorageView: View {
    @Environment(AppState.self) private var app

    @State private var imageCacheBytes: Int64 = 0
    @State private var tmpBytes: Int64 = 0
    @State private var wifi = true
    @State private var mobile = true
    @State private var roaming = false
    @State private var error: String?
    @State private var notice: String?

    var body: some View {
        List {
            Section("На этом устройстве") {
                LabeledContent("Кэш изображений", value: ByteCountFormatter.string(fromByteCount: imageCacheBytes, countStyle: .file))
                LabeledContent("Временные файлы", value: ByteCountFormatter.string(fromByteCount: tmpBytes, countStyle: .file))
                Button("Очистить кэш изображений", role: .destructive) {
                    Task {
                        await ImageCache.shared.clear()
                        Haptics.send()
                        await measure()
                        notice = "Кэш изображений очищен."
                    }
                }
                Button("Очистить временные файлы", role: .destructive) {
                    clearTmp()
                    Haptics.send()
                    Task { await measure() }
                    notice = "Временные файлы очищены."
                }
            }
            Section("Автозагрузка фото") {
                SettingToggleRow(title: "По Wi-Fi", subtitle: nil, isOn: $wifi) {
                    save(["autoDownloadWifi": $0])
                }
                SettingToggleRow(title: "По мобильной сети", subtitle: nil, isOn: $mobile) {
                    save(["autoDownloadMobile": $0])
                }
                SettingToggleRow(title: "В роуминге", subtitle: nil, isOn: $roaming) {
                    save(["autoDownloadRoaming": $0])
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Данные и память")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await measure()
            await load()
        }
    }

    private func measure() async {
        imageCacheBytes = directoryBytes(subpath: "yooh-images", in: .cachesDirectory)
        tmpBytes = directoryBytes(subpath: nil, in: nil)
    }

    private func directoryBytes(subpath: String?, in search: FileManager.SearchPathDirectory?) -> Int64 {
        let fm = FileManager.default
        let base: URL
        if let search {
            base = fm.urls(for: search, in: .userDomainMask)[0]
        } else {
            base = fm.temporaryDirectory
        }
        let url = subpath.map { base.appendingPathComponent($0) } ?? base
        var total: Int64 = 0
        if let items = try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.fileSizeKey]) {
            for item in items {
                total += (try? item.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap(Int64.init) ?? 0
            }
        }
        return total
    }

    private func clearTmp() {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: fm.temporaryDirectory, includingPropertiesForKeys: nil) else { return }
        for item in items where item.lastPathComponent.hasPrefix("audio-") || item.lastPathComponent.hasPrefix("voice-") {
            try? fm.removeItem(at: item)
        }
    }

    private func load() async {
        do {
            let remote = try await app.settingsService.fetch()
            var s: [String: AnyCodable] = [:]
            if case .object(let o) = remote["data"] { s = o }
            wifi = SettingsReader.bool("autoDownloadWifi", in: s, default: true)
            mobile = SettingsReader.bool("autoDownloadMobile", in: s, default: true)
            roaming = SettingsReader.bool("autoDownloadRoaming", in: s, default: false)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func save(_ patch: [String: Any]) {
        Task {
            do {
                try await app.settingsService.patch(section: "data", value: patch)
                await app.profileViewModel.reload()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
