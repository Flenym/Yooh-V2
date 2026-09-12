import SwiftUI

/// Sticker picker from installed packs. Tapping sends the image as a
/// real file message (stickers are images server-side).
struct StickerSheetView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let vm: ChatViewModel

    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if app.settingsViewModel.stickerPacks.isEmpty {
                    EmptyStateView(symbol: "face.smiling", title: "No stickers",
                                   subtitle: "Sticker packs from Settings will appear here.")
                } else {
                    List(app.settingsViewModel.stickerPacks, id: \.id) { pack in
                        Section(pack.title ?? "Pack") {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 64))], spacing: 12) {
                                ForEach(pack.stickers ?? []) { item in
                                    Button {
                                        send(item)
                                    } label: {
                                        stickerThumb(item)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Stickers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .overlay(alignment: .top) {
                if let error {
                    ErrorBanner(message: error, onDismiss: { self.error = nil })
                }
            }
            .task {
                await app.settingsViewModel.loadStickerPacks()
            }
        }
    }

    @ViewBuilder
    private func stickerThumb(_ item: StickerItem) -> some View {
        if let data = stickerData(item), let img = UIImage(data: data) {
            Image(uiImage: img)
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityLabel(Text(item.label ?? item.emoji ?? "Sticker"))
        } else {
            Text(item.emoji ?? "?")
                .font(.system(size: 40))
        }
    }

    private func stickerData(_ item: StickerItem) -> Data? {
        guard let raw = item.image, !raw.isEmpty else { return nil }
        if let data = MediaService.data(fromDataURL: raw) { return data }
        return Data(base64Encoded: raw)
    }

    private func send(_ item: StickerItem) {
        guard let data = stickerData(item) else {
            error = "Couldn't load this sticker."
            return
        }
        let mime = data.prefix(4) == Data([0x89, 0x50, 0x4E, 0x47]) ? "image/png" : "image/jpeg"
        vm.upload(data: data,
                  filename: "sticker.\(mime == "image/png" ? "png" : "jpg")",
                  mimeType: mime)
        Haptics.send()
        dismiss()
    }
}
