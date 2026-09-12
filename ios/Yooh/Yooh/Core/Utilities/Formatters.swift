import Foundation

/// Server timestamps are ISO-8601 strings.
enum YoohDates {
    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        return isoWithFraction.date(from: iso) ?? isoPlain.date(from: iso)
    }

    static func listTimestamp(_ iso: String?) -> String {
        guard let date = parse(iso) else { return "" }
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            return timeFormatter.string(from: date)
        }
        if cal.isDateInYesterday(date) {
            return NSLocalizedString("Yesterday", comment: "Chat list timestamp")
        }
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: date), to: cal.startOfDay(for: Date())).day ?? 99
        if days < 7 {
            return weekdayFormatter.string(from: date)
        }
        return dateFormatter.string(from: date)
    }

    static func bubbleTime(_ iso: String?) -> String {
        guard let date = parse(iso) else { return "" }
        return timeFormatter.string(from: date)
    }

    static func fullDateTime(_ iso: String?) -> String {
        guard let date = parse(iso) else { return "" }
        return "\(dateFormatter.string(from: date)) \(timeFormatter.string(from: date))"
    }

    /// Web-style relative time ("just now", "5 min ago", "Yesterday"),
    /// "last seen recently" fallback for missing/invalid values.
    static func relative(_ iso: String?) -> String {
        guard let date = parse(iso) else {
            return NSLocalizedString("last seen recently", comment: "Presence fallback")
        }
        let cal = Calendar.current
        let mins = cal.dateComponents([.minute], from: date, to: Date()).minute ?? Int.max
        if mins < 1 { return NSLocalizedString("just now", comment: "Relative time") }
        if mins < 60 {
            return String(format: NSLocalizedString("%d min ago", comment: "Relative time"), mins)
        }
        let hours = mins / 60
        if hours < 24 && cal.isDateInToday(date) {
            return String(format: NSLocalizedString("%d h ago", comment: "Relative time"), hours)
        }
        if cal.isDateInYesterday(date) {
            return NSLocalizedString("Yesterday", comment: "Relative time")
        }
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: date), to: cal.startOfDay(for: Date())).day ?? 99
        if days < 7 {
            return weekdayFormatter.string(from: date)
        }
        return dateFormatter.string(from: date)
    }

    static func isoNow() -> String {
        isoWithFraction.string(from: Date())
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .none
        f.dateStyle = .short
        return f
    }()

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        return f
    }()
}
