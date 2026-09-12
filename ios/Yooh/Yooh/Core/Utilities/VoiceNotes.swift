import AVFoundation
import Foundation
import Observation

/// Voice note recording (m4a/AAC) for the composer.
@Observable
@MainActor
final class VoiceRecorder {
    private(set) var isRecording = false
    private(set) var elapsed: TimeInterval = 0
    private(set) var error: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var fileURL: URL?

    func start() {
        error = nil
        let session = AVAudioSession.sharedInstance()
        session.requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard granted else {
                    self?.error = "Microphone access is required for voice messages."
                    return
                }
                self?.beginRecording(session: session)
            }
        }
    }

    private func beginRecording(session: AVAudioSession) {
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.record()
            fileURL = url
            isRecording = true
            elapsed = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.elapsed += 0.25 }
            }
        } catch {
            self.error = "Couldn't start recording."
        }
    }

    func stop(discard: Bool = false) -> URL? {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
        guard !discard, elapsed >= 1, let url = fileURL else {
            if let url = fileURL { try? FileManager.default.removeItem(at: url) }
            fileURL = nil
            return nil
        }
        fileURL = nil
        return url
    }
}

/// Playback model for voice/file audio attachments.
@Observable
@MainActor
final class VoicePlayer {
    private(set) var isPlaying = false
    private(set) var duration: TimeInterval = 0
    private(set) var progress: TimeInterval = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?

    func toggle(fileId: String, token: String) {
        if isPlaying {
            stop()
        } else {
            Task { await play(fileId: fileId, token: token) }
        }
    }

    private func play(fileId: String, token: String) async {
        do {
            let url = try await AudioFileCache.shared.localURL(fileId: fileId, token: token)
            player = try AVAudioPlayer(contentsOf: url)
            player?.play()
            duration = player?.duration ?? 0
            isPlaying = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.progress = self?.player?.currentTime ?? 0
                    if self?.player?.isPlaying != true { self?.stop() }
                }
            }
        } catch {
            stop()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player?.stop()
        player = nil
        isPlaying = false
        progress = 0
    }
}

/// Disk cache for audio attachments (shared by playback + transcription).
actor AudioFileCache {
    static let shared = AudioFileCache()

    func localURL(fileId: String, token: String) async throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("audio-\(fileId)")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let data = try await MediaService().downloadData(fileId: fileId, inline: true, token: token)
        try data.write(to: url, options: .atomic)
        return url
    }
}
