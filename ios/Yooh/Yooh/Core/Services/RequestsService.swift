import Foundation

/// Message-request inbox + Stars transfers.
final class RequestsService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func inbox() async throws -> (incoming: [MessageRequest], outgoing: [MessageRequest]) {
        let res: RequestsResponse = try await api.send(.messageRequests)
        return (res.incoming ?? [], res.outgoing ?? [])
    }

    @discardableResult
    func sendRequest(userId: String, text: String?) async throws -> RequestResult {
        let clean = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await api.send(.createMessageRequest(
            userId: userId, text: (clean?.isEmpty ?? true) ? nil : clean))
    }

    @discardableResult
    func accept(_ id: String) async throws -> RequestResult {
        try await api.send(.acceptRequest(id))
    }

    func decline(_ id: String) async throws {
        struct Res: Decodable { let request: AnyCodable? }
        let _: Res = try await api.send(.declineRequest(id))
    }
}
