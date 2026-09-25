import Foundation

/// DEBUG visual-QA harness: `simctl launch … UITEST_CHATS|UITEST_CHAT|
/// UITEST_CONTACTS|UITEST_CALLS|UITEST_SETTINGS` boots the app with a
/// fake Russian session and mock data — no backend, no taps needed.
/// Compiled in Release too (parses launch args, inert without them);
/// all seeding is `#if DEBUG`-gated.
enum UITestPreview {
    static var isActive: Bool {
        CommandLine.arguments.contains(where: { $0.hasPrefix("UITEST_") })
    }

    static var initialTabID: String {
        let args = CommandLine.arguments
        if args.contains("UITEST_CONTACTS") { return "contacts" }
        if args.contains("UITEST_CALLS") { return "calls" }
        if args.contains("UITEST_SETTINGS") { return "settings" }
        return "chats"
    }

    @MainActor
    static var chatMessages: [YoohMessage]? {
#if DEBUG
        guard isActive else { return nil }
        return decode([YoohMessage].self, messageFixtures)
#else
        return nil
#endif
    }

    @MainActor
    static func configure(app: AppState) {
#if DEBUG
        guard isActive else { return }
        seedSession(app: app)
        seedChats(app: app)
        seedContacts(app: app)
        seedCalls(app: app)
        seedStories(app: app)
        if CommandLine.arguments.contains("UITEST_CHAT") {
            app.chatsPath.append("uitest-c1")
        }
#endif
    }

    // MARK: - Seeding (DEBUG only)

#if DEBUG
    @MainActor
    private static func seedSession(app: AppState) {
        let user: YoohUser = decode(YoohUser.self, """
        {"id":"uitest-me","chatId":"uitest-c0","phone":"+79001234567",
         "username":"ivan_petrov","displayName":"Иван Петров",
         "about":"Тестирую Yooh","avatar":"","banner":"","birthday":"",
         "locale":"ru","isPremium":true,"starsBalance":120,"emojiStatus":"🔥"}
        """)
        app.session.seedPreviewSession(user: user, token: "uitest-token")
    }

    @MainActor
    private static func seedChats(app: AppState) {
        let chats: [YoohChat] = decode([YoohChat].self, chatsFixture())
        app.chatsViewModel.seedPreviewChats(chats)
        let prefs = LocalPreferences(userId: "uitest-me")
        prefs.togglePin("uitest-c3")
        prefs.toggleMute("uitest-c2")
        prefs.setPinned(messageId: "uitest-m1", chatId: "uitest-c1")
    }

    @MainActor
    private static func seedContacts(app: AppState) {
        app.contactsViewModel.seedPreviewUsers([
            PublicUser(id: "uitest-ignat", username: "ignat", displayName: "Игнат 🐵"),
            PublicUser(id: "uitest-mama", username: "mama", displayName: "Мама"),
            PublicUser(id: "uitest-anna", username: "anna", displayName: "Анна"),
            PublicUser(id: "uitest-codex", username: "codex_bot", displayName: "CodeX", isBot: true),
        ])
    }

    @MainActor
    private static func seedCalls(app: AppState) {
        let calls: [CallLog] = decode([CallLog].self, """
        [{"id":"uitest-call1","status":"no_answer","mode":"audio","direction":"incoming",
          "createdAt":"\(iso(hoursAgo: 26))",
          "peer":{"id":"uitest-ignat","username":"ignat","displayName":"Игнат 🐵"}},
         {"id":"uitest-call2","status":"completed","mode":"audio","direction":"outgoing",
          "durationSeconds":245,"createdAt":"\(iso(hoursAgo: 5))",
          "peer":{"id":"uitest-mama","username":"mama","displayName":"Мама"}},
         {"id":"uitest-call3","status":"completed","mode":"video","direction":"outgoing",
          "durationSeconds":1024,"createdAt":"\(iso(hoursAgo: 49))",
          "peer":{"id":"uitest-anna","username":"anna","displayName":"Анна"}}]
        """)
        app.callsViewModel.seedPreviewCalls(calls)
    }

    @MainActor
    private static func seedStories(app: AppState) {
        let stories: [YoohStory] = decode([YoohStory].self, """
        [{"id":"uitest-s1","authorId":"uitest-ignat","createdAt":"\(iso(hoursAgo: 1))",
          "caption":"Выходные удались",
          "author":{"id":"uitest-ignat","username":"ignat","displayName":"Игнат 🐵"}},
         {"id":"uitest-s2","authorId":"uitest-mama","createdAt":"\(iso(hoursAgo: 3))",
          "caption":"Пирог готов!",
          "author":{"id":"uitest-mama","username":"mama","displayName":"Мама"}}]
        """)
        app.storiesViewModel.seedPreviewStories(stories)
    }

    // MARK: - Fixtures

    private static func chatsFixture() -> String {
        """
        [{"id":"uitest-c1","type":"direct","description":"",
          "members":[{"userId":"uitest-me"},{"userId":"uitest-ignat",
            "username":"ignat","displayName":"Игнат 🐵"}],
          "membersCount":2,"updatedAt":"\(iso(minutesAgo: 5))",
          "lastMessage":{"id":"uitest-lm1","senderId":"uitest-ignat","type":"text",
            "text":"Клецк","createdAt":"\(iso(minutesAgo: 5))","readByUserIds":[]}},
         {"id":"uitest-c2","type":"group","title":"Зелёные корешки","description":"Дачный чат",
          "members":[{"userId":"uitest-me"},{"userId":"uitest-ignat",
            "username":"ignat","displayName":"Игнат"},
           {"userId":"uitest-mama","username":"mama","displayName":"Мама"}],
          "membersCount":12,"updatedAt":"\(iso(hoursAgo: 2))",
          "lastMessage":{"id":"uitest-lm2","senderId":"uitest-ignat","type":"text",
            "text":"Лад, во сколько встречаемся?","createdAt":"\(iso(hoursAgo: 2))",
            "readByUserIds":["uitest-me"],
            "sender":{"id":"uitest-ignat","username":"ignat","displayName":"Игнат"}}},
         {"id":"uitest-c3","type":"channel","title":"CodeX | Джарвис",
          "description":"Канал разработки","members":[{"userId":"uitest-me"}],
          "membersCount":128,"updatedAt":"\(iso(hoursAgo: 26))",
          "lastMessage":{"id":"uitest-lm3","senderId":"uitest-me","type":"text",
            "text":"А вот и сама презентация, кому интересно",
            "createdAt":"\(iso(hoursAgo: 26))","readByUserIds":["uitest-ignat"]}},
         {"id":"uitest-c4","type":"direct","description":"",
          "members":[{"userId":"uitest-me"},{"userId":"uitest-mama",
            "username":"mama","displayName":"Мама"}],
          "membersCount":2,"updatedAt":"\(iso(hoursAgo: 76))",
          "lastMessage":{"id":"uitest-lm4","senderId":"uitest-me","type":"text",
            "text":"Хорошо, спасибо","createdAt":"\(iso(hoursAgo: 76))",
            "readByUserIds":["uitest-mama"]}}]
        """
    }

    private static var messageFixtures: String {
        """
        [{"id":"uitest-m1","chatId":"uitest-c1","senderId":"uitest-ignat",
          "type":"text","text":"Зачем ты замазываешь лицо на аве",
          "createdAt":"\(iso(hoursAgo: 3))","readByUserIds":["uitest-me"]},
         {"id":"uitest-m2","chatId":"uitest-c1","senderId":"uitest-me",
          "type":"text","text":"а че такое","createdAt":"\(iso(hoursAgo: 3, plusMinutes: 9))",
          "readByUserIds":["uitest-ignat"]},
         {"id":"uitest-m3","chatId":"uitest-c1","senderId":"uitest-me",
          "type":"text","text":"лицо мне не нравится просто",
          "createdAt":"\(iso(hoursAgo: 3, plusMinutes: 10))",
          "readByUserIds":["uitest-ignat"]},
         {"id":"uitest-m4","chatId":"uitest-c1","senderId":"uitest-me",
          "type":"text","text":"и все","createdAt":"\(iso(hoursAgo: 3, plusMinutes: 11))",
          "readByUserIds":["uitest-ignat"]},
         {"id":"uitest-m5","chatId":"uitest-c1","senderId":"uitest-ignat",
          "type":"text","text":"хорошо, спасибо","createdAt":"\(iso(minutesAgo: 5))",
          "readByUserIds":[]}]
        """
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private static func iso(minutesAgo: Int = 0, hoursAgo: Int = 0, plusMinutes: Int = 0) -> String {
        let d = Date().addingTimeInterval(TimeInterval(-minutesAgo * 60 - hoursAgo * 3600 + plusMinutes * 60))
        return ISO8601DateFormatter().string(from: d)
    }
#endif
}
