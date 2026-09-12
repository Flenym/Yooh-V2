import SwiftUI

/// Custom chat folders (local rule sets, like the web client's folders).
struct FolderEditorView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var editing: LocalPreferences.FolderDef?
    @State private var name = ""
    @State private var includeDirect = true
    @State private var includeGroups = true
    @State private var includeChannels = true
    @State private var unreadOnly = false

    var body: some View {
        NavigationStack {
            List {
                Section("Folders") {
                    ForEach(app.chatsViewModel.customFolders) { f in
                        Button {
                            startEdit(f)
                        } label: {
                            HStack {
                                Text(f.name)
                                Spacer()
                                Text(summary(f))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                app.chatsViewModel.deleteCustomFolder(f.id)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                Section(editing == nil ? "New folder" : "Edit folder") {
                    TextField("Folder name", text: $name)
                    Toggle("Direct chats", isOn: $includeDirect)
                    Toggle("Groups", isOn: $includeGroups)
                    Toggle("Channels", isOn: $includeChannels)
                    Toggle("Unread only", isOn: $unreadOnly)
                    Button(editing == nil ? "Create folder" : "Save") {
                        save()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    if editing != nil {
                        Button("Cancel", role: .cancel) {
                            reset()
                        }
                    }
                }
            }
            .navigationTitle("Chat folders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                app.chatsViewModel.reloadFolders()
            }
        }
    }

    private func summary(_ f: LocalPreferences.FolderDef) -> String {
        var parts: [String] = []
        if f.includeDirect { parts.append("personal") }
        if f.includeGroups { parts.append("groups") }
        if f.includeChannels { parts.append("channels") }
        if f.unreadOnly { parts.append("unread") }
        return parts.isEmpty ? "empty" : parts.joined(separator: " · ")
    }

    private func startEdit(_ f: LocalPreferences.FolderDef) {
        editing = f
        name = f.name
        includeDirect = f.includeDirect
        includeGroups = f.includeGroups
        includeChannels = f.includeChannels
        unreadOnly = f.unreadOnly
    }

    private func reset() {
        editing = nil
        name = ""
        includeDirect = true
        includeGroups = true
        includeChannels = true
        unreadOnly = false
    }

    private func save() {
        let base = editing ?? LocalPreferences.FolderDef.make(name: "")
        var f = base
        f.name = name.trimmingCharacters(in: .whitespaces)
        f.includeDirect = includeDirect
        f.includeGroups = includeGroups
        f.includeChannels = includeChannels
        f.unreadOnly = unreadOnly
        app.chatsViewModel.saveCustomFolder(f)
        reset()
    }
}
