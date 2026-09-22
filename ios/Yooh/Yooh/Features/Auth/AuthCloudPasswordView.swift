import SwiftUI

/// Cloud-password second factor, restyled to the auth flow.
struct AuthCloudPasswordView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var passwordFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AuthBackButton { vm.back() }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            ZStack {
                Circle()
                    .fill(ThemeStore.shared.accent.opacity(0.25))
                    .frame(width: 96, height: 96)
                Image(systemName: "lock.fill")
                    .font(.system(size: 38))
                    .foregroundStyle(.white)
            }
            .padding(.top, 14)
            .padding(.bottom, 20)

            AuthHeader(title: "Облачный пароль",
                       subtitle: "Включена двухэтапная аутентификация. Введите облачный пароль.")
                .padding(.horizontal, 28)
                .padding(.bottom, 26)

            AuthCard {
                SecureField("Облачный пароль", text: $vm.cloudPassword)
                    .font(.system(size: 19))
                    .foregroundStyle(.white)
                    .textContentType(.password)
                    .focused($passwordFocused)
                    .padding(.horizontal, 20)
                    .frame(height: 58)
                    .submitLabel(.go)
                    .onSubmit { Task { await vm.verifyCloudPassword() } }
            }
            .padding(.horizontal, 24)

            if let error = vm.error {
                ErrorBanner(message: error, onDismiss: { vm.clearError() })
                    .padding(.horizontal, 24)
                    .padding(.top, 14)
            }

            Spacer()

            AuthCTAButton(title: "Продолжить",
                          isEnabled: !vm.cloudPassword.isEmpty,
                          isBusy: vm.isBusy) {
                Task { await vm.verifyCloudPassword() }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 34)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { passwordFocused = true }
        }
    }
}
