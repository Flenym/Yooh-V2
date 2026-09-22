import SwiftUI

/// Registration profile: name + username with a live initials avatar.
struct AuthProfileSetupView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var nameFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AuthBackButton { vm.back() }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            initialsAvatar
                .padding(.top, 14)
                .padding(.bottom, 20)

            AuthHeader(title: "Как вас зовут?",
                       subtitle: "Введите имя и придумайте username — его будут видеть другие пользователи.")
                .padding(.horizontal, 28)
                .padding(.bottom, 26)

            AuthCard {
                TextField("Имя", text: $vm.displayName)
                    .font(.system(size: 19))
                    .foregroundStyle(.white)
                    .textContentType(.name)
                    .focused($nameFocused)
                    .padding(.horizontal, 20)
                    .frame(height: 58)
                    .submitLabel(.next)
                Divider().background(Color.white.opacity(0.12)).padding(.leading, 20)
                HStack(spacing: 2) {
                    Text("@")
                        .font(.system(size: 19))
                        .foregroundStyle(AuthUI.faint)
                        .padding(.leading, 20)
                    TextField("username", text: $vm.username)
                        .font(.system(size: 19))
                        .foregroundStyle(.white)
                        .keyboardType(.asciiCapable)
                        .textContentType(.username)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .submitLabel(.go)
                        .onSubmit { Task { await vm.completeRegistration() } }
                }
                .frame(height: 58)
            }
            .padding(.horizontal, 24)

            Text("Минимум 5 символов: латинские буквы, цифры и подчёркивание.")
                .font(.system(size: 14))
                .foregroundStyle(AuthUI.faint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.top, 16)

            if let error = vm.error {
                ErrorBanner(message: error, onDismiss: { vm.clearError() })
                    .padding(.horizontal, 24)
                    .padding(.top, 14)
            }

            Spacer()

            AuthCTAButton(title: "Начать общение", isEnabled: vm.canCompleteRegistration, isBusy: vm.isBusy) {
                Task { await vm.completeRegistration() }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 34)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { nameFocused = true }
        }
    }

    private var initialsAvatar: some View {
        ZStack {
            Circle()
                .fill(ThemeStore.brandGradient)
                .frame(width: 96, height: 96)
            Text(initials)
                .font(.system(size: 36, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var initials: String {
        let parts = vm.displayName.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }.map { String($0) }
        return letters.joined().uppercased()
    }
}
