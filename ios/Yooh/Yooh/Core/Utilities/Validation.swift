import Foundation

/// Client-side validation mirroring the server zod schemas, so obvious
/// input errors surface instantly without a round-trip.
enum Validation {
    static func normalizePhone(_ raw: String) -> String? {
        let digits = raw.filter { $0.isNumber }
        guard digits.count >= 10, digits.count <= 15 else { return nil }
        let first = digits.first
        guard first != nil, first != "0" else { return nil }
        return raw.trimmingCharacters(in: .whitespaces).hasPrefix("+") ? "+\(digits)" : digits
    }

    static func validateUsername(_ raw: String) -> Bool {
        let v = raw.trimmingCharacters(in: .whitespaces)
        guard (5...32).contains(v.count) else { return false }
        return v.range(of: "^[A-Za-z0-9_]{5,32}$", options: .regularExpression) != nil
    }

    static func validateCode(_ raw: String) -> Bool {
        let v = raw.trimmingCharacters(in: .whitespaces)
        return v.count == AppConfig.otpLength && v.allSatisfy(\.isNumber)
    }

    static func validateDisplayName(_ raw: String) -> Bool {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return !v.isEmpty && v.count <= 80
    }

    static func validateMessage(_ raw: String) -> Bool {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return !v.isEmpty && v.count <= AppConfig.maxMessageLength
    }

    static func validateEmail(_ raw: String) -> Bool {
        let v = raw.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, v.count <= 254, v.contains("@") else { return false }
        return v.range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil
    }
}
