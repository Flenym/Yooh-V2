import Foundation

/// Call history + signaling passthrough.
///
/// Media scope: live audio/video needs a WebRTC engine (not vendored in
/// this build). History, deletion and incoming-call alerts are fully real;
/// the in-call media screen is surfaced as unavailable, never faked.
final class CallService {
    private let api: APIClient
    let socket: YoohSocket

    init(api: APIClient = .shared, socket: YoohSocket) {
        self.api = api
        self.socket = socket
    }

    func history(limit: Int = 200) async throws -> [CallLog] {
        let res: CallListResponse = try await api.send(.calls(limit: limit))
        return res.calls
    }

    func delete(_ id: String) async throws {
        struct Res: Decodable { let removed: Bool? }
        let _: Res = try await api.send(.deleteCall(id))
    }

    func webrtcConfig() async throws -> WebRTCConfig {
        try await api.send(.webrtcConfig)
    }

    func start(chatId: String, video: Bool) async throws -> [String: Any]? {
        try await socket.callStart(chatId: chatId, mode: video ? "video" : "audio")
    }

    func accept(sessionId: String, chatId: String) async throws {
        _ = try await socket.callAccept(sessionId: sessionId, chatId: chatId)
    }

    func decline(sessionId: String, chatId: String, busy: Bool = false) async throws {
        try await socket.callDecline(sessionId: sessionId, chatId: chatId, reason: busy ? "busy" : "declined")
    }

    func hangup(sessionId: String, chatId: String) async throws {
        try await socket.callHangup(sessionId: sessionId, chatId: chatId)
    }
}
