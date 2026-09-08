import Foundation

/// Stories feed, creation (base64 media in JSON, like the web client),
/// views and reactions (`/api/stories/*`).
final class StoryService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func list() async throws -> [YoohStory] {
        let res: StoryListResponse = try await api.send(.stories)
        return res.stories ?? []
    }

    func create(_ body: CreateStoryRequest) async throws -> YoohStory {
        let res: SingleStoryResponse = try await api.send(.createStory(body))
        return res.story
    }

    func delete(_ id: String) async throws {
        struct Res: Decodable { let deleted: Bool? }
        let _: Res = try await api.send(.deleteStory(id))
    }

    @discardableResult
    func view(_ id: String) async throws -> YoohStory {
        let res: SingleStoryResponse = try await api.send(.viewStory(id))
        return res.story
    }

    @discardableResult
    func react(_ id: String, emoji: String?) async throws -> YoohStory {
        let res: SingleStoryResponse = try await api.send(.reactToStory(id, emoji: emoji))
        return res.story
    }
}
