import Foundation

// MARK: - Engine.IO v4 + Socket.IO v5 packet codec
//
// The Yooh server runs socket.io 4.x on the default namespace `/`
// with transports ["websocket", "polling"] (see src/server/realtime.js).
// Packet layouts below follow the Engine.IO v4 / Socket.IO v5 wire
// protocol exactly; no third-party dependency is used.

/// A raw Engine.IO packet: single-char type + UTF-8 body.
struct EnginePacket {
    /// '0' open, '1' close, '2' ping, '3' pong, '4' message, '5' upgrade, '6' noop
    let type: Character
    let body: String

    var raw: String { "\(type)\(body)" }
}

/// A Socket.IO packet carried inside an Engine.IO `4` (message) packet.
/// Default namespace `/` is always implicit (never serialized).
struct SIOPacket {
    /// '0' connect, '1' disconnect, '2' event, '3' ack, '4' connect_error
    let type: Character
    /// Numeric ack id (client→server emits and server→client acks).
    let ackId: Int?
    /// Decoded JSON arguments. For events: [name, arg1, arg2, ...].
    let args: [Any]

    var eventName: String? { args.first as? String }
}

/// `0{...}` open packet from the polling handshake.
struct EngineOpenHandshake: Decodable {
    let sid: String
    let upgrades: [String]?
    let pingInterval: Int?
    let pingTimeout: Int?
    let maxPayload: Int?
}

enum PacketCodec {
    // MARK: - Polling payload framing (engine.io-parser v6 / EIO v4)
    //
    // Polling bodies are packets joined by ASCII Record Separator (\x1E),
    // NOT length-prefixed (that was protocol v3). The handshake response
    // is a single bare packet. Verified against the vendored server's
    // node_modules/engine.io-parser (encodePayload/decodePayload).

    /// Record Separator joining packets in polling bodies.
    static let separator: Character = "\u{1E}"

    /// Encodes packets for a polling POST body.
    static func encodePollingPayload(_ packets: [EnginePacket]) -> Data {
        Data(packets.map(\.raw).joined(separator: String(separator)).utf8)
    }

    /// Decodes a polling response/long-poll body into packets.
    static func decodePollingPayload(_ data: Data) -> [EnginePacket] {
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return [] }
        return text.split(separator: separator, omittingEmptySubsequences: true).compactMap { part in
            guard let first = part.first else { return nil }
            return EnginePacket(type: first, body: String(part.dropFirst()))
        }
    }

    // MARK: - Socket.IO framing

    /// Parses `4...` Engine message bodies into Socket.IO packets.
    static func decodeSIO(_ engineBody: String) -> SIOPacket? {
        guard let type = engineBody.first else { return nil }
        var rest = engineBody.dropFirst()
        var ackId: Int? = nil
        // Optional numeric ack id directly after the type (default namespace).
        let digits = rest.prefix(while: { $0.isNumber })
        if !digits.isEmpty {
            ackId = Int(digits)
            rest = rest.dropFirst(digits.count)
        }
        // Named namespace (`/foo,...`) is never used by Yooh; reject it.
        if rest.first == "/" { return nil }
        if rest.first == "," { rest = rest.dropFirst() }
        let jsonText = String(rest)
        let args: [Any]
        if jsonText.isEmpty {
            args = []
        } else {
            guard let data = jsonText.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            else { return nil }
            if let arr = json as? [Any] {
                args = arr
            } else {
                args = [json]
            }
        }
        return SIOPacket(type: type, ackId: ackId, args: args)
    }

    /// Encodes a client→server event: `42["name",payload]` or `42<id>[...]`.
    static func encodeEvent(name: String, payload: Any?, ackId: Int?) throws -> EnginePacket {
        var arr: [Any] = [name]
        if let payload { arr.append(payload) }
        let data = try JSONSerialization.data(withJSONObject: arr, options: [])
        guard let json = String(data: data, encoding: .utf8) else {
            throw PacketCodecError.jsonEncoding
        }
        let prefix = ackId.map(String.init) ?? ""
        return EnginePacket(type: "4", body: "2\(prefix)\(json)")
    }

    /// Encodes the namespace CONNECT carrying handshake auth: `40{"token":"..."}`.
    static func encodeConnect(auth: [String: Any]) throws -> EnginePacket {
        let data = try JSONSerialization.data(withJSONObject: auth, options: [])
        guard let json = String(data: data, encoding: .utf8) else {
            throw PacketCodecError.jsonEncoding
        }
        return EnginePacket(type: "4", body: "0\(json)")
    }

    enum PacketCodecError: Error {
        case jsonEncoding
    }
}
