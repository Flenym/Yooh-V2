import SwiftUI

/// Call history (real API) with All/Missed filter. Live media needs a
/// WebRTC engine; tapping Call explains this instead of faking a call.
struct CallsView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var calls = app.callsViewModel
        NavigationStack {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
                Group {
                    if calls.visible.isEmpty, !calls.isLoading {
                        EmptyStateView(symbol: "phone", title: "No calls",
                                       subtitle: calls.filter == .missed
                                           ? "No missed calls."
                                           : "Your call history will appear here.")
                    } else {
                        List {
                            ForEach(calls.visible, id: \.id) { call in
                                CallRowView(call: call)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            Task { await calls.delete(call) }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .background(YoohTheme.TG.background)
                        .refreshable { await calls.refresh() }
                    }
                }
            }
            .navigationTitle("Calls")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Filter", selection: $calls.filter) {
                        Text("All").tag(CallsViewModel.Filter.all)
                        Text("Missed").tag(CallsViewModel.Filter.missed)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 180)
                }
            }
            .overlay(alignment: .top) {
                VStack(spacing: YoohTheme.Spacing.s) {
                    if let error = calls.error {
                        ErrorBanner(message: error, onDismiss: { calls.clearError() })
                    }
                    if let notice = calls.notice {
                        NoticeBanner(message: notice, onDismiss: { calls.clearNotice() })
                    }
                }
            }
            .task {
                await calls.refresh()
            }
        }
    }
}

private struct CallRowView: View {
    @Environment(AppState.self) private var app
    let call: CallLog

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.m) {
            AvatarView(dataURL: call.peer?.avatar,
                       name: title, size: YoohTheme.Layout.avatarM)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(call.isMissed ? .red : .primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: call.direction == "outgoing" ? "phone.arrow.up.right" : "phone.arrow.down.left")
                .foregroundStyle(call.isMissed ? .red : .secondary)
            Button {
                app.callsViewModel.unavailableNotice()
            } label: {
                Image(systemName: "phone")
                    .foregroundStyle(ThemeStore.shared.accent)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(Text("Call back"))
        }
        .padding(.vertical, YoohTheme.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        call.peer?.title ?? call.chat?.title ?? "Unknown"
    }

    private var subtitle: String {
        var parts: [String] = []
        parts.append(YoohDates.fullDateTime(call.createdAt))
        if let mode = call.mode {
            parts.append(mode == "video" ? "Video" : "Audio")
        }
        if let d = call.durationSeconds, d > 0 {
            parts.append("\(d)s")
        } else {
            parts.append(call.status ?? "")
        }
        return parts.joined(separator: " · ")
    }
}
