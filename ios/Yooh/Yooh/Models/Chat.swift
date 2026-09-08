import Foundation

// MARK: - Chat types

enum ChatType: String, Decodable {
    case direct, group, channel, server
    case unknown

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        let raw = (try? c.decode(String.self)) ?? ""
        self = ChatType(rawValue: raw) ?? .unknown
    }
}

/// Chat settings: large server-side object; decode only what the client
/// needs, keep the rest opaque for future use.
struct ChatSettings: Decodable {
    let reactionsEnabled: Bool?
    let commentsEnabled: Bool?
    let hideParticipants: Bool?
    let signMessages: Bool?
    let slowModeSeconds: Int?
    let autoDeleteDays: Int?

    private enum RootKeys: String, CodingKey {
        case reactionsEnabled, commentsEnabled, hideParticipants,
             signMessages, autoDeleteDays, permissions
    }
    private enum PermissionsKeys: String, CodingKey {
        case slowModeSeconds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: RootKeys.self)
        reactionsEnabled = try c.decodeIfPresent(Bool.self, forKey: .reactionsEnabled)
        commentsEnabled = try c.decodeIfPresent(Bool.self, forKey: .commentsEnabled)
        hideParticipants = try c.decodeIfPresent(Bool.self, forKey: .hideParticipants)
        signMessages = try c.decodeIfPresent(Bool.self, forKey: .signMessages)
        autoDeleteDays = try c.decodeIfPresent(Int.self, forKey: .autoDeleteDays)
        if let perms = try? c.nestedContainer(keyedBy: PermissionsKeys.self, forKey: .permissions) {
            slowModeSeconds = try perms.decodeIfPresent(Int.self, forKey: .slowModeSeconds)
        } else {
            slowModeSeconds = nil
        }
    }
}

// MARK: - Hydrated chat (GET /api/chats; see hydrateChatForUser)

struct YoohChat: Decodable, Identifiable {
    let id: String
    let type: ChatType
    let title: String?
    let description: String
    let avatar: String?
    let handle: String?
    let isPublic: Bool
    let settings: ChatSettings?
    let createdBy: String?
    let createdAt: String?
    let updatedAt: String?
    let myRole: String?
    let members: [ChatMember]
    let membersCount: Int
    let lastMessage: YoohMessage?

    enum CodingKeys: String, CodingKey {
        case id, type, title, description, avatar, handle, isPublic,
             settings, createdBy, createdAt, updatedAt, myRole,
             members, membersCount, lastMessage
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decodeIfPresent(ChatType.self, forKey: .type) ?? .unknown
        title = try c.decodeIfPresent(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        handle = try c.decodeIfPresent(String.self, forKey: .handle)
        isPublic = try c.decodeIfPresent(Bool.self, forKey: .isPublic) ?? false
        settings = try c.decodeIfPresent(ChatSettings.self, forKey: .settings)
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        myRole = try c.decodeIfPresent(String.self, forKey: .myRole)
        members = (try? c.decode([ChatMember].self, forKey: .members)) ?? []
        membersCount = try c.decodeIfPresent(Int.self, forKey: .membersCount) ?? members.count
        lastMessage = try c.decodeIfPresent(YoohMessage.self, forKey: .lastMessage)
    }
}

struct ChatListResponse: Decodable {
    let chats: [YoohChat]
}

/// Identity is the server id (for navigation/selection).
extension YoohChat: Hashable {
    static func == (lhs: YoohChat, rhs: YoohChat) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct SingleChatResponse: Decodable {
    let chat: YoohChat
}

// MARK: - Display helpers (client-side only)

extension YoohChat {
    /// Peer of a direct chat (the other participant).
    func peer(myUserId: String) -> ChatMember? {
        guard type == .direct else { return nil }
        return members.first(where: { $0.userId != myUserId }) ?? members.first
    }

    var displayTitle: String {
        if let t = title, !t.isEmpty { return t }
        if let h = handle, !h.isEmpty { return "@\(h)" }
        return "Chat"
    }

    var isChannel: Bool { type == .channel || type == .server }

    /// Unread heuristic: last message is foreign and doesn't include me in readByUserIds.
    func hasUnread(myUserId: String) -> Bool {
        guard let m = lastMessage else { return false }
        return m.senderId != myUserId && !m.readByUserIds.contains(myUserId)
    }
}

/// Public chat discovery entry (GET /api/chats/discovery).
struct DiscoveredChat: Decodable, Identifiable {
    let id: String
    let type: String?
    let title: String?
    let description: String?
    let handle: String?
    let isPublic: Bool?
    let joined: Bool?
    let membersCount: Int?
}

struct DiscoveryResponse: Decodable {
    let chats: [DiscoveredChat]
}
