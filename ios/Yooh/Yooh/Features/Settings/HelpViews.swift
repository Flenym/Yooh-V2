import SwiftUI

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
            Section("Ваше обращение") {
                if let ticket {
                    LabeledContent("Тикет", value: "#\(ticket.number ?? 0)")
                    if let created = ticket.createdAt {
                        LabeledContent("Открыт", value: YoohDates.fullDateTime(created))
                    }
                } else {
                    Text("Нет активного тикета.")
                        .foregroundStyle(.secondary)
                }
                Picker("Категория", selection: $category) {
                    Text("Ошибка").tag("bug")
                    Text("Идея").tag("idea")
                    Text("Аккаунт").tag("account")
                    Text("Другое").tag("other")
                }
                .pickerStyle(.segmented)
                AsyncButton(title: ticket == nil ? "Создать тикет" : "Новый тикет", isBusy: isBusy) {
                    await create()
                }
            }
            if supportChatId != nil {
                Section {
                    Button("Открыть чат поддержки") {
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
        .navigationTitle("Поддержка")
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
            notice = "Тикет создан. Поддержка ответит в чате поддержки."
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
            error = "Чат поддержки пока недоступен."
        }
    }
}

struct FAQView: View {
    private let items: [(q: String, a: String)] = [
        ("Как войти в аккаунт?", "Используйте номер телефона или email. Введите 6-значный код. Если включён облачный пароль, введите его на втором шаге."),
        ("Как создать группу или канал?", "Нажмите кнопку нового чата в «Чатах», затем меню +: «Новая группа» или «Новый канал». У публичных групп может быть @ссылка для вступления."),
        ("Как работают реакции?", "Зажмите сообщение и выберите эмодзи или нажмите на существующую реакцию, чтобы убрать свою."),
        ("Как работают опросы?", "Вложения → Опрос. Есть одиночный выбор, множественный и викторина; нажмите на вариант, чтобы проголосовать."),
        ("Как переслать сообщение?", "Зажмите сообщение → «Переслать», затем выберите чат."),
        ("Можно ли редактировать или удалять сообщения?", "Свои — да. В личных чатах удалять может любая сторона. Удалённые сообщения не оставляют следов."),
        ("Что такое истории?", "Короткие фотопубликации на 24 часа. Ставьте реакции, смотрите просмотры, публикуйте свои из «Чатов» (+) или экрана «Истории»."),
        ("Почему нельзя позвонить?", "Для голосовой и видеосвязи нужен WebRTC-движок (следующий релиз). История звонков и входящие уже работают."),
        ("Как сменить тему?", "Настройки → Оформление: режим интерфейса, цвет акцента, обои чата и размер текста."),
        ("Мои данные в безопасности?", "Токен хранится в Keychain. Включите облачный пароль (2FA) и блокировку приложения для защиты. Никому не сообщайте коды."),
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
        .navigationTitle("Вопросы и ответы")
        .navigationBarTitleDisplayMode(.inline)
    }
}
