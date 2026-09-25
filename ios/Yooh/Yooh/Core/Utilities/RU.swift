import Foundation

/// Russian-language helpers: plural forms, dates, phone display.
enum RU {
    /// Russian plural: 1 участник, 3 участника, 5 участников.
    static func plural(_ n: Int, one: String, few: String, many: String) -> String {
        let mod10 = abs(n) % 10
        let mod100 = abs(n) % 100
        let form: String
        if mod10 == 1, mod100 != 11 {
            form = one
        } else if (2...4).contains(mod10), !(12...14).contains(mod100) {
            form = few
        } else {
            form = many
        }
        return "\(n) \(form)"
    }

    /// Call duration as m:ss ("4:05", "1:02:30" for long calls).
    static func callDuration(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%d:%02d", m, s)
    }

    /// Short relative time for list rows: "только что", "5 мин", "вчера".
    static func relativeListDate(_ iso: String?) -> String {
        guard let date = YoohDates.parse(iso) else { return "" }
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            let mins = Int(Date().timeIntervalSince(date) / 60)
            if mins < 1 { return "только что" }
            if mins < 60 { return "\(mins) мин" }
            let f = DateFormatter()
            f.locale = Locale(identifier: "ru_RU")
            f.timeStyle = .short
            f.dateStyle = .none
            return f.string(from: date)
        }
        if cal.isDateInYesterday(date) { return "вчера" }
        if let days = cal.dateComponents([.day], from: cal.startOfDay(for: date),
                                          to: cal.startOfDay(for: Date())).day, days < 7
        {
            let f = DateFormatter()
            f.locale = Locale(identifier: "ru_RU")
            f.dateFormat = "EEEE"
            return f.string(from: date).capitalized
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateStyle = .short
        f.timeStyle = .none
        return f.string(from: date)
    }
}
