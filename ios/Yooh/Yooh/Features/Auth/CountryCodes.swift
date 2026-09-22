import Foundation

/// Country dial codes for the phone-first auth flow (Russian names).
/// The server only sees the final E.164 phone — country is client UX.
struct Country: Identifiable, Hashable {
    let code: String
    let name: String
    let dial: String
    let flag: String

    var id: String { code }

    var dialDigits: String { dial.filter { $0.isNumber } }

    static let russia = Country(code: "RU", name: "Россия", dial: "+7", flag: "🇷🇺")

    static let all: [Country] = [
        Country(code: "RU", name: "Россия", dial: "+7", flag: "🇷🇺"),
        Country(code: "KZ", name: "Казахстан", dial: "+7", flag: "🇰🇿"),
        Country(code: "BY", name: "Беларусь", dial: "+375", flag: "🇧🇾"),
        Country(code: "UA", name: "Украина", dial: "+380", flag: "🇺🇦"),
        Country(code: "UZ", name: "Узбекистан", dial: "+998", flag: "🇺🇿"),
        Country(code: "AZ", name: "Азербайджан", dial: "+994", flag: "🇦🇿"),
        Country(code: "AM", name: "Армения", dial: "+374", flag: "🇦🇲"),
        Country(code: "GE", name: "Грузия", dial: "+995", flag: "🇬🇪"),
        Country(code: "MD", name: "Молдова", dial: "+373", flag: "🇲🇩"),
        Country(code: "KG", name: "Киргизия", dial: "+996", flag: "🇰🇬"),
        Country(code: "TJ", name: "Таджикистан", dial: "+992", flag: "🇹🇯"),
        Country(code: "TM", name: "Туркменистан", dial: "+993", flag: "🇹🇲"),
        Country(code: "LV", name: "Латвия", dial: "+371", flag: "🇱🇻"),
        Country(code: "LT", name: "Литва", dial: "+370", flag: "🇱🇹"),
        Country(code: "EE", name: "Эстония", dial: "+372", flag: "🇪🇪"),
        Country(code: "DE", name: "Германия", dial: "+49", flag: "🇩🇪"),
        Country(code: "GB", name: "Великобритания", dial: "+44", flag: "🇬🇧"),
        Country(code: "FR", name: "Франция", dial: "+33", flag: "🇫🇷"),
        Country(code: "ES", name: "Испания", dial: "+34", flag: "🇪🇸"),
        Country(code: "IT", name: "Италия", dial: "+39", flag: "🇮🇹"),
        Country(code: "TR", name: "Турция", dial: "+90", flag: "🇹🇷"),
        Country(code: "AE", name: "ОАЭ", dial: "+971", flag: "🇦🇪"),
        Country(code: "IL", name: "Израиль", dial: "+972", flag: "🇮🇱"),
        Country(code: "US", name: "США", dial: "+1", flag: "🇺🇸"),
        Country(code: "CA", name: "Канада", dial: "+1", flag: "🇨🇦"),
        Country(code: "CN", name: "Китай", dial: "+86", flag: "🇨🇳"),
        Country(code: "IN", name: "Индия", dial: "+91", flag: "🇮🇳"),
        Country(code: "BR", name: "Бразилия", dial: "+55", flag: "🇧🇷"),
    ]
}

/// Progressive phone formatting. +7 gets the Russian mask,
/// other countries get plain digit grouping.
enum PhoneFormat {
    /// National digits only (no dial code), filtered to 0-9.
    static func digitsOnly(_ raw: String) -> String {
        raw.filter { $0.isNumber }
    }

    static func display(national digits: String, country: Country) -> String {
        if country.dialDigits == "7" {
            return russianMask(digits)
        }
        return grouped(digits)
    }

    static func isComplete(national digits: String, country: Country) -> Bool {
        if country.dialDigits == "7" { return digits.count == 10 }
        return (6...14).contains(digits.count)
    }

    static func e164(national digits: String, country: Country) -> String {
        "+" + country.dialDigits + digits
    }

    /// Masked phone for the code screen: "+7 ••• •••-12-34".
    static func masked(full e164: String) -> String {
        let digits = digitsOnly(e164)
        guard digits.count >= 6 else { return e164 }
        let head = String(digits.prefix(digits.count - 4))
        let tail = String(digits.suffix(4))
        let t1 = tail.prefix(2), t2 = tail.suffix(2)
        // +7 ••• •••-12-34 style
        if head.hasPrefix("7"), head.count == 7 {
            return "+7 ••• •••-\(t1)-\(t2)"
        }
        return "+\(head) •••-\(t1)-\(t2)"
    }

    // MARK: - Private

    private static func russianMask(_ digits: String) -> String {
        let d = Array(digits.prefix(10))
        var out = ""
        for (i, ch) in d.enumerated() {
            switch i {
            case 0: out += "(\(ch)"
            case 2: out += "\(ch)) "
            case 5: out += "\(ch)-"
            case 7: out += "\(ch)-"
            default: out.append(ch)
            }
        }
        return out
    }

    private static func grouped(_ digits: String) -> String {
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0, i % 3 == 0 { out += " " }
            out.append(ch)
        }
        return out
    }
}
