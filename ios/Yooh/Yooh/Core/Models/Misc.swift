import Foundation

// MARK: - Stories

enum StoryPrivacy: String, Codable {
    case everyone, contacts, selected
    case closeFriends = "close-friends"
    case unknown

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = StoryPrivacy(rawValue: (try? c.decode(String.self)) ?? "") ?? .unknown
    }
}

struct StoryViewer: Decodable {
    let userId: String?
    let viewedAt: String?
    let reaction: String?
}

struct LiveComment: Decodable, Identifiable {
    let id: String?
    let userId: String?
    let text: String?
    let stars: Int?
    let createdAt: String?
}

struct YoohStory: Decodable, Identifiable {
    let id: String
    let authorId: String?
    let author: PublicUser?
    let title: String?
    let caption: String?
    let avatar: String?
    let image: String?
    let video: String?
    let mediaType: String?
    let background: String?
    let privacy: StoryPrivacy?
    let disableScreenshots: Bool?
    let expiresHours: Int?
    let expiresAt: String?
    let saveToProfile: Bool?
    let isLive: Bool?
    let createdAt: String?
    let updatedAt: String?
    let viewers: [StoryViewer]?
    let liveComments: [LiveComment]?

    enum CodingKeys: String, CodingKey {
        case id, authorId, author, title, caption, avatar, image, video,
             mediaType, background, privacy, disableScreenshots, expiresHours,
             expiresAt, saveToProfile, isLive, createdAt, updatedAt,
             viewers, liveComments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        authorId = try c.decodeIfPresent(String.self, forKey: .authorId)
        author = try c.decodeIfPresent(PublicUser.self, forKey: .author)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        caption = try c.decodeIfPresent(String.self, forKey: .caption)
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        video = try c.decodeIfPresent(String.self, forKey: .video)
        mediaType = try c.decodeIfPresent(String.self, forKey: .mediaType)
        background = try c.decodeIfPresent(String.self, forKey: .background)
        privacy = try c.decodeIfPresent(StoryPrivacy.self, forKey: .privacy)
        disableScreenshots = try c.decodeIfPresent(Bool.self, forKey: .disableScreenshots)
        expiresHours = try c.decodeIfPresent(Int.self, forKey: .expiresHours)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
        saveToProfile = try c.decodeIfPresent(Bool.self, forKey: .saveToProfile)
        isLive = try c.decodeIfPresent(Bool.self, forKey: .isLive)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        viewers = try c.decodeIfPresent([StoryViewer].self, forKey: .viewers)
        liveComments = try c.decodeIfPresent([LiveComment].self, forKey: .liveComments)
    }
}

struct StoryListResponse: Decodable {
    let stories: [YoohStory]?

    enum CodingKeys: String, CodingKey { case stories }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stories = (try? c.decode([YoohStory].self, forKey: .stories)) ?? []
    }
}

struct SingleStoryResponse: Decodable {
    let story: YoohStory
}

struct CreateStoryRequest: Encodable {
    var title: String? = nil
    var caption: String? = nil
    var avatar: String? = nil
    var image: String? = nil
    var video: String? = nil
    var mediaType: String? = nil
    var background: String? = nil
    var privacy: String? = nil
    var expiresHours: Int? = nil
    var saveToProfile: Bool? = nil
    var isLive: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case title, caption, avatar, image, video, mediaType, background,
             privacy, expiresHours, saveToProfile, isLive
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(caption, forKey: .caption)
        try c.encodeIfPresent(avatar, forKey: .avatar)
        try c.encodeIfPresent(image, forKey: .image)
        try c.encodeIfPresent(video, forKey: .video)
        try c.encodeIfPresent(mediaType, forKey: .mediaType)
        try c.encodeIfPresent(background, forKey: .background)
        try c.encodeIfPresent(privacy, forKey: .privacy)
        try c.encodeIfPresent(expiresHours, forKey: .expiresHours)
        try c.encodeIfPresent(saveToProfile, forKey: .saveToProfile)
        try c.encodeIfPresent(isLive, forKey: .isLive)
    }
}

// MARK: - Calls

struct CallLog: Decodable, Identifiable {
    let id: String
    let chatId: String?
    let status: String?
    let mode: String?
    let durationSeconds: Int?
    let createdAt: String?
    let direction: String?
    let peer: PublicUser?
    let chat: CallChatRef?

    var isMissed: Bool {
        status == "no_answer" || status == "canceled"
    }
}

struct CallChatRef: Decodable {
    let id: String?
    let title: String?
    let type: String?
}

struct CallListResponse: Decodable {
    let calls: [CallLog]
}

// MARK: - Stickers

struct StickerItem: Decodable, Identifiable {
    var id: String { "\(emoji ?? "")-\(label ?? "")" }
    let emoji: String?
    let label: String?
    let image: String?
    let keywords: [String]?
}

struct StickerPack: Decodable, Identifiable {
    let id: String
    let title: String?
    let description: String?
    let coverEmoji: String?
    let stickers: [StickerItem]?
}

struct StickerPacksResponse: Decodable {
    let packs: [StickerPack]?

    enum CodingKeys: String, CodingKey { case packs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packs = (try? c.decode([StickerPack].self, forKey: .packs)) ?? []
    }
}

// MARK: - Users search

struct UserSearchResponse: Decodable {
    let users: [PublicUser]?
}

// MARK: - Support

struct SupportStateResponse: Decodable {
    struct Support: Decodable {
        let chatId: String?
        let ticket: SupportTicket?
    }
    let support: Support?
}

struct SupportTicket: Decodable {
    let id: String?
    let number: Int?
    let category: String?
    let createdAt: String?
    let updatedAt: String?
}

// MARK: - WebRTC config

struct WebRTCConfig: Decodable {
    let iceServers: [AnyCodable]?
}

// MARK: - Simple ACKs

struct DeletedResponse: Decodable {
    let deleted: Bool?
    let removed: Bool?
    let cleared: Bool?
    let messageId: String?
    let chatId: String?
    let removedMessages: Int?
    let callId: String?
    let storyId: String?
}
