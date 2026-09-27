import Foundation

/// Tenor GIF search (same public key as the web client).
struct GifItem: Identifiable, Hashable {
    let id: String
    let previewURL: URL?
    let fullURL: URL?
}

final class GifService {
    static let shared = GifService()

    private let key = "LIVDSRZULELA"
    private let clientKey = "yooh-ios"

    private struct TenorResponse: Decodable {
        struct Result: Decodable {
            let id: String?
            let media_formats: [String: Media]?
            struct Media: Decodable { let url: String? }
        }
        let results: [Result]?
    }

    func featured() async throws -> [GifItem] {
        try await fetch(endpoint: "featured", query: nil)
    }

    func search(_ q: String) async throws -> [GifItem] {
        try await fetch(endpoint: "search", query: q)
    }

    func data(for item: GifItem) async throws -> Data {
        guard let url = item.fullURL ?? item.previewURL else {
            throw APIError.validation(message: "Нет ссылки на GIF.")
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    }

    private func fetch(endpoint: String, query: String?) async throws -> [GifItem] {
        var c = URLComponents(string: "https://tenor.googleapis.com/v2/\(endpoint)")!
        var items = [
            URLQueryItem(name: "key", value: key),
            URLQueryItem(name: "client_key", value: clientKey),
            URLQueryItem(name: "limit", value: "24"),
            URLQueryItem(name: "locale", value: "ru_RU"),
            URLQueryItem(name: "media_filter", value: "tinygif,gif"),
            URLQueryItem(name: "contentfilter", value: "medium"),
        ]
        if let query, !query.isEmpty {
            items.append(URLQueryItem(name: "q", value: query))
        }
        c.queryItems = items
        guard let url = c.url else { throw APIError.network(URLError(.badURL)) }
        let (data, _) = try await URLSession.shared.data(from: url)
        let res = try JSONDecoder().decode(TenorResponse.self, from: data)
        return (res.results ?? []).compactMap { r in
            guard let id = r.id, !id.isEmpty else { return nil }
            let preview = r.media_formats?["tinygif"]?.url ?? r.media_formats?["gifpreview"]?.url
            let full = r.media_formats?["gif"]?.url
            guard preview != nil || full != nil else { return nil }
            return GifItem(id: id,
                           previewURL: preview.flatMap(URL.init(string:)),
                           fullURL: full.flatMap(URL.init(string:)))
        }
    }
}
