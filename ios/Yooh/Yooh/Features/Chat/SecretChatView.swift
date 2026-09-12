import PhotosUI
import SwiftUI

/// Device-local secret chat: messages never leave this phone, optional
/// self-destruct timer, pairing fingerprint. Web-client semantics.
struct SecretChatView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var vm: SecretChatViewModel
    @State private var photoItem: PhotosPickerItem?
    @State private var showFingerprint = false
    @State private var confirmDeleteChat = false
    let onDelete: () -> Void

    init(chat: SecretChat, userId: String, onDelete: @escaping () -> Void) {
        _vm = State(initialValue: SecretChatViewModel(chat: chat, userId: userId))
        self.onDelete = onDelete
    }

    var body: some View {
        @Bindable var vm = vm
        NavigationStack {
            ZStack {
                LinearGradient(colors: [YoohTheme.TG.wallpaperTop, YoohTheme.TG.wallpaperBottom],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                VStack(spacing: 0) {
                    lockBanner
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(vm.messages) { m in
                                    secretRow(m)
                                        .id(m.id)
                                }
                                Color.clear.frame(height: 1).id("bottom")
                            }
                            .padding(.horizontal, YoohTheme.Spacing.m)
                            .padding(.vertical, YoohTheme.Spacing.s)
                        }
                        .onChange(of: vm.messages.count) {
                            withAnimation(.snappy) {
                                proxy.scrollTo("bottom", anchor: .bottom)
                            }
                        }
                        .refreshable {
                            vm.reload()
                        }
                    }
                    secretComposer(vm)
                }
            }
            .navigationTitle(vm.chat.peerName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showFingerprint = true } label: {
                            Label("Fingerprint", systemImage: "key.fill")
                        }
                        Menu("Self-destruct timer") {
                            ForEach([0, 10, 60, 3600, 86400], id: \.self) { s in
                                Button(ttlName(s)) { vm.setTTL(s) }
                            }
                        }
                        Button("Delete secret chat", role: .destructive) {
                            confirmDeleteChat = true
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(Text("Secret chat options"))
                }
            }
            .sheet(isPresented: $showFingerprint) {
                NavigationStack {
                    VStack(spacing: YoohTheme.Spacing.m) {
                        Image(systemName: "key.fill")
                            .font(.largeTitle)
                            .foregroundStyle(ThemeStore.shared.accent)
                        Text("Pairing fingerprint")
                            .font(.headline)
                        Text(vm.chat.fingerprint)
                            .font(.body.monospaced())
                            .multilineTextAlignment(.center)
                            .padding()
                            .background(YoohTheme.TG.card, in: .rect(cornerRadius: 16))
                        Text("Compare with your peer to verify this pairing.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding()
                    .navigationTitle("Fingerprint")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Close") { showFingerprint = false }
                        }
                    }
                }
                .presentationDetents([.medium])
            }
            .confirmationDialog("Delete this secret chat and all its messages?", isPresented: $confirmDeleteChat, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    vm.deleteChat()
                    onDelete()
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let img = UIImage(data: data)
                    {
                        vm.sendPhoto(img)
                    }
                }
            }
        }
    }

    private var lockBanner: some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Image(systemName: "lock.fill")
                .font(.caption)
                .foregroundStyle(ThemeStore.shared.accent)
            Text("Device-local · auto-delete \(vm.ttlLabel == "Off" ? "off" : vm.ttlLabel)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, YoohTheme.Spacing.l)
        .padding(.vertical, 6)
    }

    private func ttlName(_ s: Int) -> String {
        switch s {
        case 0: return "Off"
        case 1..<60: return "\(s) seconds"
        case 60..<3600: return "\(s / 60) minute(s)"
        case 3600..<86400: return "\(s / 3600) hour(s)"
        default: return "\(s / 86400) day(s)"
        }
    }

    private func secretRow(_ m: SecretMessage) -> some View {
        HStack {
            if m.senderIsMe { Spacer(minLength: 48) }
            VStack(alignment: m.senderIsMe ? .trailing : .leading, spacing: 3) {
                if let url = m.imageDataURL,
                   let data = MediaService.data(fromDataURL: url),
                   let img = UIImage(data: data)
                {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: 220)
                        .frame(height: 160)
                        .clipped()
                        .clipShape(.rect(cornerRadius: YoohTheme.Radius.m))
                }
                if let text = m.text, !text.isEmpty {
                    Text(text)
                        .font(.system(size: 17 * ThemeStore.shared.fontScale))
                        .textSelection(.enabled)
                        .padding(.horizontal, YoohTheme.Spacing.m)
                        .padding(.vertical, YoohTheme.Spacing.s)
                        .background(m.senderIsMe ? YoohTheme.TG.outgoing : YoohTheme.TG.incoming,
                                    in: RoundedRectangle(cornerRadius: YoohTheme.Radius.l))
                        .foregroundStyle(.primary)
                }
                HStack(spacing: 4) {
                    if m.editedAt != nil {
                        Text("edited").font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(YoohDates.bubbleTime(m.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if m.senderIsMe, m.expiresAt != nil {
                        Text("· self-destructs")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: YoohTheme.Layout.maxBubbleWidth, alignment: m.senderIsMe ? .trailing : .leading)
            if !m.senderIsMe { Spacer(minLength: 48) }
        }
        .contextMenu {
            if let text = m.text, !text.isEmpty {
                Button {
                    UIPasteboard.general.string = text
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
            }
            if m.senderIsMe, m.text != nil {
                Button { vm.beginEdit(m) } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            Button(role: .destructive) { vm.delete(m) } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func secretComposer(_ vm: SecretChatViewModel) -> some View {
        @Bindable var vm = vm
        return VStack(spacing: 0) {
            if vm.editing != nil {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Edit message").font(.caption.bold()).foregroundStyle(ThemeStore.shared.accent)
                        Text(vm.editing?.text ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Button { vm.cancelEdit() } label: {
                        Image(systemName: "xmark").font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityLabel(Text("Cancel edit"))
                }
                .padding(.horizontal, YoohTheme.Spacing.m)
                .padding(.vertical, 4)
            }
            HStack(alignment: .bottom, spacing: YoohTheme.Spacing.s) {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Image(systemName: "photo")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 40, height: 40)
                }
                .yoohGlass(.interactive, cornerRadius: 20)
                .accessibilityLabel(Text("Send photo"))
                TextField("Secret message", text: $vm.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, YoohTheme.Spacing.m)
                    .padding(.vertical, 10)
                    .background(YoohTheme.TG.field, in: .rect(cornerRadius: 20))
                    .onSubmit { vm.send() }
                    .accessibilityLabel(Text("Secret message text"))
                Button { vm.send() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(ThemeStore.shared.accent, in: .circle)
                }
                .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && vm.editing == nil)
                .accessibilityLabel(Text(vm.editing == nil ? "Send" : "Save edit"))
            }
            .padding(.horizontal, YoohTheme.Spacing.s)
            .padding(.vertical, YoohTheme.Spacing.xs)
        }
        .padding(.horizontal, YoohTheme.Spacing.s)
        .padding(.bottom, YoohTheme.Spacing.s)
    }
}
