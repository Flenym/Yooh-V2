import Foundation

/// Chats CRUD, members, roles and public discovery (`/api/chats/*`).
final class ChatService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func list() async throws -> [YoohChat] {
        let res: ChatListResponse = try await api.send(.chats)
        return res.chats
    }

    /// Creates a direct/group/channel/server chat. For `direct`, pass exactly
    /// one of memberId / memberUsername (server requirement).
    func create(type: String, title: String? = nil, description: String? = nil,
                memberIds: [String]? = nil, memberId: String? = nil,
                memberUsername: String? = nil, isPublic: Bool? = nil,
                handle: String? = nil) async throws -> YoohChat {
        var fields: [String: Any] = ["type": type]
        if let title { fields["title"] = title }
        if let description { fields["description"] = description }
        if let memberIds { fields["memberIds"] = memberIds }
        if let memberId { fields["memberId"] = memberId }
        if let memberUsername { fields["memberUsername"] = memberUsername }
        if let isPublic { fields["isPublic"] = isPublic }
        if let handle { fields["handle"] = handle }
        let res: SingleChatResponse = try await api.send(.createChat(fields))
        return res.chat
    }

    func join(handle: String) async throws -> YoohChat {
        let clean = handle.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let res: SingleChatResponse = try await api.send(.joinChat(handle: clean))
        return res.chat
    }

    func update(chatId: String, fields: [String: Any]) async throws -> YoohChat {
        let res: SingleChatResponse = try await api.send(.patchChat(chatId, fields: fields))
        return res.chat
    }

    func delete(chatId: String) async throws {
        struct Res: Decodable { let deleted: Bool? }
        let _: Res = try await api.send(.deleteChat(chatId))
    }

    @discardableResult
    func clearHistory(chatId: String) async throws -> Int {
        struct Res: Decodable { let cleared: Bool?; let removedMessages: Int? }
        let res: Res = try await api.send(.clearHistory(chatId))
        return res.removedMessages ?? 0
    }

    // MARK: - Members

    func addMember(chatId: String, memberId: String) async throws {
        struct Res: Decodable { let member: AnyCodable? }
        let _: Res = try await api.send(.addMember(chatId: chatId, memberId: memberId))
    }

    func addBot(chatId: String, memberId: String) async throws {
        struct Res: Decodable { let member: AnyCodable? }
        let _: Res = try await api.send(.addBot(chatId: chatId, memberId: memberId))
    }

    func setRole(chatId: String, memberId: String, role: String) async throws {
        struct Res: Decodable { let member: AnyCodable? }
        let _: Res = try await api.send(.setRole(chatId: chatId, memberId: memberId, role: role))
    }

    func removeMember(chatId: String, memberId: String) async throws {
        struct Res: Decodable { let removed: Bool? }
        let _: Res = try await api.send(.removeMember(chatId: chatId, memberId: memberId))
    }

    // MARK: - Discovery

    func discover(query: String) async throws -> [DiscoveredChat] {
        let res: DiscoveryResponse = try await api.send(.discoverChats(query: query))
        return res.chats
    }
}
