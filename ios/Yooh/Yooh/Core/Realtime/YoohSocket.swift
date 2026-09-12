import Foundation
import os

// MARK: - Typed domain events (server → client)

enum YoohSocketEvent {
    case message(YoohMessage)
    case messageUpdated(YoohMessage)
    case messageDeleted(chatId: String, messageId: String?, stream: String?)
    case chatUpdated(chatId: String)
    case typing(chatId: String, active: Bool, action: String, from: PublicUser?)
    case read(chatId: String, stream: String?, messageId: String?, from: PublicUser?)
    case presenceSnapshot(online: [String], lastSeen: [String: String])
    case presenceUpdate(userId: String, online: Bool, lastSeenAt: String?)
    case settingsUpdated
    case requestsUpdated
    case storyUpdated(storyId: String?)
    case callsUpdated
    case sessionRevoked(sessionIds: [String])
    case call(CallSignal)
    case connectError(message: String)
}

struct CallSignal {
    enum Kind: String {
        case incoming, accepted, participants, declined
        case participantLeft = "participant-left"
        case hangup, signal
    }
    let kind: Kind
    let sessionId: String?
    let chatId: String?
    let mode: String?
    let from: PublicUser?
    let participants: [PublicUser]?
    let reason: String?
    let userId: String?
    let signalType: String?
    let signal: AnyCodable?
    let toUserId: String?
}

protocol YoohSocketDelegate: AnyObject {
    func socket(_ socket: YoohSocket, didReceive event: YoohSocketEvent)
    func socketDidConnect(_ socket: YoohSocket)
    func socketDidDisconnect(_ socket: YoohSocket)
}

// MARK: - Socket

/// Realtime connection: Engine.IO transport + Socket.IO framing + domain
/// events + reconnect policy (mirrors web `connectSocket`).
final class YoohSocket {
    enum ConnectionState { case disconnected, connecting, connected }

    weak var delegate: YoohSocketDelegate?

    private(set) var state: ConnectionState = .disconnected {
        didSet { onStateChange?(state) }
    }

    var onStateChange: ((ConnectionState) -> Void)?

    private let log = Logger(subsystem: AppConfig.bundleID, category: "socket")
    private let transport = EngineIOClient()
    private let api = APIClient.shared

    private var token: String?
    private var ackSeq = 0
    private var pendingAcks: [Int: CheckedContinuation<Any?, Error>] = [:]
    private let ackLock = NSLock()

    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var sioConnected = false
    private var namespaceConnectSent = false
    private let decoder = JSONDecoder()

    init() {
        transport.onPacket = { [weak self] packet in self?.handleEnginePacket(packet) }
        transport.onState = { [weak self] state in
            guard let self else { return }
            if case .open = state, !self.namespaceConnectSent {
                self.namespaceConnectSent = true
                self.sendNamespaceConnect()
            }
        }
    }

    var isConnected: Bool { state == .connected }

    func connect(token: String) {
        disconnect(silent: true)
        self.token = token
        reconnectAttempt = 0
        openTransport()
    }

    func disconnect(silent: Bool = false) {
        reconnectTask?.cancel()
        reconnectTask = nil
        transport.disconnect()
        failAllAcks(APIError.network(URLError(.cancelled)))
        sioConnected = false
        namespaceConnectSent = false
        if !silent {
            state = .disconnected
            delegate?.socketDidDisconnect(self)
        } else {
            state = .disconnected
        }
    }

    private func openTransport() {
        guard token != nil else { return }
        namespaceConnectSent = false
        state = .connecting
        transport.connect(baseURL: AppConfig.baseURL)
    }

    private func handleEnginePacket(_ packet: EnginePacket) {
        switch packet.type {
        case "4":
            guard let sio = PacketCodec.decodeSIO(packet.body) else { return }
            handleSIOPacket(sio)
        case "1":
            handleTransportClose()
        default:
            break
        }
    }

    private func handleSIOPacket(_ sio: SIOPacket) {
        switch sio.type {
        case "0":
            sioConnected = true
            reconnectAttempt = 0
            state = .connected
            delegate?.socketDidConnect(self)
        case "2":
            guard let name = sio.eventName else { return }
            dispatchEvent(name: name, args: Array(sio.args.dropFirst()))
        case "3":
            if let id = sio.ackId {
                let payload = sio.args.first
                resolveAck(id: id, payload: payload)
            }
        case "4":
            let message = (sio.args.first as? [String: Any])?["message"] as? String ?? "connect_error"
            #if DEBUG
            log.error("SIO connect_error: \(message, privacy: .public)")
            #endif
            delegate?.socket(self, didReceive: .connectError(message: message))
            if message.lowercased().contains("invalid") || message.contains("401") {
                reconnectTask?.cancel()
                reconnectTask = nil
                api.onUnauthorized?()
            }
        default:
            break
        }
    }

    private func handleTransportClose() {
        sioConnected = false
        if state == .connected {
            state = .connecting
            delegate?.socketDidDisconnect(self)
        }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard token != nil, reconnectTask == nil else { return }
        reconnectAttempt += 1
        let delay = min(0.9 * pow(1.5, Double(min(reconnectAttempt, 8))), 5.0)
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self.reconnectTask = nil
            self.transport.disconnect()
            self.openTransport()
        }
    }

    // MARK: - Emit

    func emit(name: String, payload: Any?) {
        do {
            let packet = try PacketCodec.encodeEvent(name: name, payload: payload, ackId: nil)
            transport.send(packet)
        } catch {
            #if DEBUG
            log.error("emit encode failed")
            #endif
        }
    }

    func emitWithAck(name: String, payload: Any?, timeout: TimeInterval = 10) async throws -> Any? {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Any?, Error>) in
            ackLock.lock()
            ackSeq += 1
            let id = ackSeq
            pendingAcks[id] = cont
            ackLock.unlock()
            do {
                let packet = try PacketCodec.encodeEvent(name: name, payload: payload, ackId: id)
                transport.send(packet)
            } catch {
                failAck(id: id, error: error)
                return
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                self.failAck(id: id, error: APIError.network(URLError(.timedOut)))
            }
        }
    }

    private func resolveAck(id: Int, payload: Any?) {
        ackLock.lock()
        let cont = pendingAcks.removeValue(forKey: id)
        ackLock.unlock()
        cont?.resume(returning: payload)
    }

    private func failAck(id: Int, error: Error) {
        ackLock.lock()
        let cont = pendingAcks.removeValue(forKey: id)
        ackLock.unlock()
        cont?.resume(throwing: error)
    }

    private func failAllAcks(_ error: Error) {
        ackLock.lock()
        let all = pendingAcks
        pendingAcks.removeAll()
        ackLock.unlock()
        for (_, cont) in all { cont.resume(throwing: error) }
    }

    // MARK: - Domain emits

    func joinChat(_ chatId: String) {
        emit(name: "chat:join", payload: chatId)
    }

    func sendTyping(chatId: String, active: Bool, action: String = "text") {
        emit(name: "chat:typing", payload: ["chatId": chatId, "active": active, "action": action])
    }

    @discardableResult
    func sendRead(chatId: String, stream: String = "main", messageId: String) async throws -> Int {
        let ack = try await emitWithAck(name: "chat:read",
                                        payload: ["chatId": chatId, "stream": stream, "messageId": messageId])
        return (ack as? [String: Any])?["updatedCount"] as? Int ?? 0
    }

    func callStart(chatId: String, mode: String) async throws -> [String: Any]? {
        try await emitWithAck(name: "call:start", payload: ["chatId": chatId, "mode": mode]) as? [String: Any]
    }

    func callAccept(sessionId: String, chatId: String) async throws -> [String: Any]? {
        try await emitWithAck(name: "call:accept", payload: ["sessionId": sessionId, "chatId": chatId]) as? [String: Any]
    }

    func callDecline(sessionId: String, chatId: String, reason: String = "declined") async throws {
        _ = try await emitWithAck(name: "call:decline",
                                  payload: ["sessionId": sessionId, "chatId": chatId, "reason": reason])
    }

    func callHangup(sessionId: String, chatId: String) async throws {
        _ = try await emitWithAck(name: "call:hangup",
                                  payload: ["sessionId": sessionId, "chatId": chatId])
    }

    func callSignal(sessionId: String, chatId: String, signalType: String, signal: Any, toUserId: String? = nil) {
        var payload: [String: Any] = ["sessionId": sessionId, "chatId": chatId,
                                      "signalType": signalType, "signal": signal]
        if let toUserId { payload["toUserId"] = toUserId }
        emit(name: "call:signal", payload: payload)
    }

    // MARK: - Incoming dispatch

    private func dispatchEvent(name: String, args: [Any]) {
        let obj = args.first as? [String: Any]
        switch name {
        case "chat:message":
            if let m = decodeMessage(args.first) {
                delegate?.socket(self, didReceive: .message(m))
            }
        case "chat:message:updated":
            if let m = decodeMessage(args.first) {
                delegate?.socket(self, didReceive: .messageUpdated(m))
            }
        case "chat:message:deleted":
            delegate?.socket(self, didReceive: .messageDeleted(
                chatId: obj?["chatId"] as? String ?? "",
                messageId: obj?["messageId"] as? String,
                stream: obj?["stream"] as? String))
        case "chat:updated":
            if let id = obj?["chatId"] as? String {
                delegate?.socket(self, didReceive: .chatUpdated(chatId: id))
            }
        case "chat:typing":
            delegate?.socket(self, didReceive: .typing(
                chatId: obj?["chatId"] as? String ?? "",
                active: obj?["active"] as? Bool ?? false,
                action: obj?["action"] as? String ?? "text",
                from: decodeUser(obj?["fromUser"])))
        case "chat:read":
            delegate?.socket(self, didReceive: .read(
                chatId: obj?["chatId"] as? String ?? "",
                stream: obj?["stream"] as? String,
                messageId: obj?["messageId"] as? String,
                from: decodeUser(obj?["fromUser"])))
        case "presence:snapshot":
            delegate?.socket(self, didReceive: .presenceSnapshot(
                online: obj?["onlineUserIds"] as? [String] ?? [],
                lastSeen: obj?["lastSeenAtByUser"] as? [String: String] ?? [:]))
        case "presence:update":
            delegate?.socket(self, didReceive: .presenceUpdate(
                userId: obj?["userId"] as? String ?? "",
                online: obj?["online"] as? Bool ?? false,
                lastSeenAt: obj?["lastSeenAt"] as? String))
        case "settings:updated":
            delegate?.socket(self, didReceive: .settingsUpdated)
        case "requests:updated":
            delegate?.socket(self, didReceive: .requestsUpdated)
        case "story:updated":
            delegate?.socket(self, didReceive: .storyUpdated(storyId: obj?["storyId"] as? String))
        case "calls:updated":
            delegate?.socket(self, didReceive: .callsUpdated)
        case "auth:session-revoked":
            delegate?.socket(self, didReceive: .sessionRevoked(
                sessionIds: obj?["sessionIds"] as? [String] ?? []))
        case "call:incoming", "call:accepted", "call:participants",
             "call:declined", "call:participant-left", "call:hangup", "call:signal":
            if let signal = decodeCallSignal(name: name, obj: obj) {
                delegate?.socket(self, didReceive: .call(signal))
            }
        default:
            #if DEBUG
            log.debug("ignored unknown event \(name, privacy: .public)")
            #endif
        }
    }

    private func jsonData(_ value: Any?) -> Data? {
        guard let value, JSONSerialization.isValidJSONObject(value) else { return nil }
        return try? JSONSerialization.data(withJSONObject: value)
    }

    private func decodeMessage(_ value: Any?) -> YoohMessage? {
        guard let data = jsonData(value) else { return nil }
        return try? decoder.decode(YoohMessage.self, from: data)
    }

    private func decodeUser(_ value: Any?) -> PublicUser? {
        guard let data = jsonData(value) else { return nil }
        return try? decoder.decode(PublicUser.self, from: data)
    }

    private func decodeUsers(_ value: Any?) -> [PublicUser]? {
        guard let arr = value as? [Any], let data = jsonData(arr) else { return nil }
        return try? decoder.decode([PublicUser].self, from: data)
    }

    private func decodeCallSignal(name: String, obj: [String: Any]?) -> CallSignal? {
        guard let obj else { return nil }
        let kind: CallSignal.Kind? = {
            switch name {
            case "call:incoming": return .incoming
            case "call:accepted": return .accepted
            case "call:participants": return .participants
            case "call:declined": return .declined
            case "call:participant-left": return .participantLeft
            case "call:hangup": return .hangup
            case "call:signal": return .signal
            default: return nil
            }
        }()
        guard let kind else { return nil }
        var signalValue: AnyCodable? = nil
        if let raw = obj["signal"], let data = jsonData(raw),
           let decoded = try? JSONDecoder().decode(AnyCodable.self, from: data)
        {
            signalValue = decoded
        }
        return CallSignal(
            kind: kind,
            sessionId: obj["sessionId"] as? String,
            chatId: obj["chatId"] as? String,
            mode: obj["mode"] as? String,
            from: decodeUser(obj["fromUser"]),
            participants: decodeUsers(obj["participants"]),
            reason: obj["reason"] as? String,
            userId: obj["userId"] as? String,
            signalType: obj["signalType"] as? String,
            signal: signalValue,
            toUserId: obj["toUserId"] as? String
        )
    }

    private func sendNamespaceConnect() {
        guard let token else { return }
        do {
            let packet = try PacketCodec.encodeConnect(auth: ["token": token])
            transport.send(packet)
        } catch {
            #if DEBUG
            log.error("connect encode failed")
            #endif
        }
    }
}
