import SwiftUI

/// Dense 76-pt dialog row: 60-pt avatar, bold title + gray time,
/// two-line gray preview, unread badge / pin / mute on the right.
struct ChatRowView: View {
    let chat: YoohChat
    let myUserId: String
    var isPinned = false
    var isMuted = false
    var isOnline = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: YoohTheme.Spacing.m) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: YoohTheme.Spacing.s) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .lineLimit(1)
                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(Text("Muted"))
                    }
                    Spacer()
                    Text(YoohDates.listTimestamp(chat.lastMessage?.createdAt ?? chat.updatedAt))
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                HStack(alignment: .top, spacing: YoohTheme.Spacing.s) {
                    Text(preview)
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer()
                    statusColumn
                }
            }
            .padding(.vertical, 10)
            }
            Divider()
                .background(Color(.separator).opacity(0.5))
                .padding(.leading, 76)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(preview)"))
    }

    // MARK: - Right status column (badge / pin / read state)

    @ViewBuilder
    private var statusColumn: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if chat.hasUnread(myUserId: myUserId) {
                Circle()
                    .fill(isMuted ? YoohTheme.TG.badgeMuted : YoohTheme.TG.badge)
                    .frame(width: 20, height: 20)
                    .overlay {
                        if isMuted {
                            Image(systemName: "bell.slash.fill")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .accessibilityLabel(Text("Unread messages"))
            } else if let m = chat.lastMessage, m.senderId == myUserId {
                Image(systemName: m.readByUserIds.contains(where: { $0 != myUserId }) ? "checkmark.circle.fill" : "checkmark.circle")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }
            if isPinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(minWidth: 22)
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
        return AvatarView(dataURL: url, name: title, size: 60, isOnline: online)
    }

    private var preview: String {
        guard let m = chat.lastMessage else { return chat.description }
        if let t = m.text, !t.isEmpty {
            let prefix = m.senderId == myUserId ? "You: " : senderPrefix(m)
            return prefix + t
        }
        switch m.type {
        case .file: return "File: \(m.file?.originalName ?? "attachment")"
        case .location: return "Location"
        case .poll: return "Poll: \(m.poll?.question ?? "")"
        case .call: return "Call"
        case .unknown: return ""
        case .text: return ""
        }
    }

    /// Sender name prefix for group previews (own color per user).
    private func senderPrefix(_ m: YoohMessage) -> String {
        guard chat.type != .direct else { return "" }
        if let name = m.sender?.displayName ?? m.sender?.username, !name.isEmpty {
            return "\(name): "
        }
        return ""
    }
}
