import CoreImage.CIFilterBuiltins
import SwiftUI

/// Displays a QR login code for another device to scan. Polls status
/// until approved or expired.
struct ShowQRView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var token: String?
    @State private var error: String?
    @State private var linked = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            VStack(spacing: YoohTheme.Spacing.l) {
                if linked {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.green)
                    Text("Device linked!")
                        .font(.title3.bold())
                    Text("The other device is now logged in.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else if let token, let img = qrImage(token) {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 240, height: 240)
                        .padding()
                        .background(Color.white, in: .rect(cornerRadius: 20))
                    Text("Scan with a logged-in Yooh app to authorize this device.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                } else if error == nil {
                    ProgressView()
                }
                if let error {
                    ErrorBanner(message: error, onDismiss: { self.error = nil })
                        .padding(.horizontal, -YoohTheme.Spacing.l)
                    Button("Try again") {
                        Task { await create() }
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
            }
            .padding(YoohTheme.Spacing.xl)
            .navigationTitle("Link new device")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .task {
                await create()
            }
            .onDisappear {
                pollTask?.cancel()
            }
        }
    }

    private func create() async {
        error = nil
        linked = false
        pollTask?.cancel()
        do {
            let (token, _) = try await app.authService.createQRToken()
            self.token = token
            pollTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    guard !Task.isCancelled else { return }
                    do {
                        let st = try await app.authService.qrStatus(token: token)
                        if st.status == "authorized" {
                            linked = true
                            pollTask?.cancel()
                            Haptics.send()
                            return
                        }
                        if st.status == "expired" {
                            error = "Code expired. Create a new one."
                            pollTask?.cancel()
                            return
                        }
                    } catch {
                        // Transient poll failure: keep polling.
                    }
                }
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func qrImage(_ string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let out = filter.outputImage else { return nil }
        let scaled = out.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
