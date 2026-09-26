import Foundation
import Network
import Observation

/// Network reachability (NWPathMonitor) shared by the connection
/// status pill. Updated on the main actor; views observe it.
@Observable
final class ConnectionMonitor {
    static let shared = ConnectionMonitor()

    private(set) var isAvailable = true

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isAvailable = (path.status == .satisfied)
            }
        }
        monitor.start(queue: DispatchQueue.global(qos: .background))
    }
}
