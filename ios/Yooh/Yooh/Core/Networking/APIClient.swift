import Foundation
import os

/// Centralized HTTP layer — the only place that builds URLRequests,
/// sets auth, parses `{ error, details }` and maps 401 to logout.
final class APIClient: NSObject, @unchecked Sendable {
    static let shared = APIClient()

    var tokenProvider: (@Sendable () -> String?)?
    var onUnauthorized: (@Sendable () -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = AppConfig.jsonTimeout
        config.timeoutIntervalForResource = AppConfig.uploadTimeout
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: nil, delegateQueue: nil)
    }()

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let log = Logger(subsystem: AppConfig.bundleID, category: "api")

    private override init() { super.init() }

    func send<T: Decodable>(_ endpoint: APIEndpoint) async throws -> T {
        let (data, response) = try await perform(endpoint, attempt: 1)
        return try decode(data: data, response: response, endpoint: endpoint)
    }

    func downloadData(path: String, query: [URLQueryItem] = []) async throws -> (Data, String?) {
        var components = URLComponents(url: AppConfig.baseURL, resolvingAgainstBaseURL: false)!
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIError.network(URLError(.badURL)) }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = AppConfig.getTimeout
        if let token = tokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.network(URLError(.badServerResponse))
            }
            guard (200...299).contains(http.statusCode) else {
                throw mapStatus(http.statusCode, data: data)
            }
            return (data, http.mimeType)
        } catch let e as APIError {
            throw e
        } catch let e as URLError {
            throw APIError.network(e)
        } catch {
            throw APIError.unknown(error)
        }
    }

    func upload<T: Decodable>(path: String, fileData: Data, filename: String, mimeType: String, fields: [String: String] = [:]) async throws -> T {
        var body = MultipartBody()
        for (k, v) in fields { body.addField(name: k, value: v) }
        body.addFile(name: "file", filename: filename, mimeType: mimeType, fileData: fileData)
        let payload = body.finalize()

        guard let url = URL(string: path, relativeTo: AppConfig.baseURL) else {
            throw APIError.network(URLError(.badURL))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = AppConfig.uploadTimeout
        request.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        if let token = tokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        #if DEBUG
        log.debug("Upload \(path, privacy: .public) (\(fileData.count) bytes)")
        #endif
        do {
            let (data, response) = try await session.upload(for: request, from: payload)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.network(URLError(.badServerResponse))
            }
            guard (200...299).contains(http.statusCode) else {
                throw mapStatus(http.statusCode, data: data)
            }
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decoding(error)
            }
        } catch let e as APIError {
            throw e
        } catch let e as URLError {
            throw APIError.network(e)
        } catch {
            throw APIError.unknown(error)
        }
    }

    // MARK: - Internals

    private func perform(_ endpoint: APIEndpoint, attempt: Int) async throws -> (Data, URLResponse) {
        let request = try buildRequest(endpoint)
        #if DEBUG
        log.debug("Request \(endpoint.method.rawValue, privacy: .public) \(endpoint.path, privacy: .public)")
        #endif
        do {
            return try await session.data(for: request)
        } catch let e as URLError {
            if attempt == 1, endpoint.isIdempotent, isTransient(e) {
                #if DEBUG
                log.debug("Retrying \(endpoint.path, privacy: .public)")
                #endif
                try await Task.sleep(nanoseconds: 700_000_000)
                return try await perform(endpoint, attempt: 2)
            }
            throw APIError.network(e)
        }
    }

    private func decode<T: Decodable>(data: Data, response: URLResponse, endpoint: APIEndpoint) throws -> T {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network(URLError(.badServerResponse))
        }
        #if DEBUG
        log.debug("Response \(endpoint.path, privacy: .public) -> \(http.statusCode)")
        #endif
        guard (200...299).contains(http.statusCode) else {
            throw mapStatus(http.statusCode, data: data)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            log.error("Decode failed \(endpoint.path, privacy: .public)")
            #endif
            throw APIError.decoding(error)
        }
    }

    private func buildRequest(_ endpoint: APIEndpoint) throws -> URLRequest {
        var components = URLComponents(url: AppConfig.baseURL, resolvingAgainstBaseURL: false)!
        components.path = endpoint.path
        components.queryItems = endpoint.query.isEmpty ? nil : endpoint.query
        guard let url = components.url else { throw APIError.network(URLError(.badURL)) }
        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.timeoutInterval = endpoint.method == .get ? AppConfig.getTimeout : AppConfig.jsonTimeout
        if let admin = endpoint.adminToken {
            request.setValue(admin, forHTTPHeaderField: "x-admin-token")
        } else if let token = tokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = endpoint.jsonBody {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try encoder.encode(body)
            } catch {
                throw APIError.unknown(error)
            }
        }
        return request
    }

    private func mapStatus(_ status: Int, data: Data) -> APIError {
        let parsed = try? decoder.decode(APIErrorBody.self, from: data)
        let message = parsed?.error ?? ""
        switch status {
        case 401:
            DispatchQueue.main.async { [weak self] in self?.onUnauthorized?() }
            return .unauthorized(message: message)
        case 403: return .forbidden(message: message)
        case 404: return .notFound(message: message)
        case 409: return .conflict(message: message)
        case 400, 422: return .validation(message: message)
        case 408, 429: return .rateLimited
        default: return .server(status: status, message: message)
        }
    }

    private func isTransient(_ error: URLError) -> Bool {
        switch error.code {
        case .timedOut, .networkConnectionLost, .notConnectedToInternet,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
             .secureConnectionFailed, .badServerResponse:
            return true
        default:
            return false
        }
    }
}
