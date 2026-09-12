import Foundation

// MARK: - Message requests

struct MessageRequest: Decodable, Identifiable {
    let id: String
    let fromUserId: String?
    let toUserId: String?
    let text: String?
    let status: String?
    let createdAt: String?
    let user: PublicUser?

    enum CodingKeys: String, CodingKey {
        case id, fromUserId, toUserId, text, status, createdAt, user
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        fromUserId = try c.decodeIfPresent(String.self, forKey: .fromUserId)
        toUserId = try c.decodeIfPresent(String.self, forKey: .toUserId)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        user = try c.decodeIfPresent(PublicUser.self, forKey: .user)
    }
}

struct RequestsResponse: Decodable {
    let incoming: [MessageRequest]?
    let outgoing: [MessageRequest]?
}

struct RequestResult: Decodable {
    let accepted: Bool?
    let chat: YoohChat?
    let request: MessageRequest?
}

enum OpenDirectResult {
    case chat(YoohChat)
    case needsRequest(PublicUser)
}
