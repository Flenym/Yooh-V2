import Foundation

// MARK: - Message (see hydrateMessage in chatService.js)

enum MessageType: String, Decodable {
    case text, file, location, poll, call
    case unknown

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = MessageType(rawValue: (try? c.decode(String.self)) ?? "") ?? .unknown
    }
}

struct ReactionCount: Decodable, Hashable {
    let emoji: String
    let count: Int
    let mine: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        emoji = (try? c.decode(String.self, forKey: .emoji)) ?? ""
        count = (try? c.decode(Int.self, forKey: .count)) ?? 0
        mine = (try? c.decode(Bool.self, forKey: .mine)) ?? false
    }

    private enum CodingKeys: String, CodingKey { case emoji, count, mine }
}

struct Attachment: Decodable, Hashable {
    let id: String
    let originalName: String?
    let size: Int?
    let mimeType: String?
    let expiresAt: String?
}

struct MessageLocation: Decodable, Hashable {
    let lat: Double
    let lng: Double
    let title: String?
    let address: String?
    let mapUrl: String?
}

struct PollOption: Decodable, Hashable {
    let id: String
    let text: String?
    let count: Int
    let mine: Bool
}

struct Poll: Decodable {
    let question: String?
    let anonymous: Bool?
    let multiple: Bool?
    let quiz: Bool?
    let correctOptionId: String?
    let options: [PollOption]
    let totalVotes: Int
}

struct CallInfo: Decodable {
    let callerId: String?
    let calleeId: String?
    let mode: String?
    let status: String?
    let durationSeconds: Int?
}

struct ForwardRef: Decodable {
    let chatId: String?
    let messageId: String?
    let senderId: String?
}

struct ReplyRef: Decodable {
    let id: String?
    let stream: String?
    let type: String?
    let text: String?
    let file: Attachment?
    let sender: PublicUser?
    let deleted: Bool?
}

struct YoohMessage: Decodable, Identifiable {
    let id: String
    let chatId: String
    let senderId: String
    let type: MessageType
    let text: String?
    let clientMessageId: String?
    let fileId: String?
    let stream: String
    let threadRootId: String?
    let replyToMessageId: String?
    let replyTo: ReplyRef?
    let sender: PublicUser?
    let file: Attachment?
    var reactions: [ReactionCount]
    var readByUserIds: [String]
    let location: MessageLocation?
    let poll: Poll?
    let call: CallInfo?
    let forwardedFrom: ForwardRef?
    let editedAt: String?
    let updatedAt: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, chatId, senderId, type, text, clientMessageId, fileId, stream,
             threadRootId, replyToMessageId, replyTo, sender, file, reactions,
             readByUserIds, location, poll, call, forwardedFrom,
             editedAt, updatedAt, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        chatId = (try? c.decode(String.self, forKey: .chatId)) ?? ""
        senderId = (try? c.decode(String.self, forKey: .senderId)) ?? ""
        type = (try? c.decode(MessageType.self, forKey: .type)) ?? .unknown
        text = try c.decodeIfPresent(String.self, forKey: .text)
        clientMessageId = try c.decodeIfPresent(String.self, forKey: .clientMessageId)
        fileId = try c.decodeIfPresent(String.self, forKey: .fileId)
        stream = (try? c.decode(String.self, forKey: .stream)) ?? "main"
        threadRootId = try c.decodeIfPresent(String.self, forKey: .threadRootId)
        replyToMessageId = try c.decodeIfPresent(String.self, forKey: .replyToMessageId)
        replyTo = try c.decodeIfPresent(ReplyRef.self, forKey: .replyTo)
        sender = try c.decodeIfPresent(PublicUser.self, forKey: .sender)
        file = try c.decodeIfPresent(Attachment.self, forKey: .file)
        reactions = (try? c.decode([ReactionCount].self, forKey: .reactions)) ?? []
        readByUserIds = (try? c.decode([String].self, forKey: .readByUserIds)) ?? []
        location = try c.decodeIfPresent(MessageLocation.self, forKey: .location)
        poll = try c.decodeIfPresent(Poll.self, forKey: .poll)
        call = try c.decodeIfPresent(CallInfo.self, forKey: .call)
        forwardedFrom = try c.decodeIfPresent(ForwardRef.self, forKey: .forwardedFrom)
        editedAt = try c.decodeIfPresent(String.self, forKey: .editedAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }

    var isOutgoing: Bool = false // resolved client-side against current user id

    var isEdited: Bool { editedAt != nil && !(editedAt?.isEmpty ?? true) }

    /// Local optimistic message (replaced by the server echo via clientMessageId).
    init(localText text: String, chatId: String, senderId: String,
         stream: String = "main", replyToMessageId: String? = nil) {
        id = "local-\(UUID().uuidString)"
        self.chatId = chatId
        self.senderId = senderId
        type = .text
        self.text = text
        clientMessageId = UUID().uuidString
        fileId = nil
        self.stream = stream
        threadRootId = nil
        self.replyToMessageId = replyToMessageId
        replyTo = nil
        sender = nil
        file = nil
        reactions = []
        readByUserIds = [senderId]
        location = nil
        poll = nil
        call = nil
        forwardedFrom = nil
        editedAt = nil
        updatedAt = nil
        createdAt = YoohDates.isoNow()
        isOutgoing = true
    }
}

struct MessageListResponse: Decodable {
    let messages: [YoohMessage]
}

struct SingleMessageResponse: Decodable {
    let message: YoohMessage
}

// MARK: - Outgoing payloads (mirror zod schemas in chatService.js)

/// POST /api/chats/:id/messages (kind ∈ text|location|poll)
///
/// Encodes with `encodeIfPresent`: the server's zod schemas accept
/// *missing* optional keys but reject explicit `null`.
struct SendMessageRequest: Encodable {
    var text: String?
    var kind: String?
    var location: OutgoingLocation?
    var poll: OutgoingPoll?
    var replyToMessageId: String?
    var threadRootId: String?
    var clientMessageId: String?

    enum CodingKeys: String, CodingKey {
        case text, kind, location, poll, replyToMessageId, threadRootId, clientMessageId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(text, forKey: .text)
        try c.encodeIfPresent(kind, forKey: .kind)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(poll, forKey: .poll)
        try c.encodeIfPresent(replyToMessageId, forKey: .replyToMessageId)
        try c.encodeIfPresent(threadRootId, forKey: .threadRootId)
        try c.encodeIfPresent(clientMessageId, forKey: .clientMessageId)
    }

    static func text(_ text: String, replyToMessageId: String? = nil, clientMessageId: String = UUID().uuidString) -> SendMessageRequest {
        SendMessageRequest(text: text, replyToMessageId: replyToMessageId, clientMessageId: clientMessageId)
    }
}

struct OutgoingLocation: Encodable {
    var lat: Double
    var lng: Double
    var title: String?
    var address: String?
    var mapUrl: String?

    enum CodingKeys: String, CodingKey { case lat, lng, title, address, mapUrl }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(lat, forKey: .lat)
        try c.encode(lng, forKey: .lng)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(address, forKey: .address)
        try c.encodeIfPresent(mapUrl, forKey: .mapUrl)
    }
}

struct OutgoingPoll: Encodable {
    var question: String
    var options: [String]
    var anonymous: Bool?
    var multiple: Bool?
    var quiz: Bool?
    var correctOptionIndex: Int?

    enum CodingKeys: String, CodingKey {
        case question, options, anonymous, multiple, quiz, correctOptionIndex
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(question, forKey: .question)
        try c.encode(options, forKey: .options)
        try c.encodeIfPresent(anonymous, forKey: .anonymous)
        try c.encodeIfPresent(multiple, forKey: .multiple)
        try c.encodeIfPresent(quiz, forKey: .quiz)
        try c.encodeIfPresent(correctOptionIndex, forKey: .correctOptionIndex)
    }
}
