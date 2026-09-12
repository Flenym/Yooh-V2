import Foundation

// MARK: - Chat types

enum ChatType: String, Decodable {
    case direct, group, channel, server
    case unknown

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = ChatType(rawValue: (try? c.decode(String.self)) ?? "") ?? .unknown
    }
}

struct ChatSettings: Decodable {
    let reactionsEnabled: Bool?
    let commentsEnabled: Bool?
    let hideParticipants: Bool?
    let signMessages: Bool?
    let autoDeleteDays: Int?
    let allowMemberInvites: Bool?
    let wallpaperPreset: String?
    let slowModeSeconds: Int?
    let membersCanPost: Bool?

    private enum RootKeys: String, CodingKey {
        case reactionsEnabled, commentsEnabled, hideParticipants,
             signMessages, autoDeleteDays, allowMemberInvites,
             wallpaperPreset, permissions
    }
    private enum PermissionsKeys: String, CodingKey {
        case slowModeSeconds, sendMessages
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: RootKeys.self)
        reactionsEnabled = try c.decodeIfPresent(Bool.self, forKey: .reactionsEnabled)
        commentsEnabled = try c.decodeIfPresent(Bool.self, forKey: .commentsEnabled)
        hideParticipants = try c.decodeIfPresent(Bool.self, forKey: .hideParticipants)
        signMessages = try c.decodeIfPresent(Bool.self, forKey: .signMessages)
        autoDeleteDays = try c.decodeIfPresent(Int.self, forKey: .autoDeleteDays)
        allowMemberInvites = try c.decodeIfPresent(Bool.self, forKey: .allowMemberInvites)
        wallpaperPreset = try c.decodeIfPresent(String.self, forKey: .wallpaperPreset)
        if let perms = try? c.nestedContainer(keyedBy: PermissionsKeys.self, forKey: .permissions) {
            slowModeSeconds = try perms.decodeIfPresent(Int.self, forKey: .slowModeSeconds)
            membersCanPost = try perms.decodeIfPresent(Bool.self, forKey: .sendMessages)
        } else {
            slowModeSeconds = nil
            membersCanPost = nil
        }
    }
}

// MARK: - Hydrated chat (hydrateChatForUser)

struct YoohChat: Decodable, Identifiable, Hashable {
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

    static func == (lhs: YoohChat, rhs: YoohChat) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct ChatListResponse: Decodable {
    let chats: [YoohChat]
}

struct SingleChatResponse: Decodable {
    let chat: YoohChat
}

extension YoohChat {
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

    func hasUnread(myUserId: String) -> Bool {
        guard let m = lastMessage else { return false }
        return m.senderId != myUserId && !m.readByUserIds.contains(myUserId)
    }
}

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
