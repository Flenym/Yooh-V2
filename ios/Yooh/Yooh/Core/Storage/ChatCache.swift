import Foundation

/// Device cache for offline chats (Telegram-style): recent chat list +
/// recent messages per chat, stored as JSON per user. The app opens
/// instantly from cache, then syncs with the server in background.
enum ChatCache {
    private static let maxChats = 30
    private static let maxMessagesPerChat = 60
    private static let maxChatsWithMessages = 10

    private static func baseDir(userId: String) -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yooh-chatcache", isDirectory: true)
            .appendingPathComponent(userId, isDirectory: true)
    }

    private static func chatsURL(userId: String) -> URL {
        baseDir(userId: userId).appendingPathComponent("chats.json")
    }

    private static func messagesURL(chatId: String, userId: String) -> URL {
        baseDir(userId: userId)
            .appendingPathComponent("messages", isDirectory: true)
            .appendingPathComponent("\(chatId).json")
    }

    static func saveChats(_ chats: [YoohChat], userId: String) {
        guard !userId.isEmpty else { return }
        do {
            try FileManager.default.createDirectory(at: baseDir(userId: userId),
                                                    withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Array(chats.prefix(maxChats)))
            try data.write(to: chatsURL(userId: userId), options: .atomic)
            pruneMessages(except: chats.prefix(maxChatsWithMessages).map(\.id), userId: userId)
        } catch {
            // Cache is best-effort; never break the UI.
        }
    }

    static func loadChats(userId: String) -> [YoohChat]? {
        guard !userId.isEmpty else { return nil }
        guard let data = try? Data(contentsOf: chatsURL(userId: userId)) else { return nil }
        return try? JSONDecoder().decode([YoohChat].self, from: data)
    }

    static func saveMessages(_ messages: [YoohMessage], chatId: String, userId: String) {
        guard !userId.isEmpty, !chatId.isEmpty, !messages.isEmpty else { return }
        do {
            try FileManager.default.createDirectory(
                at: messagesURL(chatId: chatId, userId: userId).deletingLastPathComponent(),
                withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Array(messages.suffix(maxMessagesPerChat)))
            try data.write(to: messagesURL(chatId: chatId, userId: userId), options: .atomic)
        } catch {
            // Best-effort.
        }
    }

    static func loadMessages(chatId: String, userId: String) -> [YoohMessage]? {
        guard !userId.isEmpty, !chatId.isEmpty else { return nil }
        guard let data = try? Data(contentsOf: messagesURL(chatId: chatId, userId: userId)) else { return nil }
        return try? JSONDecoder().decode([YoohMessage].self, from: data)
    }

    static func clear(userId: String) {
        try? FileManager.default.removeItem(at: baseDir(userId: userId))
    }

    /// Global search over cached messages (works offline).
    /// Returns up to 20 (chat, message) hits, newest first.
    static func searchMessages(query: String, userId: String) -> [(chat: YoohChat, message: YoohMessage)] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.count >= 2, !userId.isEmpty else { return [] }
        guard let chats = loadChats(userId: userId) else { return [] }
        var hits: [(YoohChat, YoohMessage)] = []
        for chat in chats {
            guard let msgs = loadMessages(chatId: chat.id, userId: userId) else { continue }
            for m in msgs where (m.text?.lowercased().contains(q) ?? false) {
                hits.append((chat, m))
                if hits.count >= 20 { return hits }
            }
        }
        return hits
    }

    private static func pruneMessages(except chatIds: [String], userId: String) {
        let dir = baseDir(userId: userId).appendingPathComponent("messages", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil) else { return }
        let keep = Set(chatIds.map { "\($0).json" })
        for f in files where !keep.contains(f.lastPathComponent) {
            try? FileManager.default.removeItem(at: f)
        }
    }
}
