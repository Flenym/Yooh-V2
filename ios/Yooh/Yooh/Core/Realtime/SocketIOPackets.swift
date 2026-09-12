import Foundation

// MARK: - Engine.IO v4 + Socket.IO v5 packet codec
//
// Server: socket.io 4.x, default namespace, transports
// ["websocket", "polling"]. engine.io-parser v6 joins polling packets
// with ASCII Record Separator (\x1E) — never length-prefixed.

struct EnginePacket {
    /// '0' open, '1' close, '2' ping, '3' pong, '4' message, '5' upgrade, '6' noop
    let type: Character
    let body: String

    var raw: String { "\(type)\(body)" }
}

struct SIOPacket {
    /// '0' connect, '1' disconnect, '2' event, '3' ack, '4' connect_error
    let type: Character
    let ackId: Int?
    /// For events: [name, arg1, ...].
    let args: [Any]

    var eventName: String? { args.first as? String }
}

struct EngineOpenHandshake: Decodable {
    let sid: String
    let upgrades: [String]?
    let pingInterval: Int?
    let pingTimeout: Int?
    let maxPayload: Int?
}

enum PacketCodec {
    static let separator: Character = "\u{1E}"

    static func encodePollingPayload(_ packets: [EnginePacket]) -> Data {
        Data(packets.map(\.raw).joined(separator: String(separator)).utf8)
    }

    static func decodePollingPayload(_ data: Data) -> [EnginePacket] {
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return [] }
        return text.split(separator: separator, omittingEmptySubsequences: true).compactMap { part in
            guard let first = part.first else { return nil }
            return EnginePacket(type: first, body: String(part.dropFirst()))
        }
    }

    static func decodeSIO(_ engineBody: String) -> SIOPacket? {
        guard let type = engineBody.first else { return nil }
        var rest = engineBody.dropFirst()
        var ackId: Int? = nil
        let digits = rest.prefix(while: { $0.isNumber })
        if !digits.isEmpty {
            ackId = Int(digits)
            rest = rest.dropFirst(digits.count)
        }
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
