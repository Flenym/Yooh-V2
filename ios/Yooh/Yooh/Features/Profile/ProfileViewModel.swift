import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class ProfileViewModel {
    private(set) var isSaving = false
    private(set) var error: String?
    private(set) var notice: String?

    var displayName = ""
    var username = ""
    var about = ""

    var app: AppState! = nil

    var user: YoohUser? { app.session.currentUser }

    func clearError() { error = nil; notice = nil }

    func beginEditing() {
        guard let u = user else { return }
        displayName = u.displayName
        username = u.username
        about = u.about
        error = nil
        notice = nil
    }

    func reload() async {
        do {
            let me = try await app.userService.me()
            app.session.updateUser(me)
        } catch {
            // Silent refresh.
        }
    }

    func save() async -> Bool {
        error = nil
        notice = nil
        guard Validation.validateDisplayName(displayName) else { error = "Enter your name."; return false }
        guard Validation.validateUsername(username) else { error = "Username: 5–32 letters, digits or _."; return false }
        guard about.count <= 280 else { error = "About is too long (max 280)."; return false }
        return await saveFields([
            "displayName": displayName.trimmingCharacters(in: .whitespaces),
            "username": username.trimmingCharacters(in: .whitespaces).lowercased(),
            "about": about,
        ])
    }

    func saveAvatar(_ image: UIImage) async -> Bool {
        error = nil
        guard let dataURL = Self.avatarDataURL(image) else {
            error = "Couldn't process the image."
            return false
        }
        return await saveFields(["avatar": dataURL], notice: "Photo updated.")
    }

    func saveBanner(_ image: UIImage) async -> Bool {
        error = nil
        guard let dataURL = Self.bannerDataURL(image) else {
            error = "Couldn't process the image."
            return false
        }
        return await saveFields(["banner": dataURL], notice: "Banner updated.")
    }

    @discardableResult
    func saveFields(_ fields: [String: Any], notice successNotice: String = "Profile updated.") async -> Bool {
        error = nil
        notice = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await app.userService.updateProfile(fields: fields)
            app.session.updateUser(updated)
            notice = successNotice
            Haptics.send()
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    static func avatarDataURL(_ image: UIImage) -> String? {
        guard let data = downscaledJPEG(image, maxDimension: 512, quality: 0.8, maxBytes: 1_900_000) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    static func bannerDataURL(_ image: UIImage) -> String? {
        guard let data = downscaledJPEG(image, maxDimension: 1024, quality: 0.8, maxBytes: 1_900_000) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    static func storyImageDataURL(_ image: UIImage) -> String? {
        guard let data = downscaledJPEG(image, maxDimension: 1600, quality: 0.85, maxBytes: 14_000_000) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    static func downscaledJPEG(_ image: UIImage, maxDimension: CGFloat, quality: CGFloat, maxBytes: Int) -> Data? {
        let size = image.size
        let scale = min(1, maxDimension / max(size.width, size.height))
        let target = CGSize(width: max(1, size.width * scale), height: max(1, size.height * scale))
        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
        var q = quality
        var data = resized.jpegData(compressionQuality: q)
        while let d = data, d.count > maxBytes, q > 0.2 {
            q -= 0.15
            data = resized.jpegData(compressionQuality: q)
        }
        return data
    }
}
