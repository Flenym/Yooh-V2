import Foundation
import Observation
import SwiftUI

struct TypingPeer: Hashable {
    let userId: String
    let displayName: String
    let action: String
    let expiresAt: Date
}

/// Root state: owns the socket, routes realtime events, holds presence.
/// Every socket reconnect re-joins chats and refreshes (web syncAppState).
@Observable
@MainActor
final class AppState {
    let session = SessionStore.shared
    let socket = YoohSocket()

    let chatsService: ChatService
    let messageService: MessageService
    let userService: UserService
    let mediaService: MediaService
    let storyService: StoryService
    let settingsService: SettingsService
    let authService: AuthService
    let callService: CallService
    let requestsService: RequestsService

    let chatsViewModel: ChatsViewModel
    let contactsViewModel: ContactsViewModel
    let profileViewModel: ProfileViewModel
    let settingsViewModel: SettingsViewModel
    let storiesViewModel: StoriesViewModel
    let callsViewModel: CallsViewModel
    let requestsViewModel: RequestsViewModel

    private(set) var onlineUsers: Set<String> = []
    private(set) var typingByChat: [String: [TypingPeer]] = [:]
    var socketState: YoohSocket.ConnectionState = .disconnected
    private(set) var incomingCall: CallSignal?

    var messageHandler: ((YoohSocketEvent) -> Void)?
    var didBoot = false

    private var lastTypingSent: [String: Date] = [:]

    var chatsPath = NavigationPath()
    var contactsPath = NavigationPath()

    var isChatOpen: Bool {
        !chatsPath.isEmpty || !contactsPath.isEmpty
    }

    var contactNotes: ContactNotes {
        ContactNotes(userId: session.currentUser?.id ?? "anon")
    }

    init() {
        chatsService = ChatService()
        messageService = MessageService()
        userService = UserService()
        mediaService = MediaService()
        storyService = StoryService()
        settingsService = SettingsService()
        authService = AuthService()
        callService = CallService(socket: socket)
        requestsService = RequestsService()
        chatsViewModel = ChatsViewModel()
        contactsViewModel = ContactsViewModel()
        profileViewModel = ProfileViewModel()
        settingsViewModel = SettingsViewModel()
        storiesViewModel = StoriesViewModel()
        callsViewModel = CallsViewModel()
        requestsViewModel = RequestsViewModel()
        socket.delegate = self
        socket.onStateChange = { [weak self] state in
            Task { @MainActor in self?.socketState = state }
        }
        chatsViewModel.app = self
        contactsViewModel.app = self
        profileViewModel.app = self
        settingsViewModel.app = self
        storiesViewModel.app = self
        callsViewModel.app = self
        requestsViewModel.app = self
    }

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

    func sendTyping(chatId: String, active: Bool) {
        let now = Date()
        if active, let last = lastTypingSent[chatId], now.timeIntervalSince(last) < 2.5 {
            return
        }
        lastTypingSent[chatId] = now
        socket.sendTyping(chatId: chatId, active: active)
    }

    func isOnline(_ userId: String) -> Bool {
        onlineUsers.contains(userId)
    }

    func typingPeers(chatId: String) -> [TypingPeer] {
        let now = Date()
        return (typingByChat[chatId] ?? []).filter { $0.expiresAt > now }
    }
}

extension AppState: YoohSocketDelegate {
    func socketDidConnect(_ socket: YoohSocket) {
        Task {
            await chatsViewModel.refreshAfterConnect()
        }
    }

    func socketDidDisconnect(_ socket: YoohSocket) {}

    func socket(_ socket: YoohSocket, didReceive event: YoohSocketEvent) {
        switch event {
        case .message(let m):
            chatsViewModel.applyIncomingMessage(m)
            messageHandler?(.message(m))
        case .messageUpdated(let m):
            chatsViewModel.applyIncomingMessage(m)
            messageHandler?(.messageUpdated(m))
        case .messageDeleted:
            chatsViewModel.scheduleRefresh()
            messageHandler?(event)
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
        case .requestsUpdated:
            Task { await requestsViewModel.refresh() }
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
