import Foundation
import Observation

/// Private per-contact notes (device-local, visible only to you).
@Observable
final class ContactNotes {
    private let userId: String
    private let defaults: UserDefaults

    init(userId: String, defaults: UserDefaults = .standard) {
        self.userId = userId
        self.defaults = defaults
    }

    private var key: String { "yooh.ios.contact-notes.\(userId)" }

    private var map: [String: String] {
        (defaults.dictionary(forKey: key) as? [String: String]) ?? [:]
    }

    func note(userId: String) -> String {
        map[userId] ?? ""
    }

    func setNote(_ text: String, userId: String) {
        var m = map
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            m.removeValue(forKey: userId)
        } else {
            m[userId] = text
        }
        defaults.set(m, forKey: key)
    }
}
