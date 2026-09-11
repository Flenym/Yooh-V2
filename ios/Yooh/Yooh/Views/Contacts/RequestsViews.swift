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
                            Text("This user only accepts messages from contacts. Introduce yourself — they can accept or decline.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section("Message (optional)") {
                    TextField("Hi! I'd like to chat…", text: $text, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                AsyncButton(title: "Send request", isBusy: isBusy) {
                    await send()
                }
            }
            .navigationTitle("Message request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
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
                Section("Incoming") {
                    if requests.incoming.isEmpty {
                        Text("No pending requests.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(requests.incoming) { r in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: YoohTheme.Spacing.m) {
                                AvatarView(dataURL: r.user?.avatar, name: r.user?.title ?? "?",
                                           size: 48)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.user?.title ?? "User")
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
                                Button("Decline") {
                                    Task { await requests.decline(r) }
                                }
                                .buttonStyle(.bordered)
                                Spacer()
                                Button("Accept") {
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
                    Section("Sent") {
                        ForEach(requests.outgoing) { r in
                            HStack(spacing: YoohTheme.Spacing.m) {
                                AvatarView(dataURL: r.user?.avatar, name: r.user?.title ?? "?",
                                           size: 40)
                                VStack(alignment: .leading) {
                                    Text(r.user?.title ?? "User")
                                        .font(.subheadline)
                                    Text("Waiting for answer")
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
            .navigationTitle("Requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
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
