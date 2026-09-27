import SwiftUI

/// Sticker picker from installed packs. Tapping sends the image as a
/// real file message (stickers are images server-side).
struct StickerSheetView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let vm: ChatViewModel

    @State private var error: String?
    @State private var tab = 0
    @State private var gifQuery = ""
    @State private var gifs: [GifItem] = []
    @State private var gifLoading = false
    @State private var gifTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Вкладка", selection: $tab) {
                    Text("Стикеры").tag(0)
                    Text("GIF").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()
                if tab == 0 {
                    stickerList
                } else {
                    gifList
                }
            }
            .navigationTitle(tab == 0 ? "Стикеры" : "GIF")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
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
            .task(id: tab) {
                if tab == 1, gifs.isEmpty { await loadGifs(query: "") }
            }
        }
    }

    // MARK: - Stickers

    private var stickerList: some View {
        Group {
            if app.settingsViewModel.stickerPacks.isEmpty {
                EmptyStateView(symbol: "face.smiling", title: "Нет стикеров",
                               subtitle: "Стикерпаки из настроек появятся здесь.")
            } else {
                List(app.settingsViewModel.stickerPacks, id: \.id) { pack in
                    Section(pack.title ?? "Пак") {
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
    }

    // MARK: - GIF

    private var gifList: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Поиск GIF", text: $gifQuery)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .onSubmit { Task { await loadGifs(query: gifQuery) } }
                if !gifQuery.isEmpty {
                    Button {
                        gifQuery = ""
                        Task { await loadGifs(query: "") }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
            .background(YoohTheme.TG.field, in: .rect(cornerRadius: 12))
            .padding(.horizontal)
            .padding(.bottom, 8)
            if gifLoading, gifs.isEmpty {
                Spacer()
                ProgressView()
                Spacer()
            } else if gifs.isEmpty {
                Spacer()
                EmptyStateView(symbol: "photo", title: "Ничего не найдено",
                               subtitle: "Попробуйте другой запрос.")
                Spacer()
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 8) {
                        ForEach(gifs) { g in
                            Button {
                                Task { await sendGif(g) }
                            } label: {
                                AsyncImage(url: g.previewURL) { phase in
                                    switch phase {
                                    case .success(let img):
                                        img.resizable().scaledToFill()
                                    default:
                                        YoohTheme.TG.field
                                    }
                                }
                                .frame(width: 100, height: 100)
                                .clipShape(.rect(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("Отправить GIF"))
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }

    private func loadGifs(query: String) async {
        gifTask?.cancel()
        gifTask = Task {
            gifLoading = true
            defer { gifLoading = false }
            do {
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard !Task.isCancelled else { return }
                let items = query.trimmingCharacters(in: .whitespaces).isEmpty
                    ? try await GifService.shared.featured()
                    : try await GifService.shared.search(query)
                guard !Task.isCancelled else { return }
                gifs = items
            } catch {
                guard !Task.isCancelled else { return }
                if gifs.isEmpty {
                    do {
                        gifs = try await GifService.shared.featured()
                    } catch {
                        self.error = "Не удалось загрузить GIF."
                    }
                }
            }
        }
        await gifTask?.value
    }

    private func sendGif(_ item: GifItem) async {
        do {
            let data = try await GifService.shared.data(for: item)
            vm.upload(data: data, filename: "gif.gif", mimeType: "image/gif")
            Haptics.send()
            dismiss()
        } catch {
            self.error = "Не удалось отправить GIF."
        }
    }

    @ViewBuilder
    private func stickerThumb(_ item: StickerItem) -> some View {
        if let data = stickerData(item), let img = UIImage(data: data) {
            Image(uiImage: img)
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityLabel(Text(item.label ?? item.emoji ?? "Стикер"))
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
            error = "Не удалось загрузить стикер."
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
