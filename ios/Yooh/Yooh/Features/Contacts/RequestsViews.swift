import SwiftUI

/// Composes a message request to a user whose DM privacy blocks strangers.
struct MessageRequestSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let user: PublicUser
    var onSent: (() -> Void)?

    @State private var text = ""
    @State private var isBusy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: YoohTheme.Spacing.m) {
                        AvatarView(dataURL: user.avatar, name: user.title, size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.title).font(.headline)
                            Text("Этот пользователь принимает сообщения только от контактов. Представьтесь — он сможет принять или отклонить заявку.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section("Сообщение (необязательно)") {
                    TextField("Привет! Хочу пообщаться…", text: $text, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                AsyncButton(title: "Отправить заявку", isBusy: isBusy) {
                    await send()
                }
            }
            .navigationTitle("Заявка на переписку")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private func send() async {
        error = nil
        isBusy = true
        defer { isBusy = false }
        do {
            let res = try await app.requestsService.sendRequest(userId: user.id, text: text)
            if res.accepted == true {
                await app.chatsViewModel.refresh()
            }
            Haptics.send()
            onSent?()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

/// Message-request inbox: incoming accept/decline + outgoing pending list.
struct RequestsInboxView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var openedChat: YoohChat?

    var body: some View {
        @Bindable var requests = app.requestsViewModel
        NavigationStack {
            List {
                if let error = requests.error {
                    ErrorBanner(message: error, onDismiss: { requests.clearError() })
                        .listRowSeparator(.hidden)
                }
                Section("Входящие") {
                    if requests.incoming.isEmpty {
                        Text("Нет новых заявок.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(requests.incoming) { r in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: YoohTheme.Spacing.m) {
                                AvatarView(dataURL: r.user?.avatar, name: r.user?.title ?? "?",
                                           size: 48)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.user?.title ?? "Пользователь")
                                        .font(.headline)
                                    if let text = r.text, !text.isEmpty {
                                        Text(text)
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    if let at = r.createdAt {
                                        Text(YoohDates.fullDateTime(at))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }
                            HStack {
                                Button("Отклонить") {
                                    Task { await requests.decline(r) }
                                }
                                .buttonStyle(.bordered)
                                Spacer()
                                Button("Принять") {
                                    Task {
                                        if let chat = await requests.accept(r) {
                                            openedChat = chat
                                            dismiss()
                                        }
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if !requests.outgoing.isEmpty {
                    Section("Отправленные") {
                        ForEach(requests.outgoing) { r in
                            HStack(spacing: YoohTheme.Spacing.m) {
                                AvatarView(dataURL: r.user?.avatar, name: r.user?.title ?? "?",
                                           size: 40)
                                VStack(alignment: .leading) {
                                    Text(r.user?.title ?? "Пользователь")
                                        .font(.subheadline)
                                    Text("Ожидает ответа")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Заявки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .refreshable {
                await requests.refresh()
            }
            .task {
                await requests.refresh()
            }
            .navigationDestination(item: $openedChat) { chat in
                ChatDetailView(chat: chat, app: app)
            }
        }
    }
}
