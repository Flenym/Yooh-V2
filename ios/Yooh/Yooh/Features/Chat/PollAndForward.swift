import SwiftUI

/// Poll / quiz creation (server limits: question ≤300, 2–12 options).
struct PollComposerView: View {
    @Environment(\.dismiss) private var dismiss
    let vm: ChatViewModel

    @State private var question = ""
    @State private var options = ["", ""]
    @State private var multiple = false
    @State private var anonymous = true
    @State private var isQuiz = false
    @State private var correctIndex = 0
    @State private var error: String?
    @State private var isSending = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Вопрос") {
                    TextField("Спросите что-нибудь…", text: $question, axis: .vertical)
                }
                Section("Варианты") {
                    ForEach(options.indices, id: \.self) { i in
                        HStack {
                            if isQuiz {
                                Button {
                                    correctIndex = i
                                } label: {
                                    Image(systemName: correctIndex == i ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(ThemeStore.shared.accent)
                                }
                                .accessibilityLabel(Text("Отметить вариант \(i + 1) как правильный"))
                            }
                            TextField("Вариант \(i + 1)", text: $options[i])
                        }
                    }
                    .onDelete { options.remove(atOffsets: $0) }
                    if options.count < 12 {
                        Button {
                            options.append("")
                        } label: {
                            Label("Добавить вариант", systemImage: "plus")
                        }
                    }
                }
                Section("Настройки") {
                    Toggle("Несколько ответов", isOn: $multiple)
                    Toggle("Анонимное голосование", isOn: $anonymous)
                    Toggle("Режим викторины", isOn: $isQuiz)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle("Новый опрос")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Отправить") { send() }
                        .bold()
                        .disabled(isSending)
                }
            }
        }
    }

    private func send() {
        error = nil
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, q.count <= 300 else {
            error = "Введите вопрос (макс. 300 символов)."
            return
        }
        let clean = options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard clean.count >= 2 else {
            error = "Добавьте минимум 2 варианта."
            return
        }
        guard clean.allSatisfy({ $0.count <= 120 }) else {
            error = "Каждый вариант — не длиннее 120 символов."
            return
        }
        isSending = true
        vm.sendPoll(question: q, options: Array(clean.prefix(12)),
                    multiple: multiple, anonymous: anonymous,
                    isQuiz: isQuiz, correctIndex: isQuiz ? min(correctIndex, clean.count - 1) : nil)
        Haptics.send()
        dismiss()
    }
}

/// Forward picker: all chats except the source one.
struct ForwardSheetView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let message: YoohMessage
    let sourceChatId: String

    @State private var error: String?
    @State private var isSending = false

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    ErrorBanner(message: error, onDismiss: { self.error = nil })
                        .listRowSeparator(.hidden)
                }
                ForEach(targets) { chat in
                    Button {
                        forward(to: chat.id)
                    } label: {
                        ChatRowView(chat: chat, myUserId: app.session.currentUser?.id ?? "")
                    }
                    .buttonStyle(.plain)
                    .disabled(isSending)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Переслать…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private var targets: [YoohChat] {
        app.chatsViewModel.chats.filter { $0.id != sourceChatId }
    }

    private func forward(to targetChatId: String) {
        isSending = true
        Task {
            defer { isSending = false }
            do {
                _ = try await app.messageService.forward(
                    messageId: message.id, fromChatId: sourceChatId, targetChatId: targetChatId)
                await app.chatsViewModel.refresh()
                Haptics.send()
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
