import Foundation

/// Per-user local UI state: pins, archive, mutes, folders, drafts,
/// pinned messages. Mirrors the web client's localStorage maps.
/// Server-driven state is never cached here.
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

    // MARK: - Custom folders

    struct FolderDef: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var includeDirect: Bool
        var includeGroups: Bool
        var includeChannels: Bool
        var unreadOnly: Bool

        static func make(name: String) -> FolderDef {
            FolderDef(id: UUID().uuidString, name: name,
                      includeDirect: true, includeGroups: true,
                      includeChannels: true, unreadOnly: false)
        }
    }

    var customFolders: [FolderDef] {
        get {
            guard let data = defaults.data(forKey: key("folders")),
                  let list = try? JSONDecoder().decode([FolderDef].self, from: data) else { return [] }
            return list
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: key("folders"))
            }
        }
    }

    func saveFolder(_ folder: FolderDef) {
        var list = customFolders
        if let i = list.firstIndex(where: { $0.id == folder.id }) {
            list[i] = folder
        } else {
            list.append(folder)
        }
        customFolders = list
    }

    func deleteFolder(_ id: String) {
        customFolders = customFolders.filter { $0.id != id }
    }

    // MARK: - Drafts (per chat + stream)

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
