import SwiftUI

/// Reference 01: brand splash — logo, name, beta pill, «Начать».
struct AuthStartView: View {
    @Bindable var vm: AuthViewModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 60)
            YoohLogoMark(size: 150)
                .padding(.bottom, 26)
            Text("Yooh")
                .font(.system(size: 52, weight: .bold))
                .foregroundStyle(.white)
                .padding(.bottom, 12)
            Text("Вход и регистрация по номеру телефона.")
                .font(.system(size: 17))
                .foregroundStyle(AuthUI.hint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.bottom, 18)
            Text("Beta · Предварительная версия")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AuthUI.hint)
                .padding(.horizontal, 18)
                .padding(.vertical, 9)
                .background(Color.white.opacity(0.08), in: .capsule)
                .overlay {
                    Capsule().stroke(Color.white.opacity(0.10), lineWidth: 1)
                }
            Spacer()
            AuthCTAButton(title: "Начать") {
                withAnimation(.snappy) { vm.started = true }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
            Text("Далее выберите страну и введите номер.")
                .font(.system(size: 14))
                .foregroundStyle(AuthUI.faint)
                .padding(.bottom, 34)
        }
    }
}
