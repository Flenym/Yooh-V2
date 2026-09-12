import CryptoKit
import Foundation

/// Device-local secret chats (web-client semantics): messages never touch
/// the server, an optional self-destruct timer deletes them, and a
/// fingerprint identifies the pairing.
struct SecretChat: Codable, Identifiable, Hashable {
    let id: String
    let peerUserId: String
    var peerName: String
    var peerAvatar: String?
    let createdAt: String
    var ttlSeconds: Int
    let fingerprint: String

    static func fingerprint(myId: String, peerId: String) -> String {
        let a = [myId, peerId].sorted().joined(separator: ":")
        let digest = SHA256.hash(data: Data(a.utf8))
        let hex = digest.compactMap { String(format: "%02x", $0) }.joined()
        return stride(from: 0, to: 32, by: 4).map {
            String(hex[hex.index(hex.startIndex, offsetBy: $0)..<hex.index(hex.startIndex, offsetBy: $0 + 4)])
        }.joined(separator: " ")
    }
}

struct SecretMessage: Codable, Identifiable {
    let id: String
    var text: String?
    var imageDataURL: String?
    let senderIsMe: Bool
    let createdAt: String
    var editedAt: String?
    var expiresAt: String?

    var isExpired: Bool {
        guard let e = expiresAt, let date = YoohDates.parse(e) else { return false }
        return date <= Date()
    }
}

final class SecretStore: @unchecked Sendable {
    private let userId: String
    private let defaults: UserDefaults

    init(userId: String, defaults: UserDefaults = .standard) {
        self.userId = userId
        self.defaults = defaults
    }

    private func key(_ leaf: String) -> String {
        "yooh.ios.secrets.\(leaf).\(userId)"
    }

    var chats: [SecretChat] {
        get {
            guard let data = defaults.data(forKey: key("chats")),
                  let list = try? JSONDecoder().decode([SecretChat].self, from: data) else { return [] }
            return list
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: key("chats"))
            }
        }
    }

    private func messagesMap() -> [String: [SecretMessage]] {
        guard let data = defaults.data(forKey: key("messages")),
              let map = try? JSONDecoder().decode([String: [SecretMessage]].self, from: data) else { return [:] }
        return map
    }

    private func saveMessages(_ map: [String: [SecretMessage]]) {
        if let data = try? JSONEncoder().encode(map) {
            defaults.set(data, forKey: key("messages"))
        }
    }

    func messages(chatId: String) -> [SecretMessage] {
        var map = messagesMap()
        let live = (map[chatId] ?? []).filter { !$0.isExpired }
        if live.count != (map[chatId] ?? []).count {
            map[chatId] = live
            saveMessages(map)
        }
        return live.sorted { $0.createdAt < $1.createdAt }
    }

    func findChat(peerUserId: String) -> SecretChat? {
        chats.first(where: { $0.peerUserId == peerUserId })
    }

    func createChat(peerUserId: String, peerName: String, peerAvatar: String?, myId: String) -> SecretChat {
        if let existing = findChat(peerUserId: peerUserId) {
            return existing
        }
        let chat = SecretChat(id: "secret-\(UUID().uuidString)",
                              peerUserId: peerUserId,
                              peerName: peerName,
                              peerAvatar: peerAvatar,
                              createdAt: YoohDates.isoNow(),
                              ttlSeconds: 0,
                              fingerprint: SecretChat.fingerprint(myId: myId, peerId: peerUserId))
        var list = chats
        list.insert(chat, at: 0)
        chats = list
        return chat
    }

    func updateChat(_ chat: SecretChat) {
        var list = chats
        if let i = list.firstIndex(where: { $0.id == chat.id }) {
            list[i] = chat
            chats = list
        }
    }

    func deleteChat(_ id: String) {
        chats = chats.filter { $0.id != id }
        var map = messagesMap()
        map.removeValue(forKey: id)
        saveMessages(map)
    }

    @discardableResult
    func send(chatId: String, text: String?, imageDataURL: String?, ttlSeconds: Int) -> SecretMessage {
        let m = SecretMessage(id: "sm-\(UUID().uuidString)",
                              text: text,
                              imageDataURL: imageDataURL,
                              senderIsMe: true,
                              createdAt: YoohDates.isoNow(),
                              editedAt: nil,
                              expiresAt: ttlSeconds > 0
                                ? ISO8601DateFormatter().string(from: Date().addingTimeInterval(TimeInterval(ttlSeconds)))
                                : nil)
        var map = messagesMap()
        map[chatId, default: []].append(m)
        saveMessages(map)
        return m
    }

    func edit(chatId: String, messageId: String, text: String) {
        var map = messagesMap()
        if let i = map[chatId]?.firstIndex(where: { $0.id == messageId }) {
            map[chatId]?[i].text = text
            map[chatId]?[i].editedAt = YoohDates.isoNow()
            saveMessages(map)
        }
    }

    func delete(chatId: String, messageId: String) {
        var map = messagesMap()
        map[chatId]?.removeAll(where: { $0.id == messageId })
        saveMessages(map)
    }
}
