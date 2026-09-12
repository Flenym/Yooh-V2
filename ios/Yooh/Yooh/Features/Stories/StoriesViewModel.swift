import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class StoriesViewModel {
    private(set) var stories: [YoohStory] = []
    private(set) var isLoading = false
    private(set) var error: String?

    var app: AppState! = nil

    var groups: [(authorId: String, author: PublicUser?, stories: [YoohStory])] {
        let grouped = Dictionary(grouping: stories, by: { $0.authorId ?? "?" })
        let me = app.session.currentUser?.id
        return grouped.map { (authorId: $0.key, author: $0.value.first?.author, stories: $0.value) }
            .sorted { a, b in
                if (a.authorId == me) != (b.authorId == me) { return a.authorId == me }
                return (a.stories.first?.createdAt ?? "") > (b.stories.first?.createdAt ?? "")
            }
    }

    func clearError() { error = nil }

    func refresh() async {
        guard app.session.isAuthenticated else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            stories = try await app.storyService.list()
        } catch {
            if !((error as? APIError)?.isAuthExpired ?? false) {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func view(_ story: YoohStory) async {
        do {
            let updated = try await app.storyService.view(story.id)
            upsert(updated)
        } catch {
            // Best-effort.
        }
    }

    func react(_ story: YoohStory, emoji: String?) async {
        do {
            let updated = try await app.storyService.react(story.id, emoji: emoji)
            upsert(updated)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func delete(_ story: YoohStory) async {
        do {
            try await app.storyService.delete(story.id)
            stories.removeAll { $0.id == story.id }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func reply(_ story: YoohStory, text: String) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            let updated = try await app.storyService.comment(story.id, text: trimmed)
            upsert(updated)
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func saveCaption(_ story: YoohStory, caption: String) async -> Bool {
        do {
            let updated = try await app.storyService.patch(
                story.id, caption: caption.trimmingCharacters(in: .whitespacesAndNewlines))
            upsert(updated)
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func toggleSaveToProfile(_ story: YoohStory) async {
        do {
            let updated = try await app.storyService.patch(
                story.id, saveToProfile: !(story.saveToProfile ?? false))
            upsert(updated)
            Haptics.selection()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func liveStory(id: String) -> YoohStory? {
        stories.first(where: { $0.id == id })
    }

    func publishPhoto(_ image: UIImage, caption: String?) async -> Bool {
        guard let dataURL = ProfileViewModel.storyImageDataURL(image) else {
            error = "Couldn't process the image."
            return false
        }
        do {
            let created = try await app.storyService.create(
                CreateStoryRequest(caption: caption, image: dataURL,
                                   mediaType: "image", privacy: "contacts",
                                   expiresHours: 24))
            stories.insert(created, at: 0)
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func publishVideo(_ data: Data, caption: String?) async -> Bool {
        guard data.count <= 25 * 1024 * 1024 else {
            error = "Video is too large (25 MB max)."
            return false
        }
        let dataURL = "data:video/mp4;base64,\(data.base64EncodedString())"
        do {
            let created = try await app.storyService.create(
                CreateStoryRequest(caption: caption, image: nil, video: dataURL,
                                   mediaType: "video", privacy: "contacts",
                                   expiresHours: 24))
            stories.insert(created, at: 0)
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    private func upsert(_ story: YoohStory) {
        if let idx = stories.firstIndex(where: { $0.id == story.id }) {
            stories[idx] = story
        }
    }
}
