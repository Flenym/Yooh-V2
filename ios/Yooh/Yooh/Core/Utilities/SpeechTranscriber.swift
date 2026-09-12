import Foundation
import Speech

/// On-device (when available) speech-to-text via Apple's Speech framework.
enum SpeechTranscriber {
    enum TranscribeError: Error {
        case unavailable
        case denied
        case failed
    }

    static func transcribe(url: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            throw TranscribeError.unavailable
        }
        let status = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard status == .authorized else {
            throw TranscribeError.denied
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        return try await withCheckedThrowingContinuation { cont in
            var finished = false
            let task = recognizer.recognitionTask(with: request) { result, error in
                guard !finished else { return }
                if let result, result.isFinal {
                    finished = true
                    cont.resume(returning: result.bestTranscription.formattedString)
                } else if error != nil {
                    finished = true
                    cont.resume(throwing: TranscribeError.failed)
                }
            }
            if task == nil {
                finished = true
                cont.resume(throwing: TranscribeError.failed)
            }
        }
    }
}
