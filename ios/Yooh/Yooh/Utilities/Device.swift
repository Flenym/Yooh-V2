import UIKit

/// Device helpers for auth payloads and UI idiom checks.
enum Device {
    /// Human-readable model name for `device.name` in auth calls.
    static var currentModelName: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(cString: $0)
            }
        }
        // Keep the raw identifier ("iPhone17,2"); friendly mapping is a
        // nice-to-have the server never depends on.
        if machine == "arm64" { return "iPhone (Simulator)" }
        return machine.isEmpty ? "iPhone" : machine
    }

    static var systemVersion: String {
        UIDevice.current.systemVersion
    }
}
