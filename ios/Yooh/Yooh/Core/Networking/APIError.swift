import Foundation

/// Typed HTTP errors. Failures arrive as `{ error, details? }`.
enum APIError: Error, LocalizedError {
    case unauthorized(message: String)
    case forbidden(message: String)
    case notFound(message: String)
    case conflict(message: String)
    case validation(message: String)
    case rateLimited
    case server(status: Int, message: String)
    case network(URLError)
    case decoding(Error)
    case unknown(Error)

    var isAuthExpired: Bool {
        if case .unauthorized = self { return true }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .unauthorized(let m): return m.isEmpty ? "Session expired. Please sign in again." : m
        case .forbidden(let m): return m.isEmpty ? "Action not allowed." : m
        case .notFound(let m): return m.isEmpty ? "Not found." : m
        case .conflict(let m): return m.isEmpty ? "Conflict." : m
        case .validation(let m): return m.isEmpty ? "Invalid data." : m
        case .rateLimited: return "Too many requests. Try again shortly."
        case .server(_, let m): return m.isEmpty ? "Server error. Try again." : m
        case .network(let e): return e.localizedDescription
        case .decoding: return "Unexpected server response."
        case .unknown(let e): return e.localizedDescription
        }
    }
}

struct APIErrorBody: Decodable {
    let error: String?
    let details: [AnyCodable]?
}
