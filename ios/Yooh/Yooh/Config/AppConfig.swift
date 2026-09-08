import Foundation

/// Server environment selector.
enum YoohEnvironment: String {
    /// Public test backend: this PC's Yooh server exposed through CloudPub.
    /// TLS is terminated by CloudPub, so the URL carries NO port.
    case test
    /// Direct LAN/local backend started with `start.bat`
    /// (`0.0.0.0:1111`, plain HTTP).
    case local
}

/// Centralized server configuration — the ONLY place that knows hosts,
/// ports and base URLs. Everything (REST, files, Socket.IO, WebSocket
/// upgrade) derives from `baseURL`.
///
/// Architecture:
///   iPhone → https://yooh-test.cloudpub.ru/ → CloudPub → this PC → 0.0.0.0:1111
enum AppConfig {
    /// Bundle identifier of the app target.
    static let bundleID = "com.yooh.app"

    /// Active environment. `.test` is the current test-server default.
    static let environment: YoohEnvironment = .test

    // MARK: - Test server (CloudPub)

    /// Public host. No `:port` — CloudPub serves standard HTTPS (443)
    /// and forwards to the local `:1111`.
    static let testHost = "yooh-test.cloudpub.ru"
    static let testBaseURL = URL(string: "https://yooh-test.cloudpub.ru")!

    // MARK: - Local backend (start.bat)

    static let localHost = "localhost"
    static let localPort = 1111
    static let localAdminPort = 1112
    static var localBaseURL: URL {
        URL(string: "http://\(localHost):\(localPort)")!
    }

    // MARK: - Resolved endpoints

    /// REST + Socket.IO polling base URL (no trailing slash).
    /// A user override in Settings → Backend wins (LAN / dev).
    static var baseURL: URL {
        if let raw = UserDefaults.standard.string(forKey: Keys.serverURLOverride),
           !raw.trimmingCharacters(in: .whitespaces).isEmpty,
           let url = URL(string: raw.trimmingCharacters(in: .whitespaces))?.deletingLastPathComponentSafe(),
           url.host != nil
        {
            return url
        }
        switch environment {
        case .test: return testBaseURL
        case .local: return localBaseURL
        }
    }

    /// Human-readable API URL for diagnostics / BUILD_INFO.
    static var apiURLString: String { baseURL.absoluteString }

    /// WebSocket URL derived from the base (https→wss, http→ws),
    /// same `/socket.io/` path the server uses.
    static var webSocketURLString: String {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        c.scheme = (c.scheme == "https") ? "wss" : "ws"
        c.path = socketPath
        c.query = nil
        return c.url?.absoluteString ?? ""
    }

    /// Effective API port for diagnostics (443 implied by https).
    static var apiPort: Int {
        if let port = baseURL.port { return port }
        return baseURL.scheme == "https" ? 443 : 80
    }

    /// Socket.IO endpoint path (server default).
    static let socketPath = "/socket.io/"

    /// Engine.IO protocol version spoken by the server (socket.io 4.x).
    static let engineIOVersion = "4"

    /// Request timeouts, mirroring the web client (`api()` in app.js):
    /// 25s for GET, 45s for other JSON calls, 8 min for multipart uploads.
    static let getTimeout: TimeInterval = 25
    static let jsonTimeout: TimeInterval = 45
    static let uploadTimeout: TimeInterval = 8 * 60

    /// Message history page size (server allows 1...200, default 50).
    static let messagePageSize = 50

    /// Max text length enforced by the server (zod).
    static let maxMessageLength = 4000

    /// Auth: OTP is always 6 digits (`utils.js`).
    static let otpLength = 6

    enum Keys {
        static let serverURLOverride = "yooh.serverURL"
    }
}

private extension URL {
    /// Removes a trailing slash path component while keeping host/port intact.
    func deletingLastPathComponentSafe() -> URL {
        var s = absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        return URL(string: s) ?? self
    }
}
