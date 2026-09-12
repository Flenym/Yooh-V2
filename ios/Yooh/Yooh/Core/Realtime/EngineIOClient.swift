import Foundation
import os

/// Engine.IO v4 transport: long-polling carrier with opportunistic
/// WebSocket upgrade. Server pings are answered with pongs; silence past
/// pingInterval + pingTimeout triggers a fresh handshake.
final class EngineIOClient {
    enum State: Equatable {
        case idle
        case connecting
        case open(transport: Transport)
        case closed

        enum Transport: String { case polling, websocket }
    }

    var onPacket: ((EnginePacket) -> Void)?
    var onState: ((State) -> Void)?

    private let log = Logger(subsystem: AppConfig.bundleID, category: "eio")
    private let lock = NSLock()
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.waitsForConnectivity = true
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 120
        return URLSession(configuration: c)
    }()

    private var baseURL: URL = AppConfig.baseURL
    private var path: String = AppConfig.socketPath
    private var extraHeaders: [String: String] = [:]

    private var state: State = .idle
    private var sid: String?
    private var pingInterval: TimeInterval = 20
    private var pingTimeout: TimeInterval = 120
    private var useWebSocketUpgrade = true

    private var pollTask: URLSessionDataTask?
    private var postInFlight = false
    private var sendQueue: [EnginePacket] = []

    private var wsTask: URLSessionWebSocketTask?
    private var wsUpgraded = false
    private var lastReceive = Date()
    private var watchdog: DispatchSourceTimer?
    private var closed = false

    // MARK: - Lifecycle

    func connect(baseURL: URL, path: String = AppConfig.socketPath, headers: [String: String] = [:]) {
        lock.lock()
        guard state == .idle || state == .closed else { lock.unlock(); return }
        closed = false
        self.baseURL = baseURL
        self.path = path
        self.extraHeaders = headers
        setStateLocked(.connecting)
        lock.unlock()
        performHandshake()
    }

    func disconnect() {
        lock.lock()
        closed = true
        pollTask?.cancel(); pollTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil); wsTask = nil
        sendQueue.removeAll()
        postInFlight = false
        watchdog?.cancel(); watchdog = nil
        setStateLocked(.closed)
        lock.unlock()
    }

    func send(_ packet: EnginePacket) {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        if wsUpgraded, let ws = wsTask {
            lock.unlock()
            ws.send(.string(packet.raw)) { [weak self] error in
                if let error { self?.log.error("ws send failed: \(error.localizedDescription, privacy: .public)") }
            }
            return
        }
        sendQueue.append(packet)
        let shouldFlush = !postInFlight
        lock.unlock()
        if shouldFlush { flushSendQueue() }
    }

    // MARK: - Handshake

    private func handshakeURL() -> URL? {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        c?.path = path
        c?.queryItems = [URLQueryItem(name: "EIO", value: AppConfig.engineIOVersion),
                         URLQueryItem(name: "transport", value: "polling")]
        return c?.url
    }

    private func transportURL() -> URL? {
        guard let sid else { return nil }
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        c?.path = path
        c?.queryItems = [URLQueryItem(name: "EIO", value: AppConfig.engineIOVersion),
                         URLQueryItem(name: "transport", value: "polling"),
                         URLQueryItem(name: "sid", value: sid)]
        return c?.url
    }

    private func performHandshake() {
        guard let url = handshakeURL() else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applyHeaders(to: &req)
        #if DEBUG
        log.debug("EIO handshake")
        #endif
        session.dataTask(with: req) { [weak self] data, _, error in
            guard let self else { return }
            if let error {
                self.fail(error)
                return
            }
            guard let data else { self.fail(URLError(.badServerResponse)); return }
            let packets = PacketCodec.decodePollingPayload(data)
            guard let open = packets.first(where: { $0.type == "0" }),
                  let ob = open.body.data(using: .utf8),
                  let hs = try? JSONDecoder().decode(EngineOpenHandshake.self, from: ob)
            else { self.fail(URLError(.cannotParseResponse)); return }

            self.lock.lock()
            let wasClosed = self.closed
            self.sid = hs.sid
            if let pi = hs.pingInterval { self.pingInterval = TimeInterval(pi) / 1000 }
            if let pt = hs.pingTimeout { self.pingTimeout = TimeInterval(pt) / 1000 }
            let upgrades = hs.upgrades ?? []
            self.lastReceive = Date()
            self.lock.unlock()
            guard !wasClosed else { return }

            self.startWatchdog()
            for p in packets where p.type != "0" { self.handlePacket(p) }
            if self.useWebSocketUpgrade, upgrades.contains("websocket") {
                self.attemptWebSocketUpgrade()
            }
            self.lock.lock()
            self.setStateLocked(.open(transport: .polling))
            self.lock.unlock()
            self.longPoll()
        }.resume()
    }

    // MARK: - Long polling

    private func longPoll() {
        lock.lock()
        guard !closed, wsUpgraded == false else { lock.unlock(); return }
        guard let url = transportURL() else { lock.unlock(); return }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applyHeaders(to: &req)
        let task = session.dataTask(with: req) { [weak self] data, _, error in
            guard let self else { return }
            self.lock.lock()
            let isCurrent = (self.pollTask != nil)
            self.pollTask = nil
            let isClosed = self.closed
            let upgraded = self.wsUpgraded
            self.lock.unlock()
            guard isCurrent, !isClosed, !upgraded else { return }
            if let error as NSError?, error.code != NSURLErrorCancelled {
                #if DEBUG
                self.log.debug("poll error, re-issuing")
                #endif
                self.longPoll()
                return
            }
            if let data {
                for p in PacketCodec.decodePollingPayload(data) { self.handlePacket(p) }
            }
            self.longPoll()
        }
        pollTask?.cancel()
        pollTask = task
        lock.unlock()
        task.resume()
    }

    private func flushSendQueue() {
        lock.lock()
        guard !closed, !postInFlight, !sendQueue.isEmpty, !wsUpgraded else { lock.unlock(); return }
        guard let url = transportURL() else { lock.unlock(); return }
        let batch = sendQueue
        sendQueue.removeAll()
        postInFlight = true
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("text/plain;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        applyHeaders(to: &req)
        req.httpBody = PacketCodec.encodePollingPayload(batch)
        lock.unlock()
        session.dataTask(with: req) { [weak self] data, _, _ in
            guard let self else { return }
            if let data {
                for p in PacketCodec.decodePollingPayload(data) { self.handlePacket(p) }
            }
            self.lock.lock()
            self.postInFlight = false
            let more = !self.sendQueue.isEmpty && !self.closed && !self.wsUpgraded
            self.lock.unlock()
            if more { self.flushSendQueue() }
        }.resume()
    }

    // MARK: - WebSocket upgrade

    private func attemptWebSocketUpgrade() {
        lock.lock()
        guard !closed, let sid else { lock.unlock(); return }
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        let scheme = (c?.scheme == "https") ? "wss" : "ws"
        c?.scheme = scheme
        c?.path = path
        c?.queryItems = [URLQueryItem(name: "EIO", value: AppConfig.engineIOVersion),
                         URLQueryItem(name: "transport", value: "websocket"),
                         URLQueryItem(name: "sid", value: sid)]
        guard let url = c?.url else { lock.unlock(); return }
        var req = URLRequest(url: url)
        applyHeaders(to: &req)
        let ws = session.webSocketTask(with: req)
        wsTask = ws
        lock.unlock()
        ws.resume()
        ws.send(.string("2probe")) { [weak self] error in
            if error != nil { self?.webSocketFailed(); return }
            self?.receiveWSMessage(expectingProbe: true)
        }
    }

    private func receiveWSMessage(expectingProbe: Bool) {
        lock.lock()
        guard let ws = wsTask, !closed else { lock.unlock(); return }
        lock.unlock()
        ws.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                let text: String? = {
                    switch msg {
                    case .string(let s): return s
                    case .data(let d): return String(data: d, encoding: .utf8)
                    @unknown default: return nil
                    }
                }()
                guard let text, !text.isEmpty else {
                    self.receiveWSMessage(expectingProbe: expectingProbe)
                    return
                }
                if expectingProbe {
                    guard text == "3probe" else {
                        self.webSocketFailed()
                        return
                    }
                    self.lock.lock()
                    guard let ws2 = self.wsTask, !self.closed else { self.lock.unlock(); return }
                    self.lock.unlock()
                    ws2.send(.string("5")) { _ in }
                    self.lock.lock()
                    self.wsUpgraded = true
                    self.pollTask?.cancel(); self.pollTask = nil
                    let queued = self.sendQueue
                    self.sendQueue.removeAll()
                    self.setStateLocked(.open(transport: .websocket))
                    self.lock.unlock()
                    for p in queued { self.send(p) }
                    self.receiveWSMessage(expectingProbe: false)
                    return
                }
                if let first = text.first {
                    self.handlePacket(EnginePacket(type: first, body: String(text.dropFirst())))
                }
                self.receiveWSMessage(expectingProbe: false)
            case .failure:
                self.webSocketFailed()
            }
        }
    }

    private func webSocketFailed() {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        let wasUpgraded = wsUpgraded
        wsTask?.cancel()
        wsTask = nil
        wsUpgraded = false
        if wasUpgraded {
            setStateLocked(.connecting)
            lock.unlock()
            performHandshake()
        } else {
            setStateLocked(.open(transport: .polling))
            lock.unlock()
        }
    }

    // MARK: - Packets

    private func handlePacket(_ p: EnginePacket) {
        touchReceive()
        switch p.type {
        case "2":
            send(EnginePacket(type: "3", body: ""))
        case "1":
            fail(URLError(.networkConnectionLost))
        case "6":
            break
        case "4", "0", "5":
            DispatchQueue.main.async { [weak self] in self?.onPacket?(p) }
        default:
            break
        }
    }

    // MARK: - Watchdog / failures

    private func touchReceive() {
        lock.lock()
        lastReceive = Date()
        lock.unlock()
    }

    private func startWatchdog() {
        lock.lock()
        watchdog?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let silentFor = Date().timeIntervalSince(self.lastReceive)
            let limit = self.pingInterval + self.pingTimeout
            let isClosed = self.closed
            self.lock.unlock()
            guard !isClosed, silentFor > limit else { return }
            self.lock.lock()
            self.pollTask?.cancel(); self.pollTask = nil
            self.wsTask?.cancel(); self.wsTask = nil
            self.wsUpgraded = false
            self.setStateLocked(.connecting)
            self.lock.unlock()
            self.performHandshake()
        }
        watchdog = timer
        lock.unlock()
        timer.resume()
    }

    private func fail(_ error: Error) {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        pollTask?.cancel(); pollTask = nil
        wsTask?.cancel(); wsTask = nil
        wsUpgraded = false
        setStateLocked(.closed)
        lock.unlock()
        #if DEBUG
        log.error("EIO failed: \(error.localizedDescription, privacy: .public)")
        #endif
        DispatchQueue.main.async { [weak self] in
            self?.onPacket?(EnginePacket(type: "1", body: ""))
        }
    }

    // MARK: - Helpers

    private func applyHeaders(to request: inout URLRequest) {
        for (k, v) in extraHeaders { request.setValue(v, forHTTPHeaderField: k) }
    }

    private func setStateLocked(_ s: State) {
        guard state != s else { return }
        state = s
        DispatchQueue.main.async { [weak self, s] in self?.onState?(s) }
    }
}
