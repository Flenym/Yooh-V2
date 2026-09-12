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
                Section("Question") {
                    TextField("Ask something…", text: $question, axis: .vertical)
                }
                Section("Options") {
                    ForEach(options.indices, id: \.self) { i in
                        HStack {
                            if isQuiz {
                                Button {
                                    correctIndex = i
                                } label: {
                                    Image(systemName: correctIndex == i ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(ThemeStore.shared.accent)
                                }
                                .accessibilityLabel(Text("Mark option \(i + 1) as correct"))
                            }
                            TextField("Option \(i + 1)", text: $options[i])
                        }
                    }
                    .onDelete { options.remove(atOffsets: $0) }
                    if options.count < 12 {
                        Button {
                            options.append("")
                        } label: {
                            Label("Add option", systemImage: "plus")
                        }
                    }
                }
                Section("Settings") {
                    Toggle("Multiple answers", isOn: $multiple)
                    Toggle("Anonymous voting", isOn: $anonymous)
                    Toggle("Quiz mode", isOn: $isQuiz)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle("New poll")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Send") { send() }
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
            error = "Enter a question (max 300 characters)."
            return
        }
        let clean = options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard clean.count >= 2 else {
            error = "Add at least 2 options."
            return
        }
        guard clean.allSatisfy({ $0.count <= 120 }) else {
            error = "Each option must be ≤ 120 characters."
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
            .navigationTitle("Forward to…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
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
