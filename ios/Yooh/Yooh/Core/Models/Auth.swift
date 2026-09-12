import Foundation
import UIKit

// MARK: - Auth payloads (mirror authService.js)

struct OTPRequestResponse: Decodable {
    let ok: Bool?
    let phone: String?
    let target: String?
    let maskedTarget: String?
    let purpose: String?
    let channel: String?
    let delivery: String?
    let expiresAt: String?
    let expiresInSeconds: Int?
}

struct VerifyCodeResponse: Decodable {
    let token: String?
    let user: YoohUser?
    let requiresCloudPassword: Bool?
    let loginTicket: String?
    let expiresAt: String?
}

struct DeviceInfo: Encodable {
    var name: String
    var platform: String = "iphone"
    var client: String
    var userAgent: String?

    enum CodingKeys: String, CodingKey { case name, platform, client, userAgent }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(platform, forKey: .platform)
        try c.encode(client, forKey: .client)
        try c.encodeIfPresent(userAgent, forKey: .userAgent)
    }

    static func current() -> DeviceInfo {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        return DeviceInfo(name: Device.currentModelName, client: "Yooh iOS \(version)")
    }
}

struct AuthSession: Decodable, Identifiable {
    let id: String
    let name: String?
    let client: String?
    let location: String?
    let platform: String?
    let icon: String?
    let createdAt: String?
    let lastSeenAt: String?
    let isCurrent: Bool?
}

struct AuthSessionsResponse: Decodable {
    struct Box: Decodable {
        let current: AuthSession?
        let others: [AuthSession]?
    }
    let sessions: Box
}
