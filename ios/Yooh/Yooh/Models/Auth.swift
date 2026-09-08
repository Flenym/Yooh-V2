import Foundation

/// Minimal type-erased Codable value for passthrough server objects
/// (settings sections, business profile, extra payloads) whose exact
/// schema lives on the server and must survive round-trips untouched.
enum AnyCodable: Codable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([AnyCodable])
    case object([String: AnyCodable])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Int.self) { self = .int(v); return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([AnyCodable].self) { self = .array(v); return }
        if let v = try? c.decode([String: AnyCodable].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }
}

// MARK: - Auth payloads (mirror src/server/services/authService.js)

/// POST /api/auth/{register,login}/request-code → 200
struct OTPRequestResponse: Decodable {
    let ok: Bool?
    let phone: String?
    let target: String?
    let maskedTarget: String?
    let purpose: String?
    let channel: String?
    let delivery: String?
    let expiresAt: String?
    let expiresInSeconds: Int?
}

/// POST .../verify-code → 200, either a session or a 2FA challenge.
struct VerifyCodeResponse: Decodable {
    let token: String?
    let user: YoohUser?
    let requiresCloudPassword: Bool?
    let loginTicket: String?
    let expiresAt: String?
}

/// Device descriptor sent with auth calls. `platform: "iphone"` is
/// recognized by the server for session icons.
struct DeviceInfo: Encodable {
    var name: String
    var platform: String = "iphone"
    var client: String
    var userAgent: String?

    enum CodingKeys: String, CodingKey { case name, platform, client, userAgent }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(platform, forKey: .platform)
        try c.encode(client, forKey: .client)
        try c.encodeIfPresent(userAgent, forKey: .userAgent)
    }

    static func current() -> DeviceInfo {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        return DeviceInfo(
            name: Device.currentModelName,
            client: "Yooh iOS \(version)"
        )
    }
}

/// Auth session entry: GET /api/auth/sessions → { sessions: { current, others } }
struct AuthSession: Decodable, Identifiable {
    let id: String
    let name: String?
    let client: String?
    let location: String?
    let platform: String?
    let icon: String?
    let createdAt: String?
    let lastSeenAt: String?
    let isCurrent: Bool?
}

struct AuthSessionsResponse: Decodable {
    struct Box: Decodable {
        let current: AuthSession?
        let others: [AuthSession]?
    }
    let sessions: Box
}
