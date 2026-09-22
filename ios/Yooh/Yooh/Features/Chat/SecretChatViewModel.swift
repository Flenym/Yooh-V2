import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class SecretChatViewModel {
    private(set) var chat: SecretChat
    private(set) var messages: [SecretMessage] = []
    var draft = ""
    var editing: SecretMessage?

    private let store: SecretStore
    nonisolated(unsafe) private var ticker: Task<Void, Never>?

    init(chat: SecretChat, userId: String) {
        self.chat = chat
        self.store = SecretStore(userId: userId)
        reload()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run { self?.reload() }
            }
        }
    }

    deinit {
        ticker?.cancel()
    }

    func reload() {
        messages = store.messages(chatId: chat.id)
        if let fresh = store.chats.first(where: { $0.id == chat.id }) {
            chat = fresh
        }
    }

    var ttlLabel: String {
        switch chat.ttlSeconds {
        case 0: return "Выкл"
        case 1..<60: return "\(chat.ttlSeconds) с"
        case 60..<3600: return "\(chat.ttlSeconds / 60) мин"
        case 3600..<86400: return "\(chat.ttlSeconds / 3600) ч"
        default: return "\(chat.ttlSeconds / 86400) дн"
        }
    }

    func setTTL(_ seconds: Int) {
        chat.ttlSeconds = seconds
        store.updateChat(chat)
        Haptics.selection()
    }

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if editing != nil {
            saveEdit(text: text)
            return
        }
        guard !text.isEmpty else { return }
        draft = ""
        store.send(chatId: chat.id, text: text, imageDataURL: nil, ttlSeconds: chat.ttlSeconds)
        Haptics.send()
        reload()
    }

    func sendPhoto(_ image: UIImage) {
        guard let url = ProfileViewModel.storyImageDataURL(image) else { return }
        store.send(chatId: chat.id, text: nil, imageDataURL: url, ttlSeconds: chat.ttlSeconds)
        Haptics.send()
        reload()
    }

    func beginEdit(_ m: SecretMessage) {
        editing = m
        draft = m.text ?? ""
    }

    func cancelEdit() {
        editing = nil
        draft = ""
    }

    func saveEdit(text: String) {
        guard let target = editing else { return }
        editing = nil
        draft = ""
        guard !text.isEmpty else { return }
        store.edit(chatId: chat.id, messageId: target.id, text: text)
        reload()
    }

    func delete(_ m: SecretMessage) {
        store.delete(chatId: chat.id, messageId: m.id)
        reload()
    }

    func deleteChat() {
        ticker?.cancel()
        store.deleteChat(chat.id)
    }
}
