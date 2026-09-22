import SwiftUI

/// Country picker sheet with search (Russian names, dial codes).
struct CountryPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: Country
    @State private var query = ""

    private var filtered: [Country] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return Country.all }
        return Country.all.filter {
            $0.name.lowercased().contains(q) || $0.dial.contains(q) || $0.code.lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { c in
                Button {
                    Haptics.selection()
                    selection = c
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        Text(c.flag).font(.system(size: 24))
                        Text(c.name)
                            .font(.system(size: 17))
                            .foregroundStyle(.primary)
                        Spacer()
                        Text(c.dial)
                            .font(.system(size: 17))
                            .foregroundStyle(.secondary)
                        if c == selection {
                            Image(systemName: "checkmark")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(ThemeStore.shared.accent)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("Страна")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Поиск")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }
}
