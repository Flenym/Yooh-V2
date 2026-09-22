import SwiftUI

/// Reference 03: six OTP boxes, masked phone, resend timer, «Продолжить».
struct AuthCodeView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var codeFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AuthBackButton { vm.backToPhone() }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            YoohLogoMark(size: 76)
                .padding(.top, 10)
                .padding(.bottom, 20)

            AuthHeader(title: "Введите код",
                       subtitle: "Мы ожидаем шестизначный код для \(vm.maskedPhone).")
                .padding(.horizontal, 28)
                .padding(.bottom, 26)

            ZStack {
                TextField("", text: $vm.code)
                    .font(.system(size: 24))
                    .foregroundStyle(.clear)
                    .tint(.clear)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($codeFocused)
                    .opacity(0.01)
                    .onChange(of: vm.code) { _, v in
                        let digits = PhoneFormat.digitsOnly(v)
                        if digits != v { vm.code = String(digits.prefix(6)) }
                        if vm.code.count == AppConfig.otpLength, !vm.isBusy {
                            Task { await vm.verifyCode() }
                        }
                    }
                codeBoxes
                    .allowsHitTesting(false)
            }
            .onTapGesture { codeFocused = true }
            .padding(.horizontal, 24)

            resendRow
                .padding(.top, 20)

            if let error = vm.error {
                ErrorBanner(message: error, onDismiss: { vm.clearError() })
                    .padding(.horizontal, 24)
                    .padding(.top, 14)
            }

            Spacer()

            AuthCTAButton(title: vm.mode == .register ? "Далее" : "Войти",
                          isEnabled: vm.code.count == AppConfig.otpLength,
                          isBusy: vm.isBusy) {
                Task { await vm.verifyCode() }
            }
            .padding(.horizontal, 24)

            Button("Не тот номер? Изменить") {
                Haptics.selection()
                vm.backToPhone()
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(AuthUI.hint)
            .padding(.top, 14)
            .padding(.bottom, 34)
        }
        .onAppear {
            vm.code = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { codeFocused = true }
        }
    }

    // MARK: - Boxes

    private var codeBoxes: some View {
        HStack(spacing: 10) {
            ForEach(0..<AppConfig.otpLength, id: \.self) { i in
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(0.07))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(boxBorder(i), lineWidth: 1.5)
                        }
                    Text(boxDigit(i))
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 60)
            }
        }
    }

    private func boxDigit(_ i: Int) -> String {
        let chars = Array(vm.code)
        guard i < chars.count else { return "" }
        return String(chars[i])
    }

    private func boxBorder(_ i: Int) -> Color {
        if vm.code.count == i, codeFocused { return ThemeStore.shared.accent }
        return Color.white.opacity(0.10)
    }

    // MARK: - Resend

    @ViewBuilder
    private var resendRow: some View {
        if vm.resendInSeconds > 0 {
            Text("Отправить снова через \(vm.resendInSeconds) с")
                .font(.system(size: 15))
                .foregroundStyle(AuthUI.faint)
        } else {
            Button("Отправить код снова") {
                Haptics.selection()
                Task { await vm.resendCode() }
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white)
            .disabled(vm.isBusy)
        }
    }
}
