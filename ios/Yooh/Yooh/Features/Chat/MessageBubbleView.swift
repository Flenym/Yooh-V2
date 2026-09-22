import SwiftUI

/// One message bubble: text / file / location / poll / call, with reply
/// preview, forwarded mark, reactions, read state, translate and context menu.
struct MessageBubbleView: View {
    @Environment(AppState.self) private var app
    let message: YoohMessage
    let vm: ChatViewModel

    @State private var showTranslation = false

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 3) {
                if !message.isOutgoing, vm.chat.type != .direct {
                    Text(message.sender?.displayName ?? message.sender?.title ?? "")
                        .font(.caption.bold())
                        .foregroundStyle(YoohTheme.TG.senderColor(for: message.senderId))
                        .lineLimit(1)
                }
                content
                    .padding(.horizontal, YoohTheme.Spacing.m)
                    .padding(.vertical, YoohTheme.Spacing.s)
                    .background(message.isOutgoing ? YoohTheme.TG.outgoing : YoohTheme.TG.incoming,
                                in: RoundedRectangle(cornerRadius: YoohTheme.Radius.l))
                    .overlay {
                        if message.isOutgoing {
                            RoundedRectangle(cornerRadius: YoohTheme.Radius.l)
                                .stroke(YoohTheme.TG.outgoingBorder, lineWidth: 1)
                        }
                    }
                    .foregroundStyle(.primary)
                metaRow
                if !message.reactions.isEmpty {
                    reactionsRow
                }
            }
            .frame(maxWidth: YoohTheme.Layout.maxBubbleWidth, alignment: message.isOutgoing ? .trailing : .leading)
            if !message.isOutgoing { Spacer(minLength: 48) }
        }
        .contextMenu {
            Button { vm.replyTo = message } label: {
                Label("Ответить", systemImage: "arrowshape.turn.up.left")
            }
            if message.type == .text, !((message.text ?? "").isEmpty) {
                Button {
                    UIPasteboard.general.string = message.text
                } label: {
                    Label("Копировать", systemImage: "doc.on.doc")
                }
                if #available(iOS 18, *) {
                    Button {
                        showTranslation = true
                    } label: {
                        Label("Перевести", systemImage: "character.book.closed")
                    }
                }
            }
            if message.isOutgoing, message.type == .text {
                Button { vm.beginEdit(message) } label: {
                    Label("Изменить", systemImage: "pencil")
                }
            }
            Button {
                vm.forwardTarget = message
            } label: {
                Label("Переслать", systemImage: "arrowshape.turn.up.right")
            }
            Button {
                vm.togglePin(message)
            } label: {
                Label(vm.isPinned(message) ? "Открепить" : "Закрепить", systemImage: "pin")
            }
            Button(role: .destructive) { vm.delete(message) } label: {
                Label(vm.chat.type == .direct ? "Удалить у всех" : "Удалить", systemImage: "trash")
            }
            Button { vm.report(message) } label: {
                Label("Пожаловаться", systemImage: "flag")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityText))
        .translateSheet(isPresented: $showTranslation, text: message.text ?? "")
    }

    @ViewBuilder
    private var content: some View {
        if let fwd = message.forwardedFrom, fwd.chatId != nil || fwd.messageId != nil {
            Text("Переслано")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if let reply = message.replyTo, reply.deleted != true {
            VStack(alignment: .leading, spacing: 2) {
                Text(reply.sender?.displayName ?? reply.sender?.title ?? "")
                    .font(.caption.bold())
                Text(reply.text ?? (reply.file?.originalName ?? "Вложение"))
                    .font(.caption)
                    .lineLimit(2)
            }
            .padding(.leading, YoohTheme.Spacing.s)
            .overlay(alignment: .leading) {
                Capsule().fill(ThemeStore.shared.accent).frame(width: 2)
            }
            .padding(.bottom, 2)
        }
        switch message.type {
        case .text:
            richText(message.text ?? "")
        case .file:
            FileContentView(message: message)
        case .location:
            LocationContentView(message: message)
        case .poll:
            PollContentView(message: message, vm: vm)
        case .call:
            HStack(spacing: YoohTheme.Spacing.s) {
                Image(systemName: "phone.fill")
                Text(callText)
                    .font(.subheadline)
            }
        case .unknown:
            richText(message.text ?? "")
        }
    }

    /// Body text with tappable http(s) links (AttributedString, no WebView).
    private func richText(_ raw: String) -> some View {
        Text(linkAttributed(raw))
            .font(.system(size: 17 * ThemeStore.shared.fontScale))
            .textSelection(.enabled)
    }

    private func linkAttributed(_ raw: String) -> AttributedString {
        var out = AttributedString(raw)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return out
        }
        let ns = raw as NSString
        for m in detector.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            if let url = m.url, let range = Range(m.range, in: raw),
               let attrRange = out.range(of: String(raw[range]))
            {
                out[attrRange].link = url
                out[attrRange].foregroundColor = ThemeStore.shared.accent
                out[attrRange].underlineStyle = .single
            }
        }
        return out
    }

    private var callText: String {
        let status = message.call?.status ?? ""
        switch status {
        case "completed": return "Звонок завершён"
        case "canceled": return "Звонок отменён"
        case "busy": return "Занято"
        default: return "Пропущенный звонок"
        }
    }

    private var metaRow: some View {
        HStack(spacing: 4) {
            if message.isEdited {
                Text("изм.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(YoohDates.bubbleTime(message.createdAt))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if message.isOutgoing {
                Image(systemName: isRead ? "checkmark.circle.fill" : "checkmark.circle")
                    .font(.caption2)
                    .foregroundStyle(isRead ? YoohTheme.TG.checksRead : YoohTheme.TG.checksSent)
                    .accessibilityLabel(Text(isRead ? "Прочитано" : "Отправлено"))
            }
        }
    }

    private var isRead: Bool {
        message.readByUserIds.contains(where: { $0 != message.senderId })
    }

    private var reactionsRow: some View {
        HStack(spacing: YoohTheme.Spacing.xs) {
            ForEach(message.reactions, id: \.emoji) { r in
                Button {
                    vm.react(message, emoji: r.emoji)
                } label: {
                    Text("\(r.emoji) \(r.count)")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(r.mine ? ThemeStore.shared.accent.opacity(0.25) : Color(.tertiarySystemFill),
                                    in: .capsule)
                }
                .buttonStyle(.plain)
            }
            Menu {
                ForEach(["❤️", "👍", "😮", "😢", "🔥", "👏", "🎉", "👎"], id: \.self) { emoji in
                    Button {
                        vm.react(message, emoji: emoji)
                        Haptics.selection()
                    } label: {
                        Text(emoji)
                    }
                }
            } label: {
                Image(systemName: "plus")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill), in: .capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Добавить реакцию"))
        }
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if message.isOutgoing { parts.append("Вы") }
        else if let s = message.sender?.title { parts.append(s) }
        parts.append(message.text ?? message.file?.originalName ?? message.poll?.question ?? "Сообщение")
        parts.append(YoohDates.bubbleTime(message.createdAt))
        return parts.joined(separator: ". ")
    }
}

private struct FileContentView: View {
    @Environment(AppState.self) private var app
    let message: YoohMessage

    @State private var shareURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: YoohTheme.Spacing.s) {
            if isImage, let fileId = message.file?.id {
                CachedFileImage(fileId: fileId, token: app.session.token, height: 180)
                    .clipShape(.rect(cornerRadius: YoohTheme.Radius.m))
            } else if isAudio, let fileId = message.file?.id {
                VoicePlayerView(fileId: fileId, token: app.session.token)
                TranscribeButton(fileId: fileId)
            }
            Button {
                Task { await prepareShare() }
            } label: {
                HStack {
                    Image(systemName: icon)
                        .font(.title3)
                    VStack(alignment: .leading) {
                        Text(message.file?.originalName ?? "Файл")
                            .font(.subheadline)
                            .lineLimit(2)
                        if let size = message.file?.size {
                            Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Image(systemName: "square.and.arrow.up")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            if let text = message.text, !text.isEmpty {
                Text(text).font(.system(size: 17 * ThemeStore.shared.fontScale))
            }
        }
        .sheet(isPresented: Binding(
            get: { shareURL != nil },
            set: { if !$0 { shareURL = nil } }
        )) {
            if let shareURL {
                ShareSheet(url: shareURL)
            }
        }
    }

    private var mime: String { message.file?.mimeType ?? "" }
    private var isImage: Bool { mime.hasPrefix("image/") }
    private var isAudio: Bool { mime.hasPrefix("audio/") || (message.file?.originalName?.hasSuffix(".m4a") ?? false) }
    private var icon: String {
        if mime.hasPrefix("video/") { return "video.fill" }
        if isAudio { return "waveform" }
        if mime.hasPrefix("image/") { return "photo.fill" }
        return "doc.fill"
    }

    private func prepareShare() async {
        guard let fileId = message.file?.id, let token = app.session.token else { return }
        do {
            let data = try await MediaService().downloadData(fileId: fileId, inline: false, token: token)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(message.file?.originalName ?? fileId)
            try data.write(to: url, options: .atomic)
            shareURL = url
        } catch {
            // Non-fatal; the row stays usable.
        }
    }
}

private struct LocationContentView: View {
    let message: YoohMessage

    var body: some View {
        Button {
            openMaps()
        } label: {
            HStack {
                Image(systemName: "mappin.circle.fill")
                    .font(.title2)
                VStack(alignment: .leading) {
                    Text(message.location?.title ?? "Геопозиция")
                        .font(.subheadline.bold())
                    if let addr = message.location?.address, !addr.isEmpty {
                        Text(addr).font(.caption).lineLimit(2)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func openMaps() {
        guard let loc = message.location else { return }
        if let raw = loc.mapUrl, let url = URL(string: raw) {
            UIApplication.shared.open(url)
            return
        }
        var c = URLComponents(string: "https://maps.apple.com/")!
        c.queryItems = [URLQueryItem(name: "ll", value: "\(loc.lat),\(loc.lng)")]
        if let url = c.url { UIApplication.shared.open(url) }
    }
}

private struct PollContentView: View {
    let message: YoohMessage
    let vm: ChatViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: YoohTheme.Spacing.s) {
            HStack(spacing: 6) {
                Text(message.poll?.question ?? "Опрос")
                    .font(.subheadline.bold())
                if message.poll?.quiz == true {
                    Text("Викторина")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(ThemeStore.shared.accent, in: .capsule)
                        .accessibilityLabel(Text("Опрос-викторина"))
                }
            }
            if let poll = message.poll {
                ForEach(poll.options, id: \.id) { opt in
                    Button {
                        vm.vote(message, optionIds: [opt.id])
                    } label: {
                        HStack {
                            Text(opt.text ?? "")
                                .font(.subheadline)
                            Spacer()
                            if poll.anonymous != true {
                                Text("\(opt.count)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if poll.correctOptionId == opt.id {
                                Image(systemName: "checkmark.seal.fill")
                                    .foregroundStyle(.green)
                                    .accessibilityLabel(Text("Правильный ответ"))
                            } else if opt.mine {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(ThemeStore.shared.accent)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Голосовать: \(opt.text ?? "вариант")"))
                }
                Text("\(poll.totalVotes) votes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct TranscribeButton: View {
    @Environment(AppState.self) private var app
    let fileId: String

    @State private var transcript: String?
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if transcript == nil, error == nil {
                Button {
                    Task { await transcribe() }
                } label: {
                    HStack(spacing: 4) {
                        if isWorking {
                            ProgressView().controlSize(.small)
                        }
                        Text("Распознать")
                            .font(.caption)
                            .foregroundStyle(ThemeStore.shared.accent)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isWorking)
                .accessibilityLabel(Text("Распознать голосовое сообщение"))
            }
            if let transcript {
                Text(transcript)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func transcribe() async {
        guard let token = app.session.token else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let url = try await AudioFileCache.shared.localURL(fileId: fileId, token: token)
            let text = try await SpeechTranscriber.transcribe(url: url)
            transcript = text.isEmpty ? "(no speech detected)" : text
            Haptics.selection()
        } catch {
            self.error = "Не удалось распознать сообщение."
        }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
