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
                Section("Папки") {
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
                                Label("Удалить", systemImage: "trash")
                            }
                        }
                    }
                }
                Section(editing == nil ? "Новая папка" : "Изменить папку") {
                    TextField("Название папки", text: $name)
                    Toggle("Личные чаты", isOn: $includeDirect)
                    Toggle("Группы", isOn: $includeGroups)
                    Toggle("Каналы", isOn: $includeChannels)
                    Toggle("Только непрочитанные", isOn: $unreadOnly)
                    Button(editing == nil ? "Создать папку" : "Сохранить") {
                        save()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    if editing != nil {
                        Button("Отмена", role: .cancel) {
                            reset()
                        }
                    }
                }
            }
            .navigationTitle("Папки чатов")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Готово") { dismiss() }
                }
            }
            .task {
                app.chatsViewModel.reloadFolders()
            }
        }
    }

    private func summary(_ f: LocalPreferences.FolderDef) -> String {
        var parts: [String] = []
        if f.includeDirect { parts.append("личные") }
        if f.includeGroups { parts.append("группы") }
        if f.includeChannels { parts.append("каналы") }
        if f.unreadOnly { parts.append("непрочитанные") }
        return parts.isEmpty ? "пусто" : parts.joined(separator: " · ")
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
