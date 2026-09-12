import Foundation

// MARK: - SafeUser (toSafeUser in authService.js)

struct YoohUser: Decodable {
    let id: String
    let chatId: String
    let phone: String
    let username: String
    let displayName: String
    let about: String
    let avatar: String
    let banner: String
    let birthday: String
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
             birthday, locale, createdAt, settings, cloudPasswordEnabled, isBot,
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
        birthday = try c.decodeIfPresent(String.self, forKey: .birthday) ?? ""
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

// MARK: - Public user (senders, members, search)

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
    var isOnline: Bool = false

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

    var title: String {
        if let d = displayName, !d.isEmpty { return d }
        if let u = username, !u.isEmpty { return "@\(u)" }
        return "Yooh user"
    }

    init(id: String, chatId: String? = nil, username: String? = nil,
         displayName: String? = nil, avatar: String? = nil, about: String? = nil,
         isBot: Bool = false, isSystemBot: Bool = false, isPremium: Bool = false,
         premiumBadge: PremiumBadge? = nil, privacy: [String: AnyCodable]? = nil,
         role: String? = nil)
    {
        self.id = id
        self.chatId = chatId
        self.username = username
        self.displayName = displayName
        self.avatar = avatar
        self.about = about
        self.isBot = isBot
        self.isSystemBot = isSystemBot
        self.isPremium = isPremium
        self.premiumBadge = premiumBadge
        self.privacy = privacy
        self.role = role
    }

    init(peer: ChatMember) {
        self.init(id: peer.userId, chatId: peer.chatId, username: peer.username,
                  displayName: peer.displayName, avatar: peer.avatar, about: peer.about,
                  isBot: peer.isBot, isSystemBot: peer.isSystemBot,
                  isPremium: peer.isPremium, premiumBadge: peer.premiumBadge)
    }

    static func == (lhs: PublicUser, rhs: PublicUser) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Chat member (public user + role + bot flags + badge)

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
