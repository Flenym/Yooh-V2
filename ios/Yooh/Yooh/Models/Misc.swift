import Foundation

// MARK: - Calls (GET /api/calls → { calls: [...] })

/// Call history entry. Signaling itself runs over Socket.IO (see YoohSocket);
/// media requires a WebRTC engine (explicit TODO, see CallService).
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
    var id: String { "\(emoji)-\(label ?? "")-\(image?.prefix(16) ?? "")" }
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

// MARK: - Users search / misc

struct UserSearchResponse: Decodable {
    let users: [PublicUser]?
}

struct UserSearchUser: Decodable, Identifiable {
    let id: String
    let chatId: String?
    let username: String?
    let displayName: String?
    let avatar: String?
    let about: String?
    let isPremium: Bool?
    let isBot: Bool?
}

// MARK: - Support / feedback

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

// MARK: - WebRTC config (GET /api/webrtc/config)

struct WebRTCConfig: Decodable {
    let iceServers: [AnyCodable]?
}

// MARK: - Simple ACKs

struct SimpleOK: Decodable {
    let ok: Bool?
}

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
