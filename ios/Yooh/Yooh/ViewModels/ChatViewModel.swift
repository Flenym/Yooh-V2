import Foundation
import Observation

/// One open conversation: history + pagination, optimistic sending,
/// realtime append/update/delete, typing, read receipts, reactions,
/// replies, edits, forwards, polls, locations and uploads.
///
/// Server contract notes:
/// - History is ascending; `before` = oldest loaded `createdAt`.
/// - Channel comments live in a separate `comment` stream (own history).
/// - Read markers go through `chat:read` (socket ack), not REST.
@Observable
@MainActor
final class ChatViewModel {
    let chatId: String
    private(set) var chat: YoohChat
    private(set) var messages: [YoohMessage] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = true
    private(set) var error: String?
    private(set) var uploadState: String?

    var stream: MessageStream = .main
    var draft = ""
    var replyTo: YoohMessage?
    var editing: YoohMessage?
    var forwardTarget: YoohMessage?

    private let app: AppState
    private var loadTask: Task<Void, Never>?
    private var readTask: Task<Void, Never>?

    init(chat: YoohChat, app: AppState) {
        self.chatId = chat.id
        self.chat = chat
        self.app = app
    }

    var myUserId: String { app.session.currentUser?.id ?? "" }

    var typingText: String? {
        let peers = app.typingPeers(chatId: chatId).filter { $0.userId != myUserId }
        guard !peers.isEmpty else { return nil }
        if peers.count == 1 { return "\(peers[0].displayName) is typing…" }
        return "\(peers.count) people are typing…"
    }

    // MARK: - Lifecycle

    func appear() {
        app.messageHandler = { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        loadInitial()
    }

    func disappear() {
        app.sendTyping(chatId: chatId, active: false)
        if app.messageHandler != nil {
            app.messageHandler = nil
        }
        loadTask?.cancel()
        readTask?.cancel()
    }

    func setStream(_ s: MessageStream) {
        guard s != stream else { return }
        stream = s
        messages.removeAll()
        hasMore = true
        replyTo = nil
        editing = nil
        loadInitial()
    }

    func refreshChatRow() {
        if let updated = app.chatsViewModel.chats.first(where: { $0.id == chatId }) {
            chat = updated
        }
    }

    func showError(_ message: String) { error = message }
    func clearError() { error = nil }

    // MARK: - History

    func loadInitial() {
        loadTask?.cancel()
        loadTask = Task {
            isLoading = true
            error = nil
            defer { isLoading = false }
            do {
                let list = try await app.messageService.history(chatId: chatId, stream: stream)
                guard !Task.isCancelled else { return }
                messages = stamp(list)
                hasMore = list.count >= AppConfig.messagePageSize
                sendReadForLatest()
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func loadMore() {
        guard !isLoadingMore, hasMore, let oldest = messages.first?.createdAt else { return }
        isLoadingMore = true
        Task {
            defer { isLoadingMore = false }
            do {
                let page = try await app.messageService.history(
                    chatId: chatId, stream: stream, before: oldest)
                let stamped = stamp(page).filter { m in !messages.contains(where: { $0.id == m.id }) }
                messages.insert(contentsOf: stamped, at: 0)
                if page.count < AppConfig.messagePageSize { hasMore = false }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    // MARK: - Sending

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if editing != nil {
            saveEdit(text: text)
            return
        }
        guard Validation.validateMessage(text) else { return }
        draft = ""
        let replyId = replyTo?.id
        replyTo = nil
        app.sendTyping(chatId: chatId, active: false)

        let optimistic = YoohMessage(localText: text, chatId: chatId,
                                     senderId: myUserId, stream: stream.rawValue,
                                     replyToMessageId: replyId)
        messages.append(optimistic)
        Haptics.send()
        Task {
            do {
                let saved = try await app.messageService.send(
                    chatId: chatId,
                    request: .text(text, replyToMessageId: replyId,
                                   clientMessageId: optimistic.clientMessageId ?? UUID().uuidString),
                    stream: stream)
                replaceOptimistic(clientId: optimistic.clientMessageId, with: saved)
            } catch {
                messages.removeAll { $0.id == optimistic.id }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                Haptics.error()
            }
        }
    }

    func sendPoll(question: String, options: [String], multiple: Bool, anonymous: Bool,
                  isQuiz: Bool, correctIndex: Int?) {
        Task {
            do {
                let poll = OutgoingPoll(question: question, options: options,
                                        anonymous: anonymous, multiple: multiple,
                                        quiz: isQuiz, correctOptionIndex: correctIndex)
                let saved = try await app.messageService.sendPoll(chatId: chatId, poll: poll, stream: stream)
                appendRealtime(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func sendLocation(lat: Double, lng: Double, title: String?) {
        Task {
            do {
                let saved = try await app.messageService.sendLocation(
                    chatId: chatId,
                    location: OutgoingLocation(lat: lat, lng: lng, title: title),
                    stream: stream)
                appendRealtime(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func upload(data: Data, filename: String, mimeType: String, text: String? = nil) {
        uploadState = filename
        Task {
            defer { uploadState = nil }
            do {
                let saved = try await app.mediaService.upload(
                    chatId: chatId, data: data, filename: filename, mimeType: mimeType,
                    text: text, stream: stream, replyToMessageId: replyTo?.id)
                replyTo = nil
                appendRealtime(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    // MARK: - Edit / delete / reactions / forward

    func saveEdit(text: String) {
        guard let target = editing else { return }
        editing = nil
        draft = ""
        guard Validation.validateMessage(text) else { return }
        Task {
            do {
                let saved = try await app.messageService.edit(chatId: chatId, messageId: target.id, text: text)
                upsert(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func beginEdit(_ m: YoohMessage) {
        editing = m
        replyTo = nil
        draft = m.text ?? ""
    }

    func cancelEdit() {
        editing = nil
        draft = ""
    }

    func delete(_ m: YoohMessage) {
        Task {
            do {
                try await app.messageService.delete(chatId: chatId, messageId: m.id)
                messages.removeAll { $0.id == m.id }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func react(_ m: YoohMessage, emoji: String) {
        Haptics.selection()
        Task {
            do {
                let saved = try await app.messageService.toggleReaction(chatId: chatId, messageId: m.id, emoji: emoji)
                upsert(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func vote(_ m: YoohMessage, optionIds: [String]) {
        Task {
            do {
                let saved = try await app.messageService.votePoll(chatId: chatId, messageId: m.id, optionIds: optionIds)
                upsert(saved)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func forward(_ m: YoohMessage, to targetChatId: String) {
        Task {
            do {
                _ = try await app.messageService.forward(messageId: m.id, fromChatId: chatId, targetChatId: targetChatId)
                await app.chatsViewModel.refresh()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func report(_ m: YoohMessage) {
        Task {
            do {
                try await app.messageService.report(chatId: chatId, messageId: m.id)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    // MARK: - Realtime

    private func handle(_ event: YoohSocketEvent) {
        switch event {
        case .message(let m):
            guard m.chatId == chatId, m.stream == stream.rawValue else { return }
            appendRealtime(m)
            if m.senderId != myUserId { sendReadForLatest() }
        case .messageUpdated(let m):
            guard m.chatId == chatId else { return }
            upsert(m)
        case .messageDeleted(let dChatId, let messageId, let dStream):
            guard dChatId == chatId else { return }
            if dStream != nil, dStream != stream.rawValue { return }
            if let messageId {
                messages.removeAll { $0.id == messageId }
            } else {
                messages.removeAll() // clear-history
                hasMore = false
            }
        case .read(let rChatId, _, let messageId, let from):
            guard rChatId == chatId, let from, from.id != myUserId else { return }
            markReadUpTo(messageId: messageId, by: from.id)
        default:
            break
        }
    }

    // MARK: - Read receipts

    private func sendReadForLatest() {
        readTask?.cancel()
        readTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            guard let last = messages.last(where: { $0.senderId != myUserId && !$0.id.hasPrefix("local-") }) else { return }
            guard !last.readByUserIds.contains(myUserId) else { return }
            try? await app.socket.sendRead(chatId: chatId, stream: stream.rawValue, messageId: last.id)
            if let idx = messages.firstIndex(where: { $0.id == last.id }) {
                if !messages[idx].readByUserIds.contains(myUserId) {
                    messages[idx].readByUserIds.append(myUserId)
                }
            }
        }
    }

    private func markReadUpTo(messageId: String?, by userId: String) {
        var limitIdx = messages.count - 1
        if let messageId, let idx = messages.firstIndex(where: { $0.id == messageId }) {
            limitIdx = idx
        }
        for i in 0...max(0, limitIdx) where i < messages.count {
            if messages[i].senderId == myUserId, !messages[i].readByUserIds.contains(userId) {
                messages[i].readByUserIds.append(userId)
            }
        }
    }

    // MARK: - Helpers

    private func stamp(_ list: [YoohMessage]) -> [YoohMessage] {
        list.map { m in
            var c = m
            c.isOutgoing = (m.senderId == myUserId)
            return c
        }
    }

    private func appendRealtime(_ m: YoohMessage) {
        if let cid = m.clientMessageId,
           let idx = messages.firstIndex(where: { $0.clientMessageId == cid }) {
            var c = m
            c.isOutgoing = (m.senderId == myUserId)
            messages[idx] = c
            return
        }
        guard !messages.contains(where: { $0.id == m.id }) else { return }
        var c = m
        c.isOutgoing = (m.senderId == myUserId)
        messages.append(c)
    }

    private func replaceOptimistic(clientId: String?, with saved: YoohMessage) {
        var c = saved
        c.isOutgoing = (saved.senderId == myUserId)
        if let clientId, let idx = messages.firstIndex(where: { $0.clientMessageId == clientId }) {
            messages[idx] = c
        } else if !messages.contains(where: { $0.id == saved.id }) {
            messages.append(c)
        }
    }

    private func upsert(_ m: YoohMessage) {
        var c = m
        c.isOutgoing = (m.senderId == myUserId)
        if let idx = messages.firstIndex(where: { $0.id == m.id }) {
            messages[idx] = c
        }
    }
}
