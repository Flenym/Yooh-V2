import SwiftUI

/// One row in the chat list: avatar, title, preview, time, unread, mute.
struct ChatRowView: View {
    let chat: YoohChat
    let myUserId: String
    var isPinned = false
    var isMuted = false
    var isOnline = false

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            avatar
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(title)
                        .font(YoohTheme.Type.chatTitle)
                        .lineLimit(1)
                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(Text("Muted"))
                    }
                    Spacer()
                    Text(YoohDates.listTimestamp(chat.lastMessage?.createdAt ?? chat.updatedAt))
                        .font(YoohTheme.Type.timestamp)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text(preview)
                        .font(YoohTheme.Type.chatPreview)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer()
                    if chat.hasUnread(myUserId: myUserId) {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 10, height: 10)
                            .accessibilityLabel(Text("Unread messages"))
                    } else if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, YoohTheme.Spacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(preview)"))
    }

    private var peer: ChatMember? {
        chat.peer(myUserId: myUserId)
    }

    private var title: String {
        if chat.type == .direct, let p = peer {
            if let d = p.displayName, !d.isEmpty { return d }
            if let u = p.username, !u.isEmpty { return "@\(u)" }
        }
        return chat.displayTitle
    }

    private var avatar: some View {
        let url: String? = chat.type == .direct ? (peer?.avatar ?? chat.avatar) : chat.avatar
        let online = chat.type == .direct && isOnline
        return AvatarView(dataURL: url, name: title, size: YoohTheme.Layout.avatarM, isOnline: online)
    }

    private var preview: String {
        guard let m = chat.lastMessage else { return chat.description }
        if let t = m.text, !t.isEmpty {
            let prefix = m.senderId == myUserId ? "You: " : ""
            return prefix + t
        }
        switch m.type {
        case .file: return "📎 \(m.file?.originalName ?? "File")"
        case .location: return "📍 Location"
        case .poll: return "📊 \(m.poll?.question ?? "Poll")"
        case .call: return "📞 Call"
        case .unknown: return ""
        case .text: return ""
        }
    }
}
