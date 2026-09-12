import SwiftUI

/// Sign-in / sign-up: identifier → OTP code → cloud password.
/// Register is phone-only; login accepts phone OR email (server truth).
struct AuthView: View {
    @Environment(AppState.self) private var app
    @State private var vm = AuthViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(colors: [Color(red: 0.08, green: 0.06, blue: 0.16),
                                        Color(red: 0.03, green: 0.03, blue: 0.06)],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                Circle()
                    .fill(ThemeStore.shared.accent.opacity(0.16))
                    .frame(width: 340, height: 340)
                    .blur(radius: 100)
                    .offset(x: -140, y: -320)
                Circle()
                    .fill(Color.purple.opacity(0.12))
                    .frame(width: 300, height: 300)
                    .blur(radius: 100)
                    .offset(x: 150, y: 340)
                ScrollView {
                    VStack(spacing: YoohTheme.Spacing.l) {
                        brandHeader
                        authCard
                        Text("API: \(AppConfig.apiURLString)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(YoohTheme.Spacing.xl)
                }
            }
            .navigationBarHidden(true)
        }
        .onAppear { vm.app = app }
    }

    private var brandHeader: some View {
        VStack(spacing: YoohTheme.Spacing.s) {
            ZStack {
                RoundedRectangle(cornerRadius: 28)
                    .fill(ThemeStore.brandGradient)
                    .frame(width: 96, height: 96)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.white)
            }
            Text("Yooh")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(.white)
            Text("Fast, native messaging")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, YoohTheme.Spacing.xxl)
        .accessibilityElement(children: .combine)
    }

    private var authCard: some View {
        @Bindable var vm = vm
        return VStack(spacing: YoohTheme.Spacing.m) {
            Picker("Mode", selection: $vm.mode) {
                Text("Log in").tag(AuthViewModel.Mode.login)
                Text("Sign up").tag(AuthViewModel.Mode.register)
            }
            .pickerStyle(.segmented)
            .onChange(of: vm.mode) { _, m in vm.switchMode(m) }

            switch vm.step {
            case .identifier:
                identifierStep
            case .code:
                codeStep
            case .cloudPassword:
                cloudPasswordStep
            }

            if let error = vm.error {
                ErrorBanner(message: error, onDismiss: { vm.clearError() })
            }
            Text("Server authentication · live backend")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(YoohTheme.Spacing.xl)
        .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 28))
        .overlay {
            RoundedRectangle(cornerRadius: 28)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        }
    }

    private var identifierStep: some View {
        @Bindable var vm = vm
        return VStack(spacing: YoohTheme.Spacing.m) {
            if vm.mode == .login {
                darkField("Phone or email", text: $vm.identifier)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            } else {
                darkField("Phone number", text: $vm.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            }
            primaryButton(title: "Send code", isBusy: vm.isBusy) {
                await vm.requestCode()
            }
            Text("You'll receive a 6-digit code.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var codeStep: some View {
        @Bindable var vm = vm
        return VStack(spacing: YoohTheme.Spacing.m) {
            if let target = vm.maskedTarget {
                Text("Code sent to \(target)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            darkField("6-digit code", text: $vm.code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
            if vm.mode == .register {
                darkField("Your name", text: $vm.displayName)
                    .textContentType(.name)
                darkField("username (5–32, a–z 0–9 _)", text: $vm.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            }
            primaryButton(title: vm.mode == .login ? "Log in" : "Create account", isBusy: vm.isBusy) {
                await vm.verifyCode()
            }
            Button("Back") { vm.back() }
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var cloudPasswordStep: some View {
        @Bindable var vm = vm
        return VStack(spacing: YoohTheme.Spacing.m) {
            Text("Two-step verification enabled. Enter your cloud password.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            SecureField("Cloud password", text: $vm.cloudPassword)
                .padding(.horizontal, YoohTheme.Spacing.m)
                .frame(height: 50)
                .background(Color.black.opacity(0.45), in: .rect(cornerRadius: 14))
                .foregroundStyle(.white)
            primaryButton(title: "Continue", isBusy: vm.isBusy) {
                await vm.verifyCloudPassword()
            }
            Button("Back") { vm.back() }
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func darkField(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .padding(.horizontal, YoohTheme.Spacing.m)
            .frame(height: 50)
            .background(Color.black.opacity(0.45), in: .rect(cornerRadius: 14))
            .foregroundStyle(.white)
    }

    private func primaryButton(title: String, isBusy: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            guard !isBusy else { return }
            Task { await action() }
        } label: {
            HStack {
                Spacer()
                if isBusy { ProgressView().tint(.white) }
                Text(title).bold().foregroundStyle(.white)
                Spacer()
            }
            .frame(height: 52)
            .background(ThemeStore.shared.accent, in: .capsule)
        }
        .disabled(isBusy)
    }
}
