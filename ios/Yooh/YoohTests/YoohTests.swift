import XCTest
@testable import Yooh

/// Unit tests for the critical, backend-coupled logic:
/// wire protocol codec, validation parity and JSON decoding of real
/// server shapes. Run in Xcode: Product → Test (⌘U).
final class YoohWireTests: XCTestCase {

    // MARK: - Engine.IO polling framing (v6: \x1E-separated, never length-prefixed)

    func testPollingRoundTrip() throws {
        let packets = [
            EnginePacket(type: "4", body: "40{\"sid\":\"abc\"}"),
            EnginePacket(type: "4", body: "42[\"chat:typing\",{\"chatId\":\"1\",\"active\":true}]"),
        ]
        let data = PacketCodec.encodePollingPayload(packets)
        let back = PacketCodec.decodePollingPayload(data)
        XCTAssertEqual(back.map(\.raw), packets.map(\.raw))
    }

    func testPollingSeparatorWithEmoji() throws {
        // Emoji must survive the separator framing untouched.
        let bodies = ["42[\"chat:message\",{\"text\":\"Hi 😀\"}]", "2"]
        let packets = bodies.map { EnginePacket(type: $0.first!, body: String($0.dropFirst())) }
        let back = PacketCodec.decodePollingPayload(PacketCodec.encodePollingPayload(packets))
        XCTAssertEqual(back.map(\.raw), bodies)
        XCTAssertFalse(String(data: PacketCodec.encodePollingPayload(packets), encoding: .utf8)!.contains(":"))
    }

    func testHandshakeOpenDecodes() throws {
        let json = "{\"sid\":\"s1\",\"upgrades\":[\"websocket\"],\"pingInterval\":20000,\"pingTimeout\":120000}"
        let data = PacketCodec.encodePollingPayload([EnginePacket(type: "0", body: json)])
        let packets = PacketCodec.decodePollingPayload(data)
        XCTAssertEqual(packets.count, 1)
        let hs = try JSONDecoder().decode(EngineOpenHandshake.self,
                                          from: Data(packets[0].body.utf8))
        XCTAssertEqual(hs.sid, "s1")
        XCTAssertEqual(hs.upgrades, ["websocket"])
        XCTAssertEqual(hs.pingInterval, 20000)
    }

    func testBareHandshakeDecodes() throws {
        // The real server answers the handshake with ONE unframed packet.
        let raw = "0{\"sid\":\"s1\",\"upgrades\":[\"websocket\"],\"pingInterval\":20000,\"pingTimeout\":120000}"
        let packets = PacketCodec.decodePollingPayload(Data(raw.utf8))
        XCTAssertEqual(packets.count, 1)
        XCTAssertEqual(packets.first?.type, "0")
        let hs = try JSONDecoder().decode(EngineOpenHandshake.self,
                                          from: Data(packets[0].body.utf8))
        XCTAssertEqual(hs.sid, "s1")
    }

    // MARK: - Socket.IO framing

    func testJoinEncodesBareStringPayload() throws {
        // Server expects chat:join with a raw string chatId (realtime.js).
        let p = try PacketCodec.encodeEvent(name: "chat:join", payload: "chat-1", ackId: nil)
        XCTAssertEqual(p.raw, "42[\"chat:join\",\"chat-1\"]")
        let sio = PacketCodec.decodeSIO(p.body)
        XCTAssertEqual(sio?.type, "2")
        XCTAssertEqual(sio?.eventName, "chat:join")
        XCTAssertNil(sio?.ackId)
    }

    func testAckIdRoundTrip() throws {
        let p = try PacketCodec.encodeEvent(name: "chat:read",
                                            payload: ["chatId": "c", "messageId": "m"],
                                            ackId: 12)
        XCTAssertTrue(p.raw.hasPrefix("4212["))
        let sio = PacketCodec.decodeSIO(p.body)
        XCTAssertEqual(sio?.ackId, 12)
        XCTAssertEqual(sio?.eventName, "chat:read")
    }

    func testConnectCarriesToken() throws {
        let p = try PacketCodec.encodeConnect(auth: ["token": "jwt-here"])
        XCTAssertTrue(p.raw.hasPrefix("40"))
        let sio = PacketCodec.decodeSIO(p.body)
        XCTAssertEqual(sio?.type, "0")
        let auth = sio?.args.first as? [String: Any]
        XCTAssertEqual(auth?["token"] as? String, "jwt-here")
    }

    func testServerAckDecodes() throws {
        let sio = PacketCodec.decodeSIO("3" + "7[{\"ok\":true,\"updatedCount\":3}]")
        XCTAssertEqual(sio?.type, "3")
        XCTAssertEqual(sio?.ackId, 7)
    }

    // MARK: - Validation parity with server (utils.js / zod)

    func testPhoneNormalization() {
        XCTAssertNotNil(Validation.normalizePhone("+12345678901"))
        XCTAssertNotNil(Validation.normalizePhone("1234567890"))
        XCTAssertNil(Validation.normalizePhone("123"))
        XCTAssertNil(Validation.normalizePhone("0123456789"))
    }

    func testUsernameRules() {
        XCTAssertTrue(Validation.validateUsername("alice_01"))
        XCTAssertFalse(Validation.validateUsername("ab"))
        XCTAssertFalse(Validation.validateUsername("has space"))
        XCTAssertFalse(Validation.validateUsername("кириллица"))
    }

    func testCodeRules() {
        XCTAssertTrue(Validation.validateCode("123456"))
        XCTAssertFalse(Validation.validateCode("12345"))
        XCTAssertFalse(Validation.validateCode("12345a"))
    }

    // MARK: - Real server JSON shapes

    func testMessageDecoding() throws {
        let json = """
        {"id":"m1","chatId":"c1","senderId":"u1","type":"text","text":"Hello",
         "stream":"main","sender":{"id":"u1","username":"alice","displayName":"Alice","isPremium":true},
         "reactions":[{"emoji":"❤️","count":2,"mine":true}],"readByUserIds":["u1","u2"],
         "replyTo":{"id":"m0","text":"Hi","deleted":false},
         "poll":{"question":"Q?","anonymous":false,"multiple":false,"quiz":false,
                 "options":[{"id":"o1","text":"A","count":1,"mine":true}],"totalVotes":1},
         "createdAt":"2026-09-01T10:00:00.000Z"}
        """
        let m = try JSONDecoder().decode(YoohMessage.self, from: Data(json.utf8))
        XCTAssertEqual(m.id, "m1")
        XCTAssertEqual(m.sender?.displayName, "Alice")
        XCTAssertEqual(m.reactions.first?.mine, true)
        XCTAssertEqual(m.replyTo?.id, "m0")
        XCTAssertEqual(m.poll?.options.first?.id, "o1")
        XCTAssertEqual(m.readByUserIds.count, 2)
    }

    func testChatDecoding() throws {
        let json = """
        {"id":"c1","type":"direct","description":"","isPublic":false,
         "myRole":"member","members":[{"userId":"u1","username":"alice","displayName":"Alice","role":"member"}],
         "membersCount":2,
         "lastMessage":{"id":"m1","chatId":"c1","senderId":"u1","type":"text","text":"Hi",
                        "stream":"main","reactions":[],"readByUserIds":["u1"],
                        "createdAt":"2026-09-01T10:00:00.000Z"}}
        """
        let c = try JSONDecoder().decode(YoohChat.self, from: Data(json.utf8))
        XCTAssertEqual(c.type, .direct)
        XCTAssertEqual(c.membersCount, 2)
        XCTAssertEqual(c.lastMessage?.text, "Hi")
        XCTAssertTrue(c.hasUnread(myUserId: "u2"))
        XCTAssertFalse(c.hasUnread(myUserId: "u1"))
    }

    func testErrorBodyDecoding() throws {
        let json = "{\"error\":\"Validation failed\",\"details\":[{\"path\":\"text\"}]}"
        let body = try JSONDecoder().decode(APIErrorBody.self, from: Data(json.utf8))
        XCTAssertEqual(body.error, "Validation failed")
    }

    func testAnyCodableRoundTrip() throws {
        let v: AnyCodable = .object(["a": .int(1), "b": .array([.string("x"), .bool(true), .null])])
        let data = try JSONEncoder().encode(v)
        XCTAssertEqual(try JSONDecoder().decode(AnyCodable.self, from: data), v)
    }
}
