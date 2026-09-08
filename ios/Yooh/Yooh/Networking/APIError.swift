import Foundation

/// Typed HTTP errors. The server always answers failures as
/// `{ error: String, details?: [...] }` (see `toHttpError` / error
/// middleware in `src/server/app.js`).
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

    /// 401 means the JWT/session is gone → the app must log out,
    /// exactly like the web client does in `resetToAuth()`.
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

/// Wire error body `{ error, details }`.
struct APIErrorBody: Decodable {
    let error: String?
    let details: [AnyCodable]?
}
