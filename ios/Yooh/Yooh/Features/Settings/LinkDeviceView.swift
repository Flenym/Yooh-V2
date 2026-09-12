import AVFoundation
import SwiftUI

/// Links a desktop/web login by scanning its QR code (or pasting it).
struct LinkDeviceView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var manualToken = ""
    @State private var error: String?
    @State private var notice: String?
    @State private var isBusy = false
    @State private var scanned = ""

    var body: some View {
        List {
            Section {
                QRScannerRepresentable(onCode: { handleScan($0) })
                    .frame(height: 300)
                    .clipShape(.rect(cornerRadius: 16))
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text("Scan the QR code shown on the other device")
            }

            Section("Or enter manually") {
                TextField("https://…/?yooh_qr_login=token", text: $manualToken)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                AsyncButton(title: "Link device", isBusy: isBusy) {
                    await link(raw: manualToken)
                }
                .disabled(manualToken.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.green)
            }
        }
        .navigationTitle("Link device")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close") { dismiss() }
            }
        }
    }

    private func handleScan(_ code: String) {
        guard code != scanned else { return }
        scanned = code
        Haptics.send()
        Task { await link(raw: code) }
    }

    private func link(raw: String) async {
        error = nil
        notice = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.authService.linkDevice(rawValue: raw)
            notice = "Device linked. Approve the login there."
            manualToken = ""
            await app.settingsViewModel.loadSessions()
        } catch {
            scanned = ""
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct QRScannerRepresentable: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerController {
        QRScannerController(onCode: onCode)
    }

    func updateUIViewController(_ vc: QRScannerController, context: Context) {}
}

private final class QRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let onCode: (String) -> Void
    private var session: AVCaptureSession?
    private var preview: AVCaptureVideoPreviewLayer?

    init(onCode: @escaping (String) -> Void) {
        self.onCode = onCode
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.clipsToBounds = true
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else { return }
        let session = AVCaptureSession()
        guard session.canAddInput(input) else { return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        self.preview = preview
        self.session = session
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard granted else { return }
            DispatchQueue.main.async { self?.session?.startRunning() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session?.stopRunning()
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection)
    {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue,
              !code.isEmpty else { return }
        onCode(code)
    }
}
