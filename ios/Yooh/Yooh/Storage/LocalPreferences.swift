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
}
