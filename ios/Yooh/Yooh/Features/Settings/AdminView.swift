import SwiftUI

struct AdminView: View {
    @Environment(AppState.self) private var app
    @State private var service = AdminService()
    @State private var tokenInput = ""
    @State private var stats: [String: AnyCodable] = [:]
    @State private var codes: [AdminService.Code] = []
    @State private var broadcastText = ""
    @State private var error: String?
    @State private var notice: String?
    @State private var isBusy = false

    var body: some View {
        List {
            Section("Доступ") {
                if service.token == nil {
                    SecureField("Админ-токен", text: $tokenInput)
                    Button("Сохранить токен") {
                        service.token = tokenInput.trimmingCharacters(in: .whitespaces)
                        tokenInput = ""
                        Task { await reload() }
                    }
                    .disabled(tokenInput.trimmingCharacters(in: .whitespaces).isEmpty)
                } else {
                    Button("Забыть токен", role: .destructive) {
                        service.token = nil
                        stats = [:]
                        codes = []
                    }
                }
            }
            if service.token != nil {
                Section("Статистика сервера") {
                    if stats.isEmpty {
                        Text("Нет данных — потяните, чтобы обновить.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(statRows, id: \.0) { key, value in
                        LabeledContent(key, value: value)
                    }
                }
                Section("Активные OTP-коды") {
                    if codes.isEmpty {
                        Text("Нет активных кодов.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(codes) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.displayTarget).font(.headline)
                            Text("\(c.code ?? "—") · \(c.purpose ?? "") · \(c.channel ?? "")")
                                .font(.subheadline.monospacedDigit())
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .combine)
                    }
                }
                Section("Рассылка") {
                    TextField("Сообщение всем пользователям…", text: $broadcastText, axis: .vertical)
                    AsyncButton(title: "Отправить рассылку", isBusy: isBusy) {
                        await broadcast()
                    }
                    .disabled(broadcastText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Админ-панель")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task { await reload() }
    }

    private var statRows: [(String, String)] {
        let keys = ["users", "chats", "messages", "files", "calls", "reports", "feedback", "supportTickets", "bans", "mutes"]
        return keys.compactMap { k in
            guard let v = stats[k] else { return nil }
            switch v {
            case .int(let n): return (k, "\(n)")
            case .double(let d): return (k, "\(Int(d))")
            case .string(let s): return (k, s)
            default: return nil
            }
        }
    }

    private func reload() async {
        guard service.token != nil else { return }
        error = nil
        do {
            async let s = service.stats()
            async let c = service.authCodes()
            stats = try await s
            codes = try await c
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func broadcast() async {
        error = nil
        notice = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await service.broadcast(broadcastText.trimmingCharacters(in: .whitespacesAndNewlines))
            broadcastText = ""
            notice = "Рассылка отправлена."
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
