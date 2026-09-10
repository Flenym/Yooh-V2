import Foundation

/// HTTP method vocabulary used by the Yooh backend.
enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// One backend call: method + path + optional query + optional JSON body.
/// Every route below exists in `src/server/app.js` on master — no invented APIs.
struct APIEndpoint {
    var method: HTTPMethod = .get
    var path: String
    var query: [URLQueryItem] = []
    var jsonBody: (any Encodable)?
    /// Admin token (`x-admin-token`) instead of the user JWT. Used only
    /// by the optional Admin console; never mixed with user auth.
    var adminToken: String?

    var isIdempotent: Bool { method == .get }

    // MARK: - Health

    static var health: APIEndpoint {
        APIEndpoint(path: "/health")
    }

    // MARK: - Auth

    static func registerRequestCode(phone: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/auth/register/request-code",
                    jsonBody: ["phone": phone])
    }

    static func registerVerify(phone: String, code: String, displayName: String, username: String, device: DeviceInfo) -> APIEndpoint {
        struct Body: Encodable {
            let phone: String
            let code: String
            let displayName: String
            let username: String
            let device: DeviceInfo
        }
        return APIEndpoint(method: .post, path: "/api/auth/register/verify-code",
                           jsonBody: Body(phone: phone, code: code, displayName: displayName, username: username, device: device))
    }

    static func loginRequestCode(phone: String?, email: String?) -> APIEndpoint {
        struct Body: Encodable {
            let phone: String?
            let email: String?
            enum CodingKeys: String, CodingKey { case phone, email }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encodeIfPresent(phone, forKey: .phone)
                try c.encodeIfPresent(email, forKey: .email)
            }
        }
        return APIEndpoint(method: .post, path: "/api/auth/login/request-code",
                           jsonBody: Body(phone: phone, email: email))
    }

    static func loginVerify(phone: String?, email: String?, code: String, device: DeviceInfo) -> APIEndpoint {
        struct Body: Encodable {
            let phone: String?
            let email: String?
            let code: String
            let device: DeviceInfo
            enum CodingKeys: String, CodingKey { case phone, email, code, device }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encodeIfPresent(phone, forKey: .phone)
                try c.encodeIfPresent(email, forKey: .email)
                try c.encode(code, forKey: .code)
                try c.encode(device, forKey: .device)
            }
        }
        return APIEndpoint(method: .post, path: "/api/auth/login/verify-code",
                           jsonBody: Body(phone: phone, email: email, code: code, device: device))
    }

    static func loginVerifyCloudPassword(loginTicket: String, password: String) -> APIEndpoint {
        struct Body: Encodable { let loginTicket: String; let password: String }
        return APIEndpoint(method: .post, path: "/api/auth/login/verify-cloud-password",
                           jsonBody: Body(loginTicket: loginTicket, password: password))
    }

    static func setCloudPassword(_ password: String?) -> APIEndpoint {
        struct Body: Encodable { let password: String? }
        return APIEndpoint(method: .post, path: "/api/auth/cloud-password",
                           jsonBody: Body(password: password))
    }

    static var sessions: APIEndpoint {
        APIEndpoint(path: "/api/auth/sessions")
    }

    static func renameCurrentSession(_ name: String) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/auth/sessions/current",
                    jsonBody: ["name": name])
    }

    static var terminateOtherSessions: APIEndpoint {
        APIEndpoint(method: .post, path: "/api/auth/sessions/terminate-others")
    }

    static func deleteSession(_ id: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/auth/sessions/\(id)")
    }

    /// Authorizes another device's pending QR login (scan its QR code).
    static func linkDevice(token: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/auth/sessions/link-device",
                    jsonBody: ["token": token])
    }

    /// Creates a QR login token to display (another device scans it).
    static func qrCreate() -> APIEndpoint {
        struct Body: Encodable {
            let device: DeviceInfo
        }
        return APIEndpoint(method: .post, path: "/api/auth/qr/create",
                           jsonBody: Body(device: DeviceInfo.current()))
    }

    static func qrStatus(token: String) -> APIEndpoint {
        APIEndpoint(path: "/api/auth/qr/status",
                    query: [URLQueryItem(name: "token", value: token)])
    }

    // MARK: - Me

    static var me: APIEndpoint { APIEndpoint(path: "/api/me") }

    static var mySettings: APIEndpoint { APIEndpoint(path: "/api/me/settings") }

    static func patchSettings(_ section: [String: Any]) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/me/settings",
                    jsonBody: AnyEncodableMap(section))
    }

    static func patchProfile(_ fields: [String: Any]) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/me/profile",
                    jsonBody: AnyEncodableMap(fields))
    }

    static func usernameAvailability(_ username: String) -> APIEndpoint {
        APIEndpoint(path: "/api/me/username-availability",
                    query: [URLQueryItem(name: "username", value: username)])
    }

    // MARK: - Users & discovery

    static func searchUsers(query: String, botsOnly: Bool = false) -> APIEndpoint {
        var items = [URLQueryItem(name: "q", value: query)]
        if botsOnly { items.append(URLQueryItem(name: "bot", value: "1")) }
        return APIEndpoint(path: "/api/users/search", query: items)
    }

    static func discoverChats(query: String) -> APIEndpoint {
        APIEndpoint(path: "/api/chats/discovery",
                    query: [URLQueryItem(name: "q", value: query)])
    }

    // MARK: - Chats

    static var chats: APIEndpoint { APIEndpoint(path: "/api/chats") }

    static func createChat(_ fields: [String: Any]) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats",
                    jsonBody: AnyEncodableMap(fields))
    }

    static func joinChat(handle: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/join",
                    jsonBody: ["handle": handle])
    }

    static func patchChat(_ chatId: String, fields: [String: Any]) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/chats/\(chatId)",
                    jsonBody: AnyEncodableMap(fields))
    }

    static func deleteChat(_ chatId: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/chats/\(chatId)")
    }

    static func clearHistory(_ chatId: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/clear-history")
    }

    static func addMember(chatId: String, memberId: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/members",
                    jsonBody: ["memberId": memberId])
    }

    static func addBot(chatId: String, memberId: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/bots",
                    jsonBody: ["memberId": memberId])
    }

    static func setRole(chatId: String, memberId: String, role: String) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/chats/\(chatId)/members/\(memberId)",
                    jsonBody: ["role": role])
    }

    static func removeMember(chatId: String, memberId: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/chats/\(chatId)/members/\(memberId)")
    }

    // MARK: - Chat moderation (owner/admin)

    static func chatBan(chatId: String, userId: String, reason: String? = nil) -> APIEndpoint {
        struct Body: Encodable {
            let userId: String
            let reason: String?
            enum CodingKeys: String, CodingKey { case userId, reason }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(userId, forKey: .userId)
                try c.encodeIfPresent(reason, forKey: .reason)
            }
        }
        return APIEndpoint(method: .post, path: "/api/chats/\(chatId)/moderation/bans",
                           jsonBody: Body(userId: userId, reason: reason))
    }

    static func chatUnban(chatId: String, userId: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/chats/\(chatId)/moderation/bans/\(userId)")
    }

    static func chatMute(chatId: String, userId: String, reason: String? = nil) -> APIEndpoint {
        struct Body: Encodable {
            let userId: String
            let reason: String?
            enum CodingKeys: String, CodingKey { case userId, reason }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(userId, forKey: .userId)
                try c.encodeIfPresent(reason, forKey: .reason)
            }
        }
        return APIEndpoint(method: .post, path: "/api/chats/\(chatId)/moderation/mutes",
                           jsonBody: Body(userId: userId, reason: reason))
    }

    static func chatUnmute(chatId: String, userId: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/chats/\(chatId)/moderation/mutes/\(userId)")
    }

    // MARK: - Admin console (x-admin-token)

    static func adminStats(token: String) -> APIEndpoint {
        var e = APIEndpoint(path: "/api/admin/stats")
        e.adminToken = token
        return e
    }

    static func adminAuthCodes(token: String) -> APIEndpoint {
        var e = APIEndpoint(path: "/api/admin/auth-codes")
        e.adminToken = token
        return e
    }

    static func adminBroadcast(token: String, text: String) -> APIEndpoint {
        var e = APIEndpoint(method: .post, path: "/api/admin/system-bot/broadcast",
                            jsonBody: ["text": text])
        e.adminToken = token
        return e
    }

    // MARK: - Messages

    static func messages(chatId: String, limit: Int, before: String? = nil) -> APIEndpoint {
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { items.append(URLQueryItem(name: "before", value: before)) }
        return APIEndpoint(path: "/api/chats/\(chatId)/messages", query: items)
    }

    static func comments(chatId: String, limit: Int, before: String? = nil, threadRootId: String? = nil) -> APIEndpoint {
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { items.append(URLQueryItem(name: "before", value: before)) }
        if let threadRootId { items.append(URLQueryItem(name: "threadRootId", value: threadRootId)) }
        return APIEndpoint(path: "/api/chats/\(chatId)/comments", query: items)
    }

    static func sendMessage(chatId: String, body: SendMessageRequest, stream: MessageStream = .main) -> APIEndpoint {
        let leaf = stream == .comment ? "comments" : "messages"
        return APIEndpoint(method: .post, path: "/api/chats/\(chatId)/\(leaf)", jsonBody: body)
    }

    static func searchMessages(chatId: String, query: String, limit: Int = 20, stream: MessageStream = .main) -> APIEndpoint {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if stream == .comment {
            items.append(URLQueryItem(name: "stream", value: "comment"))
        }
        return APIEndpoint(path: "/api/chats/\(chatId)/messages/search", query: items)
    }

    static func scheduledMessages(chatId: String) -> APIEndpoint {
        APIEndpoint(path: "/api/chats/\(chatId)/messages/scheduled")
    }

    static func editMessage(chatId: String, messageId: String, text: String) -> APIEndpoint {
        APIEndpoint(method: .patch, path: "/api/chats/\(chatId)/messages/\(messageId)",
                    jsonBody: ["text": text])
    }

    static func deleteMessage(chatId: String, messageId: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/chats/\(chatId)/messages/\(messageId)")
    }

    static func toggleReaction(chatId: String, messageId: String, emoji: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/messages/\(messageId)/reactions",
                    jsonBody: ["emoji": emoji])
    }

    static func votePoll(chatId: String, messageId: String, optionIds: [String]) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/messages/\(messageId)/poll-vote",
                    jsonBody: ["optionIds": optionIds])
    }

    static func forwardMessage(chatId: String, messageId: String, targetChatId: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/chats/\(chatId)/messages/\(messageId)/forward",
                    jsonBody: ["targetChatId": targetChatId])
    }

    static func reportMessage(chatId: String, messageId: String, reason: String? = nil) -> APIEndpoint {
        struct Body: Encodable {
            let reason: String?
            enum CodingKeys: String, CodingKey { case reason }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encodeIfPresent(reason, forKey: .reason)
            }
        }
        return APIEndpoint(method: .post, path: "/api/chats/\(chatId)/messages/\(messageId)/report",
                           jsonBody: Body(reason: reason))
    }

    // MARK: - Stories

    static var stories: APIEndpoint { APIEndpoint(path: "/api/stories") }

    static func createStory(_ body: CreateStoryRequest) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/stories", jsonBody: body)
    }

    static func deleteStory(_ id: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/stories/\(id)")
    }

    static func viewStory(_ id: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/stories/\(id)/view")
    }

    static func reactToStory(_ id: String, emoji: String?) -> APIEndpoint {
        struct Body: Encodable {
            let emoji: String?
            enum CodingKeys: String, CodingKey { case emoji }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encodeIfPresent(emoji, forKey: .emoji)
            }
        }
        return APIEndpoint(method: .post, path: "/api/stories/\(id)/reaction",
                           jsonBody: Body(emoji: emoji))
    }

    // MARK: - Calls

    static func calls(limit: Int = 200) -> APIEndpoint {
        APIEndpoint(path: "/api/calls",
                    query: [URLQueryItem(name: "limit", value: String(limit))])
    }

    static func deleteCall(_ id: String) -> APIEndpoint {
        APIEndpoint(method: .delete, path: "/api/calls/\(id)")
    }

    static var webrtcConfig: APIEndpoint { APIEndpoint(path: "/api/webrtc/config") }

    // MARK: - Stickers

    static var stickerPacks: APIEndpoint { APIEndpoint(path: "/api/stickers/packs") }

    // MARK: - Feedback / support

    static func sendFeedback(category: String, message: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/feedback",
                    jsonBody: ["category": category, "message": message])
    }

    static var supportTicketState: APIEndpoint { APIEndpoint(path: "/api/support/ticket-state") }

    static func createSupportTicket(category: String) -> APIEndpoint {
        APIEndpoint(method: .post, path: "/api/support/tickets",
                    jsonBody: ["category": category])
    }
}

/// Main vs channel-comment stream.
enum MessageStream: String {
    case main, comment
}

/// Encodable wrapper for `[String: Any]` dictionaries (profile/settings/chat create bodies).
struct AnyEncodableMap: Encodable {
    let map: [String: Any]

    init(_ map: [String: Any]) { self.map = map }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: DynamicKey.self)
        for (key, value) in map {
            try c.encode(AnyEncodableValue(value), forKey: DynamicKey(stringValue: key))
        }
    }

    private struct DynamicKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

struct AnyEncodableValue: Encodable {
    let value: Any
    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as String: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as Bool: try c.encode(v)
        case let v as [String]: try c.encode(v)
        case let v as [Any]: try c.encode(v.map(AnyEncodableValue.init))
        case let v as [String: Any]: try c.encode(AnyEncodableMap(v))
        case is NSNull: try c.encodeNil()
        case Optional<Any>.none: try c.encodeNil()
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: encoder.codingPath,
                debugDescription: "Unsupported JSON value type: \(type(of: value))"))
        }
    }
}
