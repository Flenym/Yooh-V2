import SwiftUI

/// Play/pause row for voice-message attachments (disk-cached by file id).
struct VoicePlayerView: View {
    @Environment(AppState.self) private var app
    let fileId: String
    var token: String?

    @State private var player = VoicePlayer()

    private var resolvedToken: String? {
        token ?? app.session.token
    }

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Button {
                if let token = resolvedToken {
                    player.toggle(fileId: fileId, token: token)
                }
            } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title2)
            }
            .buttonStyle(.plain)
            .disabled(resolvedToken == nil)
            .accessibilityLabel(Text(player.isPlaying ? "Пауза" : "Слушать голосовое"))
            if player.duration > 0 {
                Text("\(Int(player.progress)) / \(Int(player.duration)) s")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            } else {
                Text("Голосовое сообщение")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .onDisappear { player.stop() }
    }
}
