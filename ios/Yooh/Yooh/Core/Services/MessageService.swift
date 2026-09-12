import Foundation

/// Message history, search, scheduled, sending, edits, reactions, polls.
final class MessageService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func history(chatId: String, stream: MessageStream = .main,
                 limit: Int = AppConfig.messagePageSize, before: String? = nil) async throws -> [YoohMessage]
    {
        let endpoint: APIEndpoint = {
            switch stream {
            case .main: return .messages(chatId: chatId, limit: limit, before: before)
            case .comment: return .comments(chatId: chatId, limit: limit, before: before)
            }
        }()
        let res: MessageListResponse = try await api.send(endpoint)
        return res.messages
    }

    func search(chatId: String, query: String, stream: MessageStream = .main) async throws -> [YoohMessage] {
        let res: MessageListResponse = try await api.send(.searchMessages(chatId: chatId, query: query, stream: stream))
        return res.messages
    }

    func scheduled(chatId: String) async throws -> [YoohMessage] {
        let res: MessageListResponse = try await api.send(.scheduledMessages(chatId: chatId))
        return res.messages
    }

    func send(chatId: String, request: SendMessageRequest, stream: MessageStream = .main) async throws -> YoohMessage {
        let res: SingleMessageResponse = try await api.send(.sendMessage(chatId: chatId, body: request, stream: stream))
        return res.message
    }

    func sendText(chatId: String, text: String, replyToMessageId: String? = nil,
                  stream: MessageStream = .main) async throws -> YoohMessage
    {
        try await send(chatId: chatId,
                       request: .text(text, replyToMessageId: replyToMessageId),
                       stream: stream)
    }

    func sendPoll(chatId: String, poll: OutgoingPoll, stream: MessageStream = .main) async throws -> YoohMessage {
        var req = SendMessageRequest()
        req.kind = "poll"
        req.poll = poll
        req.clientMessageId = UUID().uuidString
        return try await send(chatId: chatId, request: req, stream: stream)
    }

    func sendLocation(chatId: String, location: OutgoingLocation,
                      stream: MessageStream = .main) async throws -> YoohMessage
    {
        var req = SendMessageRequest()
        req.kind = "location"
        req.location = location
        req.clientMessageId = UUID().uuidString
        return try await send(chatId: chatId, request: req, stream: stream)
    }

    func edit(chatId: String, messageId: String, text: String) async throws -> YoohMessage {
        let res: SingleMessageResponse = try await api.send(.editMessage(chatId: chatId, messageId: messageId, text: text))
        return res.message
    }

    func delete(chatId: String, messageId: String) async throws {
        struct Res: Decodable { let deleted: Bool? }
        let _: Res = try await api.send(.deleteMessage(chatId: chatId, messageId: messageId))
    }

    @discardableResult
    func toggleReaction(chatId: String, messageId: String, emoji: String) async throws -> YoohMessage {
        let res: SingleMessageResponse = try await api.send(.toggleReaction(chatId: chatId, messageId: messageId, emoji: emoji))
        return res.message
    }

    @discardableResult
    func votePoll(chatId: String, messageId: String, optionIds: [String]) async throws -> YoohMessage {
        let res: SingleMessageResponse = try await api.send(.votePoll(chatId: chatId, messageId: messageId, optionIds: optionIds))
        return res.message
    }

    func forward(messageId: String, fromChatId: String, targetChatId: String) async throws -> YoohMessage {
        let res: SingleMessageResponse = try await api.send(.forwardMessage(chatId: fromChatId, messageId: messageId, targetChatId: targetChatId))
        return res.message
    }

    func report(chatId: String, messageId: String, reason: String? = nil) async throws {
        struct Res: Decodable { let report: AnyCodable? }
        let _: Res = try await api.send(.reportMessage(chatId: chatId, messageId: messageId, reason: reason))
    }
}
