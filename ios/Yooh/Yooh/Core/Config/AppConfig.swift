import Foundation

/// Server endpoints. iPhone → https://yooh-test.cloudpub.ru/ → CloudPub
/// → local backend. A Settings override (LAN/dev) wins when set.
enum AppConfig {
    static let bundleID = "com.yooh.app"

    enum Environment {
        case test, local
    }

    static let environment: Environment = .test

    static let testHost = "yooh-test.cloudpub.ru"
    static let testBaseURL = URL(string: "https://yooh-test.cloudpub.ru")!

    static let localHost = "localhost"
    static let localPort = 1111
    static let localAdminPort = 1112
    static var localBaseURL: URL {
        URL(string: "http://\(localHost):\(localPort)")!
    }

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

    static var apiURLString: String { baseURL.absoluteString }

    static var webSocketURLString: String {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        c.scheme = (c.scheme == "https") ? "wss" : "ws"
        c.path = socketPath
        c.query = nil
        return c.url?.absoluteString ?? ""
    }

    static var apiPort: Int {
        if let port = baseURL.port { return port }
        return baseURL.scheme == "https" ? 443 : 80
    }

    static let socketPath = "/socket.io/"
    static let engineIOVersion = "4"

    static let getTimeout: TimeInterval = 25
    static let jsonTimeout: TimeInterval = 45
    static let uploadTimeout: TimeInterval = 8 * 60

    static let messagePageSize = 50
    static let maxMessageLength = 4000
    static let otpLength = 6

    enum Keys {
        static let serverURLOverride = "yooh.serverURL"
    }
}

private extension URL {
    func deletingLastPathComponentSafe() -> URL {
        var s = absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        return URL(string: s) ?? self
    }
}
