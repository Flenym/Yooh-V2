import SwiftUI

struct DeleteAccountView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var confirm = false
    @State private var error: String?
    @State private var isBusy = false

    private var needsPassword: Bool {
        app.session.currentUser?.cloudPasswordEnabled == true
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This permanently deletes your account, chats memberships, sessions, stories and requests. Messages you sent stay visible to others.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if needsPassword {
                    Section("Подтвердите облачным паролем") {
                        SecureField("Облачный пароль", text: $password)
                    }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                AsyncButton(title: "Удалить мой аккаунт", isBusy: isBusy) {
                    confirm = true
                }
                .disabled(needsPassword && password.isEmpty)
            }
            .navigationTitle("Удаление аккаунта")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
            .confirmationDialog("Удалить аккаунт навсегда?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Удалить навсегда", role: .destructive) {
                    Task { await delete() }
                }
                Button("Отмена", role: .cancel) {}
            }
        }
    }

    private func delete() async {
        error = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.authService.deleteAccount(password: needsPassword ? password : nil)
            Haptics.error()
            app.logout()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
