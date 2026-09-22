import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Message composer: text, replies, edits, attachments (photo/camera/file),
/// location, polls, scheduled sends and voice notes.
struct ComposerView: View {
    @Environment(AppState.self) private var app
    @Bindable var vm: ChatViewModel
    var onPoll: () -> Void

    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var showStickers = false
    @State private var showSchedule = false
    @State private var scheduleDate = Date().addingTimeInterval(3600)
    @State private var isLocating = false
    @State private var recorder = VoiceRecorder()

    var body: some View {
        VStack(spacing: 0) {
            if let reply = vm.replyTo {
                previewBar(title: "Ответ", text: reply.text ?? reply.file?.originalName ?? "Сообщение") {
                    vm.replyTo = nil
                }
            }
            if let edit = vm.editing {
                previewBar(title: "Редактирование", text: edit.text ?? "") {
                    vm.cancelEdit()
                }
            }
            if recorder.isRecording {
                recordingBar
            } else if let upload = vm.uploadState {
                HStack {
                    ProgressView()
                    Text("Загрузка \(upload)…").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, YoohTheme.Spacing.l)
                .padding(.vertical, 4)
            }

            HStack(alignment: .bottom, spacing: YoohTheme.Spacing.s) {
                Menu {
                    PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
                        Label("Фото или видео", systemImage: "photo")
                    }
                    Button { showCamera = true } label: {
                        Label("Камера", systemImage: "camera")
                    }
                    Button { showFiles = true } label: {
                        Label("Файл", systemImage: "doc")
                    }
                    Button { sendCurrentLocation() } label: {
                        Label("Геопозиция", systemImage: "location")
                    }
                    Button { onPoll() } label: {
                        Label("Опрос", systemImage: "chart.bar")
                    }
                    Button {
                        scheduleDate = Date().addingTimeInterval(3600)
                        showSchedule = true
                    } label: {
                        Label("Отложенное сообщение", systemImage: "clock")
                    }
                    .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 40, height: 40)
                }
                .yoohGlass(.interactive, cornerRadius: 20)
                .accessibilityLabel(Text("Прикрепить"))
                .disabled(isLocating)

                TextField("Сообщение", text: $vm.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, YoohTheme.Spacing.m)
                    .padding(.vertical, 10)
                    .background(YoohTheme.TG.field, in: .rect(cornerRadius: 20))
                    .onChange(of: vm.draft) {
                        app.sendTyping(chatId: vm.chatId, active: true)
                    }
                    .onSubmit { vm.send() }
                    .accessibilityLabel(Text("Текст сообщения"))

                Button {
                    Haptics.selection()
                    showStickers = true
                } label: {
                    Image(systemName: "face.smiling")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                }
                .accessibilityLabel(Text("Стикеры"))

                if vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, vm.editing == nil {
                    Button {
                        if recorder.isRecording {
                            if let url = recorder.stop(discard: false),
                               let data = try? Data(contentsOf: url)
                            {
                                vm.upload(data: data, filename: "voice.m4a", mimeType: "audio/mp4")
                            }
                        } else {
                            recorder.start()
                        }
                    } label: {
                        Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(recorder.isRecording ? .red : .primary)
                            .frame(width: 40, height: 40)
                    }
                    .yoohGlass(.interactive, cornerRadius: 20)
                    .accessibilityLabel(Text(recorder.isRecording ? "Отправить голосовое" : "Записать голосовое"))
                } else {
                    Button { vm.send() } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(ThemeStore.shared.accent, in: .circle)
                    }
                    .accessibilityLabel(Text(vm.editing == nil ? "Отправить" : "Сохранить"))
                }
            }
            .padding(.horizontal, YoohTheme.Spacing.s)
            .padding(.vertical, YoohTheme.Spacing.xs)
        }
        .padding(.horizontal, YoohTheme.Spacing.s)
        .padding(.bottom, YoohTheme.Spacing.s)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await uploadPhotoItem(item) }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                if let data = image.jpegData(compressionQuality: 0.85) {
                    vm.upload(data: data, filename: "photo.jpg", mimeType: "image/jpeg")
                }
            }
        }
        .sheet(isPresented: $showStickers) {
            StickerSheetView(vm: vm)
        }
        .sheet(isPresented: $showSchedule) {
            NavigationStack {
                Form {
                    Section("Сообщение") {
                        Text(vm.draft.isEmpty ? "(пусто)" : vm.draft)
                            .foregroundStyle(vm.draft.isEmpty ? .secondary : .primary)
                    }
                    Section("Отправить в") {
                        DatePicker("Дата и время", selection: $scheduleDate,
                                   in: Date().addingTimeInterval(60)...Date().addingTimeInterval(365 * 24 * 3600),
                                   displayedComponents: [.date, .hourAndMinute])
                    }
                    Button("Запланировать") {
                        showSchedule = false
                        vm.sendScheduled(text: vm.draft, at: scheduleDate)
                    }
                    .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .navigationTitle("Отложенное сообщение")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Отмена") { showSchedule = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result {
                Task { await uploadFileURL(url) }
            }
        }
    }

    private func uploadPhotoItem(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let isVideo = item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) })
        vm.upload(data: data,
                  filename: isVideo ? "video.mov" : "photo.jpg",
                  mimeType: isVideo ? "video/quicktime" : "image/jpeg")
    }

    private func uploadFileURL(_ url: URL) async {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let ext = url.pathExtension.lowercased()
        vm.upload(data: data, filename: url.lastPathComponent,
                  mimeType: mimeType(for: ext))
    }

    private func mimeType(for ext: String) -> String {
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "heic": return "image/heic"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "pdf": return "application/pdf"
        case "zip": return "application/zip"
        case "txt": return "text/plain"
        default: return "application/octet-stream"
        }
    }

    private func sendCurrentLocation() {
        isLocating = true
        Task {
            defer { isLocating = false }
            let provider = LocationProvider()
            do {
                let loc = try await provider.currentLocation()
                vm.sendLocation(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, title: nil)
            } catch {
                vm.showError("Не удалось получить геопозицию. Проверьте разрешение в настройках.")
            }
        }
    }

    private func previewBar(title: String, text: String, onCancel: @escaping () -> Void) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.bold()).foregroundStyle(ThemeStore.shared.accent)
                Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button(action: onCancel) {
                Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityLabel(Text("Отменить"))
        }
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.vertical, 4)
    }

    private var recordingBar: some View {
        HStack {
            Circle().fill(.red).frame(width: 8, height: 8)
            Text("Запись \(Int(recorder.elapsed)) с — нажмите на микрофон, чтобы отправить, ✕ — отменить")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button { _ = recorder.stop(discard: true) } label: {
                Image(systemName: "xmark").foregroundStyle(.secondary)
            }
            .accessibilityLabel(Text("Отменить запись"))
        }
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.vertical, 4)
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let vc = UIImagePickerController()
        vc.sourceType = .camera
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any])
        {
            if let img = info[.originalImage] as? UIImage { parent.onImage(img) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
