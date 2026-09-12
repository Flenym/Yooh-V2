import UIKit

enum Device {
    static var currentModelName: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(cString: $0)
            }
        }
        if machine == "arm64" { return "iPhone (Simulator)" }
        return machine.isEmpty ? "iPhone" : machine
    }

    static var systemVersion: String {
        UIDevice.current.systemVersion
    }
}
