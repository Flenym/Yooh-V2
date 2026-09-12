import SwiftUI

struct SendStarsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let userId: String
    let name: String

    @State private var amount = 10
    @State private var confirm = false
    @State private var error: String?
    @State private var notice: String?
    @State private var isBusy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        AvatarView(dataURL: nil, name: name, size: 52)
                        VStack(alignment: .leading) {
                            Text(name).font(.headline)
                            Text("Balance: \(app.session.currentUser?.starsBalance ?? 0) ⭐")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Amount") {
                    Stepper("\(amount) ⭐", value: $amount, in: 1...10000)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                if let notice {
                    Text(notice).font(.footnote).foregroundStyle(.green)
                }
                AsyncButton(title: "Send \(amount) ⭐", isBusy: isBusy) {
                    confirm = true
                }
            }
            .navigationTitle("Send Stars")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .confirmationDialog("Send \(amount) ⭐ to \(name)?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Send") {
                    Task { await send() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func send() async {
        error = nil
        notice = nil
        isBusy = true
        defer { isBusy = false }
        do {
            let res = try await app.authService.transferStars(target: userId, amount: amount)
            await app.profileViewModel.reload()
            notice = "Sent \(res.sent ?? amount) ⭐. New balance: \(res.balance ?? 0)."
            Haptics.send()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct ContactNoteField: View {
    @Environment(AppState.self) private var app
    let userId: String

    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Private note (only you see it)")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("How you met, birthday, anything…", text: $note, axis: .vertical)
                .font(.subheadline)
                .onChange(of: note) { _, v in
                    app.contactNotes.setNote(v, userId: userId)
                }
        }
        .padding(.top, 6)
        .onAppear {
            note = app.contactNotes.note(userId: userId)
        }
        .accessibilityLabel(Text("Private contact note"))
    }
}
