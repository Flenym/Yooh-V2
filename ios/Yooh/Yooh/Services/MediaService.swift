import Foundation
import UIKit

/// File upload/download + avatar data-URL helpers.
///
/// Uploads go to `POST /api/chats/:id/files` (multipart, field `file`);
/// downloads use `GET /api/files/:id/{inline,download}?token=<JWT>`
/// (query-token auth is required because plain <img>-style fetches
/// carry no headers — same as the web client).
final class MediaService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func upload(chatId: String, data: Data, filename: String, mimeType: String,
                text: String? = nil, stream: MessageStream = .main,
                replyToMessageId: String? = nil) async throws -> YoohMessage {
        var fields: [String: String] = [
            "stream": stream.rawValue,
            "clientMessageId": UUID().uuidString,
        ]
        if let text, !text.isEmpty { fields["text"] = text }
        if let replyToMessageId { fields["replyToMessageId"] = replyToMessageId }
        let res: SingleMessageResponse = try await api.upload(
            path: "/api/chats/\(chatId)/files",
            fileData: data, filename: filename, mimeType: mimeType, fields: fields)
        return res.message
    }

    /// Authenticated URL for inline display / download.
    func fileURL(fileId: String, inline: Bool, token: String) -> URL? {
        let leaf = inline ? "inline" : "download"
        var c = URLComponents(url: AppConfig.baseURL, resolvingAgainstBaseURL: false)
        c?.path = "/api/files/\(fileId)/\(leaf)"
        c?.queryItems = [URLQueryItem(name: "token", value: token)]
        return c?.url
    }

    func downloadData(fileId: String, inline: Bool, token: String) async throws -> Data {
        let leaf = inline ? "inline" : "download"
        let (data, _) = try await api.downloadData(
            path: "/api/files/\(fileId)/\(leaf)",
            query: [URLQueryItem(name: "token", value: token)])
        return data
    }

    // MARK: - Data URLs (avatars, story media, sticker images)

    /// Decodes `data:<mime>;base64,...` payloads the server embeds in JSON.
    static func data(fromDataURL url: String) -> Data? {
        guard url.hasPrefix("data:"),
              let comma = url.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(url[url.index(after: comma)...]))
    }
}
