import SwiftUI

/// Auth flow container: start → phone → code → profile/cloud password.
/// Dark premium styling, fully Russian, Yooh branding.
struct AuthView: View {
    @Environment(AppState.self) private var app
    @State private var vm = AuthViewModel()

    var body: some View {
        ZStack {
            AuthBackground()
            Group {
                if !vm.started {
                    AuthStartView(vm: vm)
                } else {
                    switch vm.step {
                    case .identifier:
                        AuthPhoneView(vm: vm)
                    case .code:
                        AuthCodeView(vm: vm)
                    case .profile:
                        AuthProfileSetupView(vm: vm)
                    case .cloudPassword:
                        AuthCloudPasswordView(vm: vm)
                    }
                }
            }
            .transition(.opacity.combined(with: .move(edge: .trailing)))
        }
        .animation(.snappy, value: vm.started)
        .animation(.snappy, value: vm.stepHash)
        .onAppear { vm.app = app }
    }
}

private extension AuthViewModel {
    var stepHash: String { "\(started)-\(step)-\(mode)-\(useEmail)" }
}
