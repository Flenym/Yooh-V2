import SwiftUI

/// One message bubble: text / file / location / poll / call, with reply
/// preview, forwarded mark, reactions, read state and context menu.
struct MessageBubbleView: View {
    @Environment(AppState.self) private var app
    let message: YoohMessage
    let vm: ChatViewModel

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 3) {
                if !message.isOutgoing, vm.chat.type != .direct {
                    Text(message.sender?.displayName ?? message.sender?.title ?? "")
                        .font(.caption.bold())
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }
                content
                    .padding(.horizontal, YoohTheme.Spacing.m)
                    .padding(.vertical, YoohTheme.Spacing.s)
                    .background(message.isOutgoing ? YoohTheme.Colors.outgoingBubble : YoohTheme.Colors.incomingBubble,
                                in: RoundedRectangle(cornerRadius: YoohTheme.Radius.l))
                    .foregroundStyle(message.isOutgoing ? YoohTheme.Colors.outgoingText : .primary)
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
                Label("Reply", systemImage: "arrowshape.turn.up.left")
            }
            if message.type == .text, !((message.text ?? "").isEmpty) {
                Button {
                    UIPasteboard.general.string = message.text
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
            }
            if message.isOutgoing, message.type == .text {
                Button { vm.beginEdit(message) } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            Button {
                // Forward sheet is presented by the parent from the
                // view-model-owned pending forward slot.
                vm.forwardTarget = message
            } label: {
                Label("Forward", systemImage: "arrowshape.turn.up.right")
            }
            Button(role: .destructive) { vm.delete(message) } label: {
                Label("Delete", systemImage: "trash")
            }
            Button { vm.report(message) } label: {
                Label("Report", systemImage: "flag")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityText))
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let fwd = message.forwardedFrom, fwd.chatId != nil || fwd.messageId != nil {
            Text("Forwarded")
                .font(.caption)
                .foregroundStyle(message.isOutgoing ? .white.opacity(0.8) : .secondary)
        }
        if let reply = message.replyTo, reply.deleted != true {
            VStack(alignment: .leading, spacing: 2) {
                Text(reply.sender?.displayName ?? reply.sender?.title ?? "")
                    .font(.caption.bold())
                Text(reply.text ?? (reply.file?.originalName ?? "Attachment"))
                    .font(.caption)
                    .lineLimit(2)
            }
            .padding(.leading, YoohTheme.Spacing.s)
            .overlay(alignment: .leading) {
                Capsule().fill(message.isOutgoing ? .white.opacity(0.7) : Color.accentColor).frame(width: 2)
            }
            .padding(.bottom, 2)
        }
        switch message.type {
        case .text:
            Text(message.text ?? "")
                .font(YoohTheme.Fonts.message)
                .textSelection(.enabled)
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
            Text(message.text ?? "")
                .font(YoohTheme.Fonts.message)
        }
    }

    private var callText: String {
        let status = message.call?.status ?? ""
        switch status {
        case "completed": return "Call ended"
        case "canceled": return "Call canceled"
        case "busy": return "Busy"
        default: return "Missed call"
        }
    }

    private var metaRow: some View {
        HStack(spacing: 4) {
            if message.isEdited {
                Text("edited")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(YoohDates.bubbleTime(message.createdAt))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if message.isOutgoing {
                Image(systemName: isRead ? "checkmark.circle.fill" : "checkmark.circle")
                    .font(.caption2)
                    .foregroundStyle(isRead ? Color.accentColor : .secondary)
                    .accessibilityLabel(Text(isRead ? "Read" : "Sent"))
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
                        .background(r.mine ? Color.accentColor.opacity(0.2) : Color(.tertiarySystemFill),
                                    in: .capsule)
                }
                .buttonStyle(.plain)
            }
            Button {
                vm.react(message, emoji: "❤️")
            } label: {
                Image(systemName: "plus")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Add reaction"))
        }
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if message.isOutgoing { parts.append("You") }
        else if let s = message.sender?.title { parts.append(s) }
        parts.append(message.text ?? message.file?.originalName ?? message.poll?.question ?? "Message")
        parts.append(YoohDates.bubbleTime(message.createdAt))
        return parts.joined(separator: ". ")
    }
}

// MARK: - File content

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
                VoicePlayerView(fileId: fileId)
            }
            Button {
                Task { await prepareShare() }
            } label: {
                HStack {
                    Image(systemName: icon)
                        .font(.title3)
                    VStack(alignment: .leading) {
                        Text(message.file?.originalName ?? "File")
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
                Text(text).font(YoohTheme.Fonts.message)
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
    private var isAudio: Bool { mime.hasPrefix("audio/") || (message.file?.originalName.hasSuffix(".m4a") ?? false) }
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
            // Share failure is non-fatal; the row stays usable.
        }
    }
}

// MARK: - Location content

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
                    Text(message.location?.title ?? "Location")
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

// MARK: - Poll content

private struct PollContentView: View {
    let message: YoohMessage
    let vm: ChatViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: YoohTheme.Spacing.s) {
            Text(message.poll?.question ?? "Poll")
                .font(.subheadline.bold())
            if let poll = message.poll {
                ForEach(poll.options, id: \.id) { opt in
                    Button {
                        vm.vote(message, optionIds: [opt.id])
                    } label: {
                        HStack {
                            Text(opt.text ?? "")
                                .font(.subheadline)
                            Spacer()
                            if !poll.anonymous {
                                Text("\(opt.count)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if opt.mine {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Vote for \(opt.text ?? "option")"))
                }
                Text("\(poll.totalVotes) votes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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
