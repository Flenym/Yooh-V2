import SwiftUI

/// In-chat full-text search (server `/messages/search`, member-only).
/// Tapping a result pages history until the message is loaded, then jumps.
struct MessageSearchView: View {
    @Environment(\.dismiss) private var dismiss
    let vm: ChatViewModel

    @State private var query = ""
    @State private var results: [YoohMessage] = []
    @State private var isSearching = false
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if results.isEmpty, !isSearching, query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    EmptyStateView(symbol: "magnifyingglass", title: "No matches",
                                   subtitle: "Try different words.")
                } else {
                    List(results) { m in
                        Button {
                            dismiss()
                            vm.jumpToMessage(m.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(m.sender?.displayName ?? m.sender?.title ?? "")
                                    .font(.caption.bold())
                                    .foregroundStyle(ThemeStore.shared.accent)
                                Text(m.text ?? "")
                                    .font(.subheadline)
                                    .lineLimit(3)
                                Text(YoohDates.fullDateTime(m.createdAt))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Search in chat")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Words in messages")
            .onChange(of: query) { _, q in run(q) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .overlay {
                if isSearching { ProgressView() }
            }
            .overlay(alignment: .top) {
                if let error {
                    ErrorBanner(message: error, onDismiss: { self.error = nil })
                }
            }
        }
    }

    private func run(_ q: String) {
        searchTask?.cancel()
        let query = q.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else {
            results = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let found = try await vm.searchMessages(query)
                guard !Task.isCancelled else { return }
                results = found
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
