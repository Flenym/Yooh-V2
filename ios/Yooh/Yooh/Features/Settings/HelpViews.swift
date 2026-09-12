import SwiftUI

/// Support tickets: state, creation per category, jumping into the
/// support conversation.
struct SupportView: View {
    @Environment(AppState.self) private var app
    @State private var category = "bug"
    @State private var ticket: SupportTicket?
    @State private var supportChatId: String?
    @State private var openChat: YoohChat?
    @State private var error: String?
    @State private var notice: String?
    @State private var isBusy = false

    var body: some View {
        List {
            Section("Your request") {
                if let ticket {
                    LabeledContent("Ticket", value: "#\(ticket.number ?? 0)")
                    if let created = ticket.createdAt {
                        LabeledContent("Opened", value: YoohDates.fullDateTime(created))
                    }
                } else {
                    Text("No active ticket.")
                        .foregroundStyle(.secondary)
                }
                Picker("Category", selection: $category) {
                    Text("Bug").tag("bug")
                    Text("Idea").tag("idea")
                    Text("Account").tag("account")
                    Text("Other").tag("other")
                }
                .pickerStyle(.segmented)
                AsyncButton(title: ticket == nil ? "Open ticket" : "New ticket", isBusy: isBusy) {
                    await create()
                }
            }
            if supportChatId != nil {
                Section {
                    Button("Open support chat") {
                        Task { await openSupportChat() }
                    }
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Support")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $openChat) { chat in
            NavigationStack {
                ChatDetailView(chat: chat, app: app)
            }
        }
    }

    private func load() async {
        do {
            let state = try await app.settingsService.supportTicketState()
            ticket = state.support?.ticket
            supportChatId = state.support?.chatId
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func create() async {
        error = nil
        notice = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.settingsService.createSupportTicket(category: category)
            notice = "Ticket opened. Support will reply in the support chat."
            Haptics.send()
            await load()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func openSupportChat() async {
        await app.chatsViewModel.refresh()
        if let id = supportChatId,
           let chat = app.chatsViewModel.chats.first(where: { $0.id == id })
        {
            openChat = chat
            app.socket.joinChat(id)
        } else {
            error = "Support chat isn't available yet."
        }
    }
}

/// Short FAQ compiled from the product docs.
struct FAQView: View {
    private let items: [(q: String, a: String)] = [
        ("How do I log in?", "Use your phone number or email. Enter the 6-digit code (in dev builds the code is also visible in the admin panel). If cloud password is on, enter it on the second step."),
        ("How do I create a group or channel?", "Tap the compose button in Chats, then the + menu: New group or New channel. Public groups can have an @handle others can join by."),
        ("How do reactions work?", "Long-press a message and pick an emoji, or tap an existing reaction to toggle yours."),
        ("How do polls work?", "Attach → Poll. Single, multiple-choice and quiz modes are supported; tap an option to vote."),
        ("How do I forward a message?", "Long-press → Forward, then pick the target chat."),
        ("Can I edit or delete messages?", "Your own messages: yes. In direct chats either side can delete. Deleted messages leave no trace."),
        ("What are stories?", "Short photo posts visible for 24 hours. React, view who watched, publish your own from Chats (+) or the Stories screen."),
        ("Why can't I call?", "Voice/video media needs a WebRTC engine (next release). Call history and incoming-call alerts already work."),
        ("How do I change the theme?", "Settings → Appearance: interface mode, accent color, chat wallpaper and message text size."),
        ("Is my data safe?", "The token lives in Keychain. Enable cloud password (2FA) and App Lock for extra protection. Never share OTP codes."),
    ]

    var body: some View {
        List(items, id: \.q) { item in
            VStack(alignment: .leading, spacing: 6) {
                Text(item.q)
                    .font(.headline)
                Text(item.a)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
        .navigationTitle("FAQ")
        .navigationBarTitleDisplayMode(.inline)
    }
}
