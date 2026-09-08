import SwiftUI

/// Sign-in / sign-up flow: identifier → OTP code → cloud password.
///
/// Matches the server: register is phone-only; login accepts phone OR email;
/// a cloud-password challenge may follow the code step (2FA).
struct AuthRootView: View {
    @Environment(AppState.self) private var app
    @State private var vm: AuthViewModel?

    var body: some View {
        Group {
            if let vm {
                content(vm)
            } else {
                ProgressView()
                    .onAppear { vm = AuthViewModel(app: app) }
            }
        }
    }

    @ViewBuilder
    private func content(_ vm: AuthViewModel) -> some View {
        @Bindable var vm = vm
        NavigationStack {
            ScrollView {
                VStack(spacing: YoohTheme.Spacing.xl) {
                    header

                    Picker("Mode", selection: $vm.mode) {
                        Text("Log in").tag(AuthViewModel.Mode.login)
                        Text("Sign up").tag(AuthViewModel.Mode.register)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: vm.mode) { _, m in vm.switchMode(m) }

                    switch vm.step {
                    case .identifier:
                        identifierStep(vm)
                    case .code:
                        codeStep(vm)
                    case .cloudPassword:
                        cloudPasswordStep(vm)
                    }

                    if let error = vm.error {
                        ErrorBanner(message: error, onDismiss: { vm.clearError() })
                            .padding(.horizontal, -YoohTheme.Spacing.l)
                    }
                }
                .padding(YoohTheme.Spacing.xl)
            }
            .navigationTitle("Yooh")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var header: some View {
        VStack(spacing: YoohTheme.Spacing.s) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.accentColor)
            Text("Welcome to Yooh")
                .font(.title2.bold())
        }
        .padding(.top, YoohTheme.Spacing.xxl)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func identifierStep(_ vm: AuthViewModel) -> some View {
        @Bindable var vm = vm
        VStack(spacing: YoohTheme.Spacing.m) {
            if vm.mode == .login {
                TextField("Phone or email", text: $vm.identifier)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            } else {
                TextField("Phone number", text: $vm.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            }
            AsyncButton(title: "Send code", isBusy: vm.isBusy) {
                await vm.requestCode()
            }
            Text("You'll receive a 6-digit code.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder
    private func codeStep(_ vm: AuthViewModel) -> some View {
        @Bindable var vm = vm
        VStack(spacing: YoohTheme.Spacing.m) {
            if let target = vm.maskedTarget {
                Text("Code sent to \(target)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            TextField("6-digit code", text: $vm.code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
            if vm.mode == .register {
                TextField("Your name", text: $vm.displayName)
                    .textContentType(.name)
                TextField("username (5–32, a–z 0–9 _)", text: $vm.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            }
            AsyncButton(title: vm.mode == .login ? "Log in" : "Create account", isBusy: vm.isBusy) {
                await vm.verifyCode()
            }
            Button("Back") { vm.back() }
                .font(.footnote)
        }
        .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder
    private func cloudPasswordStep(_ vm: AuthViewModel) -> some View {
        @Bindable var vm = vm
        VStack(spacing: YoohTheme.Spacing.m) {
            Text("Two-step verification enabled. Enter your cloud password.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            SecureField("Cloud password", text: $vm.cloudPassword)
            AsyncButton(title: "Continue", isBusy: vm.isBusy) {
                await vm.verifyCloudPassword()
            }
            Button("Back") { vm.back() }
                .font(.footnote)
        }
        .textFieldStyle(.roundedBorder)
    }
}

/// Button that runs an async action with a spinner and double-tap guard.
struct AsyncButton: View {
    let title: String
    var isBusy: Bool
    var action: () async -> Void

    var body: some View {
        Button {
            guard !isBusy else { return }
            Task { await action() }
        } label: {
            HStack {
                Spacer()
                if isBusy { ProgressView().tint(.white) }
                Text(title).bold()
                Spacer()
            }
            .frame(minHeight: YoohTheme.Layout.minTouch)
        }
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}
