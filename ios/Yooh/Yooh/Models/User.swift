import Foundation

// MARK: - SafeUser (GET /api/me, verify-code; see authService.js toSafeUser)

/// Full own-user object. Unknown future keys are ignored on decode.
struct YoohUser: Decodable {
    let id: String
    let chatId: String
    let phone: String
    let username: String
    let displayName: String
    let about: String
    let avatar: String
    let banner: String
    let locale: String
    let createdAt: String?
    let settings: [String: AnyCodable]?
    let cloudPasswordEnabled: Bool
    let isBot: Bool
    let isSystemBot: Bool
    let isPremium: Bool
    let premiumUntil: String?
    let starsBalance: Int
    let starsEarned: Int
    let emojiStatus: String
    let premiumBadge: PremiumBadge?
    let feedbackBlocked: Bool
    let sessionId: String?

    enum CodingKeys: String, CodingKey {
        case id, chatId, phone, username, displayName, about, avatar, banner,
             locale, createdAt, settings, cloudPasswordEnabled, isBot,
             isSystemBot, isPremium, premiumUntil, starsBalance, starsEarned,
             emojiStatus, premiumBadge, feedbackBlocked, sessionId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        chatId = try c.decode(String.self, forKey: .chatId)
        phone = try c.decode(String.self, forKey: .phone)
        username = try c.decode(String.self, forKey: .username)
        displayName = try c.decode(String.self, forKey: .displayName)
        about = try c.decodeIfPresent(String.self, forKey: .about) ?? ""
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar) ?? ""
        banner = try c.decodeIfPresent(String.self, forKey: .banner) ?? ""
        locale = try c.decodeIfPresent(String.self, forKey: .locale) ?? "en"
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        settings = try c.decodeIfPresent([String: AnyCodable].self, forKey: .settings)
        cloudPasswordEnabled = try c.decodeIfPresent(Bool.self, forKey: .cloudPasswordEnabled) ?? false
        isBot = try c.decodeIfPresent(Bool.self, forKey: .isBot) ?? false
        isSystemBot = try c.decodeIfPresent(Bool.self, forKey: .isSystemBot) ?? false
        isPremium = try c.decodeIfPresent(Bool.self, forKey: .isPremium) ?? false
        premiumUntil = try c.decodeIfPresent(String.self, forKey: .premiumUntil)
        starsBalance = try c.decodeIfPresent(Int.self, forKey: .starsBalance) ?? 0
        starsEarned = try c.decodeIfPresent(Int.self, forKey: .starsEarned) ?? 0
        emojiStatus = try c.decodeIfPresent(String.self, forKey: .emojiStatus) ?? ""
        premiumBadge = try c.decodeIfPresent(PremiumBadge.self, forKey: .premiumBadge)
        feedbackBlocked = try c.decodeIfPresent(Bool.self, forKey: .feedbackBlocked) ?? false
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
    }
}

struct PremiumBadge: Codable {
    let type: String?
    let star: String?
    let svg: String?
    let photo: String?
    let bgColor: String?
    let size: Int?
    let offsetX: Int?
    let offsetY: Int?
}

// MARK: - Public user (senders, members, fromUser in realtime)

/// Shape varies slightly per context (sender/member/fromUser), so every
/// field except `id` is optional/tolerant.
struct PublicUser: Decodable, Identifiable, Hashable {
    let id: String
    let chatId: String?
    let username: String?
    let displayName: String?
    let avatar: String?
    let about: String?
    let isBot: Bool
    let isSystemBot: Bool
    let isPremium: Bool
    let premiumBadge: PremiumBadge?
    let privacy: [String: AnyCodable]?
    let role: String?

    enum CodingKeys: String, CodingKey {
        case id, chatId, username, displayName, avatar, about,
             isBot, isSystemBot, isPremium, premiumBadge, privacy, role
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        chatId = try c.decodeIfPresent(String.self, forKey: .chatId)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        about = try c.decodeIfPresent(String.self, forKey: .about)
        isBot = try c.decodeIfPresent(Bool.self, forKey: .isBot) ?? false
        isSystemBot = try c.decodeIfPresent(Bool.self, forKey: .isSystemBot) ?? false
        isPremium = try c.decodeIfPresent(Bool.self, forKey: .isPremium) ?? false
        premiumBadge = try c.decodeIfPresent(PremiumBadge.self, forKey: .premiumBadge)
        privacy = try c.decodeIfPresent([String: AnyCodable].self, forKey: .privacy)
        role = try c.decodeIfPresent(String.self, forKey: .role)
    }

    /// Client-side presence, fed by `presence:snapshot` / `presence:update`.
    /// Never decoded from REST.
    var isOnline: Bool = false

    var title: String {
        if let d = displayName, !d.isEmpty { return d }
        if let u = username, !u.isEmpty { return "@\(u)" }
        return "Yooh user"
    }

    static func == (lhs: PublicUser, rhs: PublicUser) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Member entry inside a hydrated chat (public user + role).
struct ChatMember: Decodable, Identifiable {
    var id: String { userId }
    let userId: String
    let chatId: String?
    let username: String?
    let displayName: String?
    let avatar: String?
    let about: String?
    let isBot: Bool
    let isSystemBot: Bool
    let isPremium: Bool
    let premiumBadge: PremiumBadge?
    let role: String?

    enum CodingKeys: String, CodingKey {
        case userId, chatId, username, displayName, avatar, about,
             isBot, isSystemBot, isPremium, premiumBadge, role
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        chatId = try c.decodeIfPresent(String.self, forKey: .chatId)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        about = try c.decodeIfPresent(String.self, forKey: .about)
        isBot = try c.decodeIfPresent(Bool.self, forKey: .isBot) ?? false
        isSystemBot = try c.decodeIfPresent(Bool.self, forKey: .isSystemBot) ?? false
        isPremium = try c.decodeIfPresent(Bool.self, forKey: .isPremium) ?? false
        premiumBadge = try c.decodeIfPresent(PremiumBadge.self, forKey: .premiumBadge)
        role = try c.decodeIfPresent(String.self, forKey: .role)
    }
}
