import SwiftUI

/// Reference 02: country row + masked phone field + «Продолжить».
/// Phone-first: login code is requested, a 404 flips to registration.
struct AuthPhoneView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var phoneFocused: Bool
    @FocusState private var emailFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AuthBackButton { withAnimation(.snappy) { vm.started = false } }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            YoohLogoMark(size: 76)
                .padding(.top, 10)
                .padding(.bottom, 20)

            AuthHeader(title: vm.useEmail ? "Вход по email" : "Ваш номер телефона",
                       subtitle: vm.useEmail ? "Введите адрес, привязанный к аккаунту." : "Выберите страну и введите номер.")
                .padding(.horizontal, 28)
                .padding(.bottom, 26)

            if vm.useEmail {
                emailCard
            } else {
                phoneCard
            }

            Text(vm.useEmail ? "Код придёт на этот адрес." : "На этот номер придёт код подтверждения.")
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

            if vm.suggestRegister {
                registerSuggestion
                    .padding(.horizontal, 24)
                    .padding(.top, 14)
            }

            Spacer()

            AuthCTAButton(title: "Продолжить", isEnabled: vm.canRequestCode, isBusy: vm.isBusy) {
                Task { await vm.requestCode() }
            }
            .padding(.horizontal, 24)

            Button(vm.useEmail ? "Войти по номеру телефона" : "Войти по email") {
                Haptics.selection()
                vm.toggleEmailMode()
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(AuthUI.hint)
            .padding(.top, 14)
            .padding(.bottom, 34)
        }
        .sheet(isPresented: $vm.showCountryPicker) {
            CountryPickerView(selection: $vm.country)
                .onDisappear { vm.phoneDigits = ""; phoneFocused = true }
        }
        .onAppear { phoneFocused = !vm.useEmail }
    }

    // MARK: - Phone card

    private var phoneCard: some View {
        AuthCard {
            Button {
                Haptics.selection()
                vm.showCountryPicker = true
            } label: {
                HStack {
                    Text("Страна")
                        .font(.system(size: 17))
                        .foregroundStyle(.white)
                    Spacer()
                    Text(vm.country.name)
                        .font(.system(size: 17))
                        .foregroundStyle(.white)
                    Text(vm.country.dial)
                        .font(.system(size: 17))
                        .foregroundStyle(AuthUI.hint)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AuthUI.faint)
                }
                .padding(.horizontal, 20)
                .frame(height: 58)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            Divider().background(Color.white.opacity(0.12)).padding(.leading, 20)

            HStack(spacing: 0) {
                Text(vm.country.dial)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.leading, 20)
                    .padding(.trailing, 12)
                Rectangle()
                    .fill(Color.white.opacity(0.14))
                    .frame(width: 1, height: 30)
                    .padding(.trailing, 12)
                TextField("Номер телефона", text: phoneBinding)
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .focused($phoneFocused)
                    .submitLabel(.go)
                    .onSubmit { Task { await vm.requestCode() } }
            }
            .frame(height: 58)
        }
        .padding(.horizontal, 24)
    }

    private var phoneBinding: Binding<String> {
        Binding(
            get: { PhoneFormat.display(national: vm.phoneDigits, country: vm.country) },
            set: { vm.phoneDigits = String(PhoneFormat.digitsOnly($0).prefix(14)) }
        )
    }

    // MARK: - Email card

    private var emailCard: some View {
        AuthCard {
            TextField("Email", text: $vm.email)
                .font(.system(size: 19))
                .foregroundStyle(.white)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .focused($emailFocused)
                .padding(.horizontal, 20)
                .frame(height: 58)
                .submitLabel(.go)
                .onSubmit { Task { await vm.requestCode() } }
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Registration suggestion

    private var registerSuggestion: some View {
        VStack(spacing: 10) {
            Text("Этот номер ещё не зарегистрирован.")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
            AuthCTAButton(title: "Создать аккаунт", isBusy: vm.isBusy) {
                Task { await vm.requestRegisterCode() }
            }
            Button("Изменить номер") {
                Haptics.selection()
                vm.suggestRegister = false
                phoneFocused = true
            }
            .font(.system(size: 14))
            .foregroundStyle(AuthUI.hint)
        }
        .padding(16)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(ThemeStore.shared.accent.opacity(0.4), lineWidth: 1)
        }
    }
}
