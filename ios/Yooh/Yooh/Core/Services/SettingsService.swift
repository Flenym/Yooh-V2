import Foundation

/// Settings sync, feedback, support tickets, sticker packs.
final class SettingsService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func fetch() async throws -> [String: AnyCodable] {
        struct Env: Decodable { let settings: [String: AnyCodable]? }
        let env: Env = try await api.send(.mySettings)
        return env.settings ?? [:]
    }

    func patch(section: String, value: Any) async throws {
        struct Res: Decodable { let settings: AnyCodable? }
        let _: Res = try await api.send(.patchSettings([section: value]))
    }

    func sendFeedback(category: String, message: String) async throws {
        struct Res: Decodable { let ticket: AnyCodable? }
        let _: Res = try await api.send(.sendFeedback(category: category, message: message))
    }

    func supportTicketState() async throws -> SupportStateResponse {
        try await api.send(.supportTicketState)
    }

    func createSupportTicket(category: String) async throws {
        struct Res: Decodable { let ticket: AnyCodable? }
        let _: Res = try await api.send(.createSupportTicket(category: category))
    }

    func stickerPacks() async throws -> [StickerPack] {
        let res: StickerPacksResponse = try await api.send(.stickerPacks)
        return res.packs ?? []
    }
}
