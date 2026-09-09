import Foundation

/// Per-user local UI state: pins, archive, mutes, folders.
/// Mirrors the web client's `yooh_pinned_chats` / `yooh_archived_chats` /
/// `yooh_chat_notifications` maps, namespaced per user id.
///
/// Server-driven state (members, roles, settings) is never cached here —
/// it always comes from REST/realtime.
final class LocalPreferences: @unchecked Sendable {
    private let userId: String
    private let defaults: UserDefaults

    init(userId: String, defaults: UserDefaults = .standard) {
        self.userId = userId
        self.defaults = defaults
    }

    private func key(_ leaf: String) -> String {
        "yooh.ios.\(leaf).\(userId)"
    }

    private func stringSet(_ leaf: String) -> Set<String> {
        Set(defaults.stringArray(forKey: key(leaf)) ?? [])
    }

    private func setStringSet(_ value: Set<String>, leaf: String) {
        defaults.set(Array(value), forKey: key(leaf))
    }

    // MARK: - Pins / archive / mute

    var pinnedChatIds: Set<String> {
        get { stringSet("pinned") }
        set { setStringSet(newValue, leaf: "pinned") }
    }

    var archivedChatIds: Set<String> {
        get { stringSet("archived") }
        set { setStringSet(newValue, leaf: "archived") }
    }

    var mutedChatIds: Set<String> {
        get { stringSet("muted") }
        set { setStringSet(newValue, leaf: "muted") }
    }

    func togglePin(_ id: String) {
        var s = pinnedChatIds
        if s.contains(id) { s.remove(id) } else { s.insert(id) }
        pinnedChatIds = s
    }

    func toggleArchive(_ id: String) {
        var s = archivedChatIds
        if s.contains(id) { s.remove(id) } else { s.insert(id) }
        archivedChatIds = s
    }

    func toggleMute(_ id: String) {
        var s = mutedChatIds
        if s.contains(id) { s.remove(id) } else { s.insert(id) }
        mutedChatIds = s
    }

    // MARK: - Drafts (unsent composer text, per chat + stream)

    private func draftsMap() -> [String: String] {
        (defaults.dictionary(forKey: key("drafts")) as? [String: String]) ?? [:]
    }

    func draft(chatId: String, stream: String) -> String {
        draftsMap()["\(chatId):\(stream)"] ?? ""
    }

    func setDraft(_ text: String, chatId: String, stream: String) {
        var map = draftsMap()
        let k = "\(chatId):\(stream)"
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            map.removeValue(forKey: k)
        } else {
            map[k] = text
        }
        defaults.set(map, forKey: key("drafts"))
    }

    // MARK: - Pinned messages (message id per chat)

    private func pinsMap() -> [String: String] {
        (defaults.dictionary(forKey: key("pins")) as? [String: String]) ?? [:]
    }

    func pinnedMessageId(chatId: String) -> String? {
        pinsMap()[chatId]
    }

    func setPinned(messageId: String?, chatId: String) {
        var map = pinsMap()
        if let messageId {
            map[chatId] = messageId
        } else {
            map.removeValue(forKey: chatId)
        }
        defaults.set(map, forKey: key("pins"))
    }
}
