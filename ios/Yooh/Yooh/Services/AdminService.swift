import Foundation

/// Optional admin console (`x-admin-token`, same contract as web admin.html).
/// The token is stored in Keychain and never mixed with the user JWT.
final class AdminService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    var token: String? {
        get { KeychainStore.load(key: .adminToken) }
        set {
            if let newValue, !newValue.isEmpty {
                KeychainStore.save(newValue, for: .adminToken)
            } else {
                KeychainStore.delete(for: .adminToken)
            }
        }
    }

    struct Stats: Decodable {
        let stats: [String: AnyCodable]?
    }

    struct Code: Decodable, Identifiable {
        var id: String { "\(target ?? phone ?? "")-\(createdAt ?? "")" }
        let phone: String?
        let target: String?
        let channel: String?
        let code: String?
        let purpose: String?
        let createdAt: String?
        let expiresAt: String?

        var displayTarget: String { target ?? phone ?? "?" }
    }

    struct Codes: Decodable {
        let codes: [Code]?
    }

    func stats() async throws -> [String: AnyCodable] {
        guard let token else { throw APIError.unauthorized(message: "Enter the admin token first.") }
        let res: Stats = try await api.send(.adminStats(token: token))
        return res.stats ?? [:]
    }

    func authCodes() async throws -> [Code] {
        guard let token else { throw APIError.unauthorized(message: "Enter the admin token first.") }
        let res: Codes = try await api.send(.adminAuthCodes(token: token))
        return res.codes ?? []
    }

    func broadcast(_ text: String) async throws {
        guard let token else { throw APIError.unauthorized(message: "Enter the admin token first.") }
        struct Res: Decodable { let delivered: Int? }
        let _: Res = try await api.send(.adminBroadcast(token: token, text: text))
    }
}
