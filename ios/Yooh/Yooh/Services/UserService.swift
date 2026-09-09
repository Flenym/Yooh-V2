import Foundation

/// Own profile, user search and username checks.
final class UserService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func me() async throws -> YoohUser {
        struct Env: Decodable { let user: YoohUser }
        let env: Env = try await api.send(.me)
        return env.user
    }

    @discardableResult
    func updateProfile(fields: [String: Any]) async throws -> YoohUser {
        struct Env: Decodable { let user: YoohUser }
        let env: Env = try await api.send(.patchProfile(fields))
        return env.user
    }

    func usernameAvailability(_ username: String) async throws -> (available: Bool, isCurrent: Bool) {
        struct Res: Decodable {
            let username: String?
            let available: Bool?
            let isCurrent: Bool?
        }
        let res: Res = try await api.send(.usernameAvailability(username.lowercased()))
        return (res.available ?? false, res.isCurrent ?? false)
    }

    func searchUsers(query: String) async throws -> [PublicUser] {
        let res: UserSearchResponse = try await api.send(.searchUsers(query: query))
        return res.users ?? []
    }

    func searchBots(query: String) async throws -> [PublicUser] {
        let res: UserSearchResponse = try await api.send(.searchUsers(query: query, botsOnly: true))
        return res.users ?? []
    }
}
