import SwiftUI

/// Optional admin console: server stats, live OTP codes (dev) and
/// support broadcast. Same `x-admin-token` contract as web admin.html.
/// Hidden until a token is entered; the token lives in Keychain.
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
            Section("Access") {
                if service.token == nil {
                    SecureField("Admin token", text: $tokenInput)
                    Button("Save token") {
                        service.token = tokenInput.trimmingCharacters(in: .whitespaces)
                        tokenInput = ""
                        Task { await reload() }
                    }
                    .disabled(tokenInput.trimmingCharacters(in: .whitespaces).isEmpty)
                } else {
                    Button("Forget token", role: .destructive) {
                        service.token = nil
                        stats = [:]
                        codes = []
                    }
                }
            }
            if service.token != nil {
                Section("Server stats") {
                    if stats.isEmpty {
                        Text("No data — pull to refresh.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(statRows, id: \.0) { key, value in
                        LabeledContent(key, value: value)
                    }
                }
                Section("Live OTP codes") {
                    if codes.isEmpty {
                        Text("No active codes.")
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
                Section("Broadcast") {
                    TextField("Message to all users…", text: $broadcastText, axis: .vertical)
                    AsyncButton(title: "Send broadcast", isBusy: isBusy) {
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
        .navigationTitle("Admin")
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
            notice = "Broadcast sent."
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
