import SwiftUI

/// Privacy: audiences + per-user exceptions + read receipts + app lock.
/// Mirrors the web privacy sections (phone, last seen, photos, forwards,
/// calls, voice, messages, invites); the server merges `rules` shallowly,
/// so every save carries the complete snapshot.
struct PrivacyView: View {
    @Environment(AppState.self) private var app

    @State private var model = PrivacyRulesModel()
    @State private var pickerTarget: ExceptionTarget?
    @State private var error: String?

    var body: some View {
        List {
            phoneSection
            lastSeenSection
            photosSection
            forwardsSection
            callsSection
            voiceSection
            messagesSection
            invitesSection
            Section("Messages") {
                SettingToggleRow(title: "Read receipts",
                                 subtitle: "If off, you won't see theirs either",
                                 isOn: receiptBinding)
                {
                    model.readReceipts = $0
                    model.hideReadTime = !$0
                    save()
                }
            }
            Section("App lock") {
                SettingToggleRow(title: "Lock with \(AppLockStore.shared.biometryName)",
                                 subtitle: "Require authentication on launch and return",
                                 isOn: Binding(
                                     get: { AppLockStore.shared.isEnabled },
                                     set: { v in
                                         AppLockStore.shared.isEnabled = v
                                         if v { AppLockStore.shared.lock() }
                                         Haptics.selection()
                                     }
                                 )) { _ in }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .navigationTitle("Privacy")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $pickerTarget) { target in
            ExceptionUserPicker(title: target.addTitle,
                                exclude: ids(for: target)) { user in
                add(user, to: target)
            }
        }
    }

    // MARK: - Sections

    private var phoneSection: some View {
        Section("Phone number") {
            AudienceRow(title: "Who can see my number",
                        selection: audienceBinding(get: { model.phoneSee },
                                                   set: { model.phoneSee = $0 }))
            {
                save()
            }
            AudienceRow(title: "Who can find me by number",
                        selection: audienceBinding(get: { model.phoneFind },
                                                   set: { model.phoneFind = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always show my number to",
                            ids: model.phoneShow, store: exceptionStore,
                            onAdd: { pickerTarget = .phoneShow },
                            onRemove: { remove($0, from: .phoneShow) })
        }
    }

    private var lastSeenSection: some View {
        Section("Last seen & online") {
            AudienceRow(title: "Who can see my last seen",
                        subtitle: "Approximate values are shown instead of exact time",
                        selection: audienceBinding(get: { model.lastSeenSee },
                                                   set: { model.lastSeenSee = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always show to",
                            ids: model.lastSeenShow, store: exceptionStore,
                            onAdd: { pickerTarget = .lastSeenShow },
                            onRemove: { remove($0, from: .lastSeenShow) })
        }
    }

    private var photosSection: some View {
        Section("Profile photo") {
            AudienceRow(title: "Who can see my photo",
                        selection: audienceBinding(get: { model.photosSee },
                                                   set: { model.photosSee = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always show to",
                            ids: model.photosShow, store: exceptionStore,
                            onAdd: { pickerTarget = .photosShow },
                            onRemove: { remove($0, from: .photosShow) })
            ExceptionEditor(title: "Never show to",
                            ids: model.photosHide, store: exceptionStore,
                            onAdd: { pickerTarget = .photosHide },
                            onRemove: { remove($0, from: .photosHide) })
        }
    }

    private var forwardsSection: some View {
        Section("Forwarded messages") {
            AudienceRow(title: "Who can link back to my account",
                        selection: audienceBinding(get: { model.forwardsLink },
                                                   set: { model.forwardsLink = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always allow",
                            ids: model.forwardsAllow, store: exceptionStore,
                            onAdd: { pickerTarget = .forwardsAllow },
                            onRemove: { remove($0, from: .forwardsAllow) })
            ExceptionEditor(title: "Never allow",
                            ids: model.forwardsDeny, store: exceptionStore,
                            onAdd: { pickerTarget = .forwardsDeny },
                            onRemove: { remove($0, from: .forwardsDeny) })
        }
    }

    private var callsSection: some View {
        Section("Calls") {
            AudienceRow(title: "Who can call me",
                        selection: audienceBinding(get: { model.callsCall },
                                                   set: { model.callsCall = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always allow",
                            ids: model.callsAllow, store: exceptionStore,
                            onAdd: { pickerTarget = .callsAllow },
                            onRemove: { remove($0, from: .callsAllow) })
            ExceptionEditor(title: "Never allow",
                            ids: model.callsDeny, store: exceptionStore,
                            onAdd: { pickerTarget = .callsDeny },
                            onRemove: { remove($0, from: .callsDeny) })
        }
    }

    private var voiceSection: some View {
        Section("Voice messages") {
            ExceptionEditor(title: "Never accept voice from",
                            ids: model.voiceDeny, store: exceptionStore,
                            onAdd: { pickerTarget = .voiceDeny },
                            onRemove: { remove($0, from: .voiceDeny) })
        }
    }

    private var messagesSection: some View {
        Section("Direct messages") {
            AudienceRow(title: "Who can message me",
                        subtitle: "Strangers send requests instead",
                        selection: audienceBinding(get: { model.messagesSend },
                                                   set: { model.messagesSend = $0 }))
            {
                save()
            }
            ExceptionEditor(title: "Always allow",
                            ids: model.messagesAllow, store: exceptionStore,
                            onAdd: { pickerTarget = .messagesAllow },
                            onRemove: { remove($0, from: .messagesAllow) })
            ExceptionEditor(title: "Never allow",
                            ids: model.messagesDeny, store: exceptionStore,
                            onAdd: { pickerTarget = .messagesDeny },
                            onRemove: { remove($0, from: .messagesDeny) })
        }
    }

    private var invitesSection: some View {
        Section("Groups") {
            AudienceRow(title: "Who can invite me to groups",
                        selection: audienceBinding(get: { model.invites },
                                                   set: { model.invites = $0 }))
            {
                save()
            }
        }
    }

    // MARK: - State

    private var receiptBinding: Binding<Bool> {
        Binding(get: { model.readReceipts },
                set: {
                    model.readReceipts = $0
                    model.hideReadTime = !$0
                })
    }

    private func audienceBinding(get: @escaping () -> String,
                                 set: @escaping (String) -> Void) -> Binding<Audience>
    {
        Binding(get: { Audience.from(get()) },
                set: { set($0.wire) })
    }

    private var exceptionStore: ExceptionContactStore {
        ExceptionContactStore(userId: app.session.currentUser?.id ?? "anon")
    }

    private func ids(for target: ExceptionTarget) -> [String] {
        switch target {
        case .phoneShow: return model.phoneShow
        case .lastSeenShow: return model.lastSeenShow
        case .photosShow: return model.photosShow
        case .photosHide: return model.photosHide
        case .forwardsAllow: return model.forwardsAllow
        case .forwardsDeny: return model.forwardsDeny
        case .callsAllow: return model.callsAllow
        case .callsDeny: return model.callsDeny
        case .voiceDeny: return model.voiceDeny
        case .messagesAllow: return model.messagesAllow
        case .messagesDeny: return model.messagesDeny
        }
    }

    private func add(_ user: PublicUser, to target: ExceptionTarget) {
        exceptionStore.save(ExceptionContact(user))
        switch target {
        case .phoneShow: if !model.phoneShow.contains(user.id) { model.phoneShow.append(user.id) }
        case .lastSeenShow: if !model.lastSeenShow.contains(user.id) { model.lastSeenShow.append(user.id) }
        case .photosShow: if !model.photosShow.contains(user.id) { model.photosShow.append(user.id) }
        case .photosHide: if !model.photosHide.contains(user.id) { model.photosHide.append(user.id) }
        case .forwardsAllow: if !model.forwardsAllow.contains(user.id) { model.forwardsAllow.append(user.id) }
        case .forwardsDeny: if !model.forwardsDeny.contains(user.id) { model.forwardsDeny.append(user.id) }
        case .callsAllow: if !model.callsAllow.contains(user.id) { model.callsAllow.append(user.id) }
        case .callsDeny: if !model.callsDeny.contains(user.id) { model.callsDeny.append(user.id) }
        case .voiceDeny: if !model.voiceDeny.contains(user.id) { model.voiceDeny.append(user.id) }
        case .messagesAllow: if !model.messagesAllow.contains(user.id) { model.messagesAllow.append(user.id) }
        case .messagesDeny: if !model.messagesDeny.contains(user.id) { model.messagesDeny.append(user.id) }
        }
        Haptics.selection()
        save()
    }

    private func remove(_ id: String, from target: ExceptionTarget) {
        switch target {
        case .phoneShow: model.phoneShow.removeAll { $0 == id }
        case .lastSeenShow: model.lastSeenShow.removeAll { $0 == id }
        case .photosShow: model.photosShow.removeAll { $0 == id }
        case .photosHide: model.photosHide.removeAll { $0 == id }
        case .forwardsAllow: model.forwardsAllow.removeAll { $0 == id }
        case .forwardsDeny: model.forwardsDeny.removeAll { $0 == id }
        case .callsAllow: model.callsAllow.removeAll { $0 == id }
        case .callsDeny: model.callsDeny.removeAll { $0 == id }
        case .voiceDeny: model.voiceDeny.removeAll { $0 == id }
        case .messagesAllow: model.messagesAllow.removeAll { $0 == id }
        case .messagesDeny: model.messagesDeny.removeAll { $0 == id }
        }
        Haptics.selection()
        save()
    }

    private func load() async {
        do {
            let remote = try await app.settingsService.fetch()
            model = PrivacyRulesModel.parse(remote)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func save() {
        Task {
            do {
                try await app.settingsService.patch(section: "privacy", value: model.patchDict())
                await app.profileViewModel.reload()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

private enum ExceptionTarget: String, Identifiable {
    case phoneShow, lastSeenShow
    case photosShow, photosHide
    case forwardsAllow, forwardsDeny
    case callsAllow, callsDeny
    case voiceDeny
    case messagesAllow, messagesDeny

    var id: String { rawValue }

    var addTitle: String {
        switch self {
        case .phoneShow, .lastSeenShow, .photosShow: return "Always show to"
        case .photosHide: return "Never show to"
        case .forwardsAllow, .callsAllow, .messagesAllow: return "Always allow"
        case .forwardsDeny, .callsDeny, .messagesDeny, .voiceDeny: return "Never allow"
        }
    }
}

private struct ExceptionEditor: View {
    let title: String
    let ids: [String]
    let store: ExceptionContactStore
    var onAdd: () -> Void
    var onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                    .font(.system(size: 17))
                Spacer()
                Text("\(ids.count)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(Text("\(ids.count) users"))
                Button(action: onAdd) {
                    Image(systemName: "plus.circle")
                        .foregroundStyle(ThemeStore.shared.accent)
                }
                .accessibilityLabel(Text("Add user to \(title)"))
            }
            .padding(.vertical, 6)
            ForEach(ids, id: \.self) { id in
                HStack(spacing: 10) {
                    let contact = store.contact(for: id)
                    AvatarView(dataURL: contact?.avatar,
                               name: contact?.title ?? "User \(id.prefix(4))",
                               size: 32)
                    Text(contact?.title ?? "User \(id.prefix(8))")
                        .font(.subheadline)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        onRemove(id)
                    } label: {
                        Image(systemName: "minus.circle")
                            .foregroundStyle(.red)
                    }
                    .accessibilityLabel(Text("Remove user"))
                }
                .padding(.vertical, 4)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ExceptionUserPicker: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let title: String
    let exclude: [String]
    var onPick: (PublicUser) -> Void

    @State private var query = ""
    @State private var results: [PublicUser] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Section("Search") {
                        if isSearching {
                            ProgressView()
                        }
                        ForEach(visible(results), id: \.id) { user in
                            pickRow(user)
                        }
                    }
                }
                Section("Your contacts") {
                    ForEach(knownPeers, id: \.id) { user in
                        pickRow(user)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Name or @username")
            .onChange(of: query) { _, q in search(q) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var knownPeers: [PublicUser] {
        var seen: Set<String> = []
        var out: [PublicUser] = []
        let me = app.session.currentUser?.id
        for chat in app.chatsViewModel.chats where chat.type == .direct {
            guard let peer = chat.peer(myUserId: me ?? "") else { continue }
            guard peer.userId != me, !seen.contains(peer.userId) else { continue }
            seen.insert(peer.userId)
            out.append(PublicUser(peer: peer))
        }
        return out.filter { !exclude.contains($0.id) }
    }

    private func visible(_ users: [PublicUser]) -> [PublicUser] {
        let me = app.session.currentUser?.id
        return users.filter { $0.id != me && !exclude.contains($0.id) }
    }

    private func pickRow(_ user: PublicUser) -> some View {
        Button {
            onPick(user)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                AvatarView(dataURL: user.avatar, name: user.title, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(user.title).font(.headline).lineLimit(1)
                        if user.isBot { BotTag() }
                    }
                    if let u = user.username, !u.isEmpty {
                        Text("@\(u)").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    private func search(_ text: String) {
        searchTask?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let found = try await app.userService.searchUsers(query: q)
                guard !Task.isCancelled else { return }
                results = found
            } catch {
                guard !Task.isCancelled else { return }
                results = []
            }
        }
    }
}
