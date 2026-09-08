import Foundation
import Observation

/// Per-user typing peer info for the typing indicator.
struct TypingPeer: Hashable {
    let userId: String
    let displayName: String
    let action: String
    let expiresAt: Date
}

/// Root state: owns the socket, routes realtime events, holds presence.
///
/// Wiring (mirrors web `connectSocket` + `syncAppState`):
/// - `startRealtime()` after login; `stopRealtime()` on logout.
/// - Every SIO connect → re-join all known chats + full chats refresh
///   (covers missed messages; same as web `syncAppState` on connect).
/// - Message events update the chat list optimistically AND are forwarded
///   to the open chat screen (if any) via `messageHandler`.
@Observable
@MainActor
final class AppState {
    let session = SessionStore.shared
    let socket = YoohSocket()

    // NOTE: no `lazy` here — @Observable rewrites lazy members into
    // computed properties. Everything is wired once in init().
    let chatsService: ChatService
    let messageService: MessageService
    let userService: UserService
    let mediaService: MediaService
    let storyService: StoryService
    let settingsService: SettingsService
    let authService: AuthService
    let callService: CallService

    let chatsViewModel: ChatsViewModel
    let contactsViewModel: ContactsViewModel
    let profileViewModel: ProfileViewModel
    let settingsViewModel: SettingsViewModel
    let storiesViewModel: StoriesViewModel
    let callsViewModel: CallsViewModel

    /// Online state by user id (from presence:snapshot/update).
    private(set) var onlineUsers: Set<String> = []
    /// Typing peers by chat id (TTL-filtered on read).
    private(set) var typingByChat: [String: [TypingPeer]] = [:]
    /// Latest incoming call signal awaiting user action.
    private(set) var incomingCall: CallSignal?

    /// Set by the open ChatDetailViewModel; cleared on disappear.
    var messageHandler: ((YoohSocketEvent) -> Void)? = nil

    /// One-shot launch guard (see RootView).
    var didBoot = false

    /// Outgoing typing throttle timestamps by chat id.
    private var lastTypingSent: [String: Date] = [:]

    init() {
        chatsService = ChatService()
        messageService = MessageService()
        userService = UserService()
        mediaService = MediaService()
        storyService = StoryService()
        settingsService = SettingsService()
        authService = AuthService()
        callService = CallService(socket: socket)
        chatsViewModel = ChatsViewModel(app: self)
        contactsViewModel = ContactsViewModel(app: self)
        profileViewModel = ProfileViewModel(app: self)
        settingsViewModel = SettingsViewModel(app: self)
        storiesViewModel = StoriesViewModel(app: self)
        callsViewModel = CallsViewModel(app: self)
        socket.delegate = self
    }

    // MARK: - Lifecycle

    func startRealtime() {
        guard let token = session.token else { return }
        socket.connect(token: token)
    }

    func stopRealtime() {
        socket.disconnect()
        onlineUsers.removeAll()
        typingByChat.removeAll()
        incomingCall = nil
    }

    func logout() {
        stopRealtime()
        session.logout()
    }

    // MARK: - Typing out (throttled like the web client)

    func sendTyping(chatId: String, active: Bool) {
        let now = Date()
        if active, let last = lastTypingSent[chatId], now.timeIntervalSince(last) < 2.5 {
            return
        }
        lastTypingSent[chatId] = now
        socket.sendTyping(chatId: chatId, active: active)
    }

    // MARK: - Presence helpers

    func isOnline(_ userId: String) -> Bool {
        onlineUsers.contains(userId)
    }

    func typingPeers(chatId: String) -> [TypingPeer] {
        let now = Date()
        return (typingByChat[chatId] ?? []).filter { $0.expiresAt > now }
    }
}

// MARK: - YoohSocketDelegate

extension AppState: YoohSocketDelegate {
    func socketDidConnect(_ socket: YoohSocket) {
        Task {
            await chatsViewModel.refreshAfterConnect()
        }
    }

    func socketDidDisconnect(_ socket: YoohSocket) {
        // Reconnect is owned by YoohSocket (infinite, capped backoff).
        // Views observe `socket.isConnected` via onStateChange if needed.
    }

    func socket(_ socket: YoohSocket, didReceive event: YoohSocketEvent) {
        switch event {
        case .message(let m):
            chatsViewModel.applyIncomingMessage(m)
            messageHandler?(.message(m))
        case .messageUpdated(let m):
            chatsViewModel.applyIncomingMessage(m)
            messageHandler?(.messageUpdated(m))
        case .messageDeleted(let chatId, _, _):
            chatsViewModel.scheduleRefresh()
            messageHandler?(event)
            _ = chatId
        case .chatUpdated:
            chatsViewModel.scheduleRefresh()
        case .typing(let chatId, let active, let action, let from):
            var list = typingByChat[chatId] ?? []
            list.removeAll { $0.userId == (from?.id ?? "") }
            if active, let from {
                list.append(TypingPeer(userId: from.id,
                                       displayName: from.displayName ?? from.title,
                                       action: action,
                                       expiresAt: Date().addingTimeInterval(6)))
            }
            typingByChat[chatId] = list
            messageHandler?(event)
        case .read:
            messageHandler?(event)
        case .presenceSnapshot(let online, _):
            onlineUsers = Set(online)
        case .presenceUpdate(let userId, let online, _):
            if online { onlineUsers.insert(userId) } else { onlineUsers.remove(userId) }
        case .settingsUpdated:
            Task { await profileViewModel.reload() }
        case .storyUpdated:
            Task { await storiesViewModel.refresh() }
        case .callsUpdated:
            Task { await callsViewModel.refresh() }
        case .sessionRevoked(let ids):
            if let sid = session.currentUser?.sessionId, ids.contains(sid) {
                logout()
            }
        case .call(let signal):
            switch signal.kind {
            case .incoming:
                incomingCall = signal
                Haptics.impact(.medium)
            case .hangup, .declined:
                if incomingCall?.sessionId == signal.sessionId {
                    incomingCall = nil
                }
                messageHandler?(event)
            default:
                messageHandler?(event)
            }
        case .connectError:
            break
        }
    }
}
