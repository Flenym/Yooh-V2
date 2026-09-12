import Foundation

/// One picked exception contact. The server stores ids only, so the
/// client keeps a per-account snapshot for display (avatar + title).
struct ExceptionContact: Codable, Identifiable, Hashable {
    var id: String { userId }
    let userId: String
    let title: String
    let avatar: String?

    init(userId: String, title: String, avatar: String? = nil) {
        self.userId = userId
        self.title = title
        self.avatar = avatar
    }

    init(_ user: PublicUser) {
        self.init(userId: user.id, title: user.title, avatar: user.avatar)
    }
}

struct ExceptionContactStore {
    private let key: String

    init(userId: String) {
        key = "yooh.privacy-exceptions.\(userId)"
    }

    func list() -> [ExceptionContact] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let items = try? JSONDecoder().decode([ExceptionContact].self, from: data)
        else { return [] }
        return items
    }

    func save(_ contact: ExceptionContact) {
        var items = list().filter { $0.userId != contact.userId }
        items.insert(contact, at: 0)
        items = Array(items.prefix(500))
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func contact(for id: String) -> ExceptionContact? {
        list().first(where: { $0.userId == id })
    }
}

/// Full privacy state: legacy flat keys + nested `rules` (see
/// getUserPrivacyRules in src/server/services/privacyRules.js).
/// Saves always carry the complete snapshot so concurrent section
/// edits never clobber each other's exception lists.
struct PrivacyRulesModel {
    var phoneSee = "everyone"
    var phoneFind = "contacts"
    var phoneShow: [String] = []
    var lastSeenSee = "everyone"
    var lastSeenShow: [String] = []
    var hideReadTime = false
    var photosSee = "everyone"
    var photosShow: [String] = []
    var photosHide: [String] = []
    var forwardsLink = "contacts"
    var forwardsAllow: [String] = []
    var forwardsDeny: [String] = []
    var callsCall = "contacts"
    var callsAllow: [String] = []
    var callsDeny: [String] = []
    var voiceSend = "everyone"
    var voiceDeny: [String] = []
    var messagesSend = "everyone"
    var messagesAllow: [String] = []
    var messagesDeny: [String] = []
    var invites = "everyone"
    var readReceipts = true

    static func parse(_ settings: [String: AnyCodable]) -> PrivacyRulesModel {
        var m = PrivacyRulesModel()
        var flat: [String: AnyCodable] = [:]
        if case .object(let o) = settings["privacy"] { flat = o }
        var rules: [String: AnyCodable] = [:]
        if case .object(let o) = flat["rules"] { rules = o }
        func sec(_ name: String) -> [String: AnyCodable] {
            if case .object(let o) = rules[name] { return o }
            return [:]
        }
        func str(_ d: [String: AnyCodable], _ key: String, _ def: String) -> String {
            if case .string(let v) = d[key], !v.isEmpty { return v.lowercased() }
            return def
        }
        func ids(_ d: [String: AnyCodable], _ key: String) -> [String] {
            guard case .array(let arr) = d[key] else { return [] }
            var out: [String] = []
            for item in arr {
                if case .string(let v) = item {
                    let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty, !out.contains(t) { out.append(t) }
                }
            }
            return out
        }
        let phone = sec("phone")
        m.phoneSee = str(phone, "whoCanSee", SettingsReader.string("phone", in: flat, default: "everyone"))
        m.phoneFind = str(phone, "whoCanFind", "contacts")
        m.phoneShow = ids(phone, "alwaysShowIds")

        let lastSeen = sec("lastSeen")
        m.lastSeenSee = str(lastSeen, "whoCanSee", SettingsReader.string("lastSeen", in: flat, default: "everyone"))
        m.lastSeenShow = ids(lastSeen, "alwaysShowIds")
        if case .bool(let b) = lastSeen["hideReadTime"] {
            m.hideReadTime = b
        } else {
            m.hideReadTime = !(SettingsReader.bool("readReceipts", in: flat, default: true))
        }

        let photos = sec("profilePhotos")
        m.photosSee = str(photos, "whoCanSee", SettingsReader.string("profilePhoto", in: flat, default: "everyone"))
        m.photosShow = ids(photos, "alwaysShowIds")
        m.photosHide = ids(photos, "alwaysHideIds")

        let forwards = sec("forwards")
        m.forwardsLink = str(forwards, "whoCanLink", SettingsReader.string("forwards", in: flat, default: "contacts"))
        m.forwardsAllow = ids(forwards, "alwaysAllowIds")
        m.forwardsDeny = ids(forwards, "alwaysDenyIds")

        let calls = sec("calls")
        m.callsCall = str(calls, "whoCanCall", SettingsReader.string("calls", in: flat, default: "contacts"))
        m.callsAllow = ids(calls, "alwaysAllowIds")
        m.callsDeny = ids(calls, "alwaysDenyIds")

        let voice = sec("voice")
        m.voiceSend = str(voice, "whoCanSend", "everyone")
        m.voiceDeny = ids(voice, "alwaysDenyIds")

        let messages = sec("messages")
        m.messagesSend = str(messages, "whoCanSend", SettingsReader.string("messages", in: flat, default: "everyone"))
        m.messagesAllow = ids(messages, "alwaysAllowIds")
        m.messagesDeny = ids(messages, "alwaysDenyIds")

        if case .object(let pv) = rules["profileVisibility"] {
            m.invites = str(pv, "invites", SettingsReader.string("groupsInvites", in: flat, default: "everyone"))
        } else {
            m.invites = SettingsReader.string("groupsInvites", in: flat, default: "everyone")
        }
        m.readReceipts = SettingsReader.bool("readReceipts", in: flat, default: !m.hideReadTime)
        return m
    }

    /// Complete `privacy` section patch (legacy keys + nested rules).
    func patchDict() -> [String: Any] {
        [
            "phone": phoneSee,
            "lastSeen": lastSeenSee,
            "profilePhoto": photosSee,
            "forwards": forwardsLink,
            "calls": callsCall,
            "messages": messagesSend,
            "groupsInvites": invites,
            "readReceipts": readReceipts,
            "rules": [
                "phone": ["whoCanSee": phoneSee, "whoCanFind": phoneFind, "alwaysShowIds": phoneShow] as [String: Any],
                "lastSeen": ["whoCanSee": lastSeenSee, "alwaysShowIds": lastSeenShow, "hideReadTime": hideReadTime] as [String: Any],
                "profilePhotos": ["whoCanSee": photosSee, "alwaysShowIds": photosShow, "alwaysHideIds": photosHide] as [String: Any],
                "forwards": ["whoCanLink": forwardsLink, "alwaysAllowIds": forwardsAllow, "alwaysDenyIds": forwardsDeny] as [String: Any],
                "calls": ["whoCanCall": callsCall, "alwaysAllowIds": callsAllow, "alwaysDenyIds": callsDeny] as [String: Any],
                "voice": ["whoCanSend": voiceSend, "alwaysDenyIds": voiceDeny] as [String: Any],
                "messages": ["whoCanSend": messagesSend, "alwaysAllowIds": messagesAllow, "alwaysDenyIds": messagesDeny] as [String: Any],
                "profileVisibility": ["invites": invites] as [String: Any],
            ] as [String: Any],
        ] as [String: Any]
    }
}
