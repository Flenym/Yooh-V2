import SwiftUI

/// Stars balance + transfer by username (server: transferStars).
struct StarsView: View {
    @Environment(AppState.self) private var app
    @State private var target = ""
    @State private var amountText = ""
    @State private var isBusy = false
    @State private var error: String?
    @State private var notice: String?

    var body: some View {
        List {
            Section {
                HStack {
                    Text("⭐")
                        .font(.system(size: 40))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Мои звёзды")
                            .font(.headline)
                        Text("Баланс: \(app.session.currentUser?.starsBalance ?? 0) ⭐")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }
            Section("Отправить звёзды") {
                TextField("Username получателя", text: $target)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .textInputAutocapitalization(.never)
                TextField("Сумма", text: $amountText)
                    .keyboardType(.numberPad)
                AsyncButton(title: "Отправить", isBusy: isBusy) {
                    await send()
                }
                .disabled(target.trimmingCharacters(in: .whitespaces).isEmpty
                          || (Int(amountText) ?? 0) <= 0)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Звёзды")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func send() async {
        error = nil
        notice = nil
        guard let amount = Int(amountText.trimmingCharacters(in: .whitespaces)), amount > 0 else {
            error = "Введите сумму."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let res = try await app.authService.transferStars(
                target: target.trimmingCharacters(in: .whitespaces), amount: amount)
            notice = "Отправлено \(res.sent ?? amount) ⭐. Новый баланс: \(res.balance ?? 0)."
            await app.profileViewModel.reload()
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
