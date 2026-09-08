import PhotosUI
import SwiftUI

/// Own profile: view + edit (name, username, about, avatar photo).
struct ProfileView: View {
    @Environment(AppState.self) private var app
    @State private var isEditing = false
    @State private var avatarItem: PhotosPickerItem?

    var body: some View {
        @Bindable var profile = app.profileViewModel
        Group {
            if let user = profile.user {
                Form {
                    Section {
                        HStack(spacing: YoohTheme.Spacing.l) {
                            AvatarView(dataURL: user.avatar,
                                       name: user.displayName,
                                       size: YoohTheme.Layout.avatarXL)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 4) {
                                    Text(user.displayName).font(.title3.bold())
                                    if user.isPremium {
                                        Image(systemName: "star.fill")
                                            .font(.caption)
                                            .foregroundStyle(.yellow)
                                            .accessibilityLabel(Text("Premium"))
                                    }
                                }
                                Text("@\(user.username)")
                                    .font(.subheadline)
                                    .foregroundStyle(Color.accentColor)
                                Text(user.phone)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, YoohTheme.Spacing.s)
                        if !user.about.isEmpty {
                            Text(user.about).font(.subheadline)
                        }
                    }
                    if isEditing {
                        Section("Edit profile") {
                            TextField("Name", text: $profile.displayName)
                            TextField("username", text: $profile.username)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                            TextField("About", text: $profile.about, axis: .vertical)
                            PhotosPicker(selection: $avatarItem, matching: .images) {
                                Label("Change photo", systemImage: "photo")
                            }
                            AsyncButton(title: "Save", isBusy: profile.isSaving) {
                                if await profile.save() { isEditing = false }
                            }
                        }
                    }
                    Section("Account") {
                        LabeledContent("Stars", value: "\(user.starsBalance)")
                        if user.cloudPasswordEnabled {
                            Label("Two-step verification on", systemImage: "lock.fill")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let error = profile.error {
                        ErrorBanner(message: error, onDismiss: { profile.clearError() })
                    }
                    if let notice = profile.notice {
                        Text(notice).font(.footnote).foregroundStyle(.green)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? "Done" : "Edit") {
                    if isEditing {
                        profile.clearError()
                    } else {
                        profile.beginEditing()
                    }
                    isEditing.toggle()
                }
            }
        }
        .onChange(of: avatarItem) { _, item in
            guard let item else { return }
            avatarItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let img = UIImage(data: data) else { return }
                await profile.saveAvatar(img)
            }
        }
        .task {
            await profile.reload()
        }
    }
}
