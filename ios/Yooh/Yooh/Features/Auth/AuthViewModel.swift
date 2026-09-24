import Contacts
import Foundation
import Observation

/// Phone-first auth state machine (Russian UX):
/// start → phone/email → code → (profile for new users) → cloud password.
/// Login code is requested first; a server 404 flips to registration.
@Observable
@MainActor
final class AuthViewModel {
    enum Mode { case login, register }
    enum Step { case identifier, code, profile, cloudPassword }

    var started = false
    var mode: Mode = .login
    var step: Step = .identifier

    var country: Country = .russia
    var phoneDigits = ""
    var useEmail = false
    var email = ""
    var showCountryPicker = false

    var code = ""
    var displayName = ""
    var username = ""
    var cloudPassword = ""

    var resendInSeconds = 0
    var suggestRegister = false
    var isBusy = false
    var error: String?

    private var loginTicket: String?
    private var isEmailLogin = false
    private var resendTask: Task<Void, Never>?

    var app: AppState! = nil

    // MARK: - Derived

    var fullPhone: String {
        PhoneFormat.e164(national: phoneDigits, country: country)
    }

    var maskedPhone: String {
        if useEmail || isEmailLogin { return email.trimmingCharacters(in: .whitespaces) }
        return PhoneFormat.masked(full: fullPhone)
    }

    var canRequestCode: Bool {
        if useEmail { return !email.trimmingCharacters(in: .whitespaces).isEmpty }
        return PhoneFormat.isComplete(national: phoneDigits, country: country)
    }

    var canCompleteRegistration: Bool {
        Validation.validateDisplayName(displayName) && Validation.validateUsername(username)
    }

    // MARK: - Code requests

    func requestCode() async {
        error = nil
        suggestRegister = false
        if useEmail {
            let v = email.trimmingCharacters(in: .whitespaces)
            guard Validation.validateEmail(v) else { error = "Введите корректный email."; return }
            isEmailLogin = true
        } else {
            guard PhoneFormat.isComplete(national: phoneDigits, country: country) else {
                error = country.dialDigits == "7" ? "Введите номер полностью." : "Введите корректный номер."
                return
            }
            isEmailLogin = false
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let res = try await app.authService.requestLoginCode(
                phone: isEmailLogin ? nil : fullPhone,
                email: isEmailLogin ? email.trimmingCharacters(in: .whitespaces) : nil)
            mode = .login
            armCodeStep(res)
        } catch let e as APIError {
            if case .notFound = e, !isEmailLogin {
                suggestRegister = true
            } else {
                self.error = e.errorDescription ?? "Не удалось отправить код."
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func requestRegisterCode() async {
        error = nil
        guard PhoneFormat.isComplete(national: phoneDigits, country: country) else {
            error = "Введите номер полностью."
            return
        }
        isEmailLogin = false
        isBusy = true
        defer { isBusy = false }
        do {
            let res = try await app.authService.requestRegisterCode(phone: fullPhone)
            mode = .register
            suggestRegister = false
            displayName = ""
            username = ""
            armCodeStep(res)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func resendCode() async {
        error = nil
        guard resendInSeconds <= 0 else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            if mode == .register {
                let res = try await app.authService.requestRegisterCode(phone: fullPhone)
                armCodeStep(res)
            } else {
                let res = try await app.authService.requestLoginCode(
                    phone: isEmailLogin ? nil : fullPhone,
                    email: isEmailLogin ? email.trimmingCharacters(in: .whitespaces) : nil)
                armCodeStep(res)
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Verification

    func verifyCode() async {
        error = nil
        guard Validation.validateCode(code) else { error = "Введите 6-значный код."; return }
        isBusy = true
        defer { isBusy = false }
        do {
            if mode == .register {
                step = .profile
                return
            }
            switch try await app.authService.verifyLogin(
                phone: isEmailLogin ? nil : fullPhone,
                email: isEmailLogin ? email.trimmingCharacters(in: .whitespaces) : nil,
                code: code.trimmingCharacters(in: .whitespaces))
            {
            case .session(let token, let user):
                finishLogin(token: token, user: user)
            case .cloudChallenge(let ticket, _):
                loginTicket = ticket
                cloudPassword = ""
                step = .cloudPassword
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func completeRegistration() async {
        error = nil
        guard Validation.validateDisplayName(displayName) else { error = "Введите ваше имя."; return }
        guard Validation.validateUsername(username) else { error = "Username: минимум 5 символов (a–z, 0–9, _)."; return }
        isBusy = true
        defer { isBusy = false }
        do {
            let (token, user) = try await app.authService.verifyRegister(
                phone: fullPhone,
                code: code.trimmingCharacters(in: .whitespaces),
                displayName: displayName.trimmingCharacters(in: .whitespaces),
                username: username.trimmingCharacters(in: .whitespaces))
            finishLogin(token: token, user: user)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func verifyCloudPassword() async {
        error = nil
        guard let ticket = loginTicket, !cloudPassword.isEmpty else {
            error = "Введите облачный пароль."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let (token, user) = try await app.authService.verifyCloudPassword(
                loginTicket: ticket, password: cloudPassword)
            finishLogin(token: token, user: user)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Navigation

    func back() {
        error = nil
        switch step {
        case .identifier: break
        case .code: step = .identifier
        case .profile: step = .code
        case .cloudPassword: step = .code
        }
    }

    func backToPhone() {
        error = nil
        code = ""
        suggestRegister = false
        mode = .login
        step = .identifier
    }

    func toggleEmailMode() {
        error = nil
        suggestRegister = false
        useEmail.toggle()
    }

    func clearError() { error = nil }

    /// DEBUG-only visual-QA hook: `simctl launch … UITEST_PHONE`
    /// jumps straight to a given auth screen. Stripped from Release.
    func applyUITestStep() {
#if DEBUG
        let args = CommandLine.arguments
        if args.contains("UITEST_PHONE") {
            started = true
        } else if args.contains("UITEST_CODE") {
            started = true
            mode = .login
            phoneDigits = "9001234567"
            step = .code
        } else if args.contains("UITEST_PROFILE") {
            started = true
            mode = .register
            phoneDigits = "9001234567"
            code = "123456"
            displayName = "Иван"
            username = "ivan_petrov"
            step = .profile
        } else if args.contains("UITEST_CLOUD") {
            started = true
            mode = .login
            phoneDigits = "9001234567"
            code = "123456"
            step = .cloudPassword
        }
#endif
    }

    // MARK: - Private

    private func armCodeStep(_ res: OTPRequestResponse) {
        code = ""
        step = .code
        // Server TTL is 5 min; allow resend after 60 s (re-issues the code).
        startResendTimer(seconds: min(res.expiresInSeconds ?? 60, 60))
    }

    private func startResendTimer(seconds: Int) {
        resendTask?.cancel()
        resendInSeconds = max(seconds, 0)
        guard resendInSeconds > 0 else { return }
        resendTask = Task { [weak self] in
            while let self, self.resendInSeconds > 0, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                self.resendInSeconds -= 1
            }
        }
    }

    private func finishLogin(token: String, user: YoohUser) {
        resendTask?.cancel()
        resendInSeconds = 0
        app.session.saveSession(token: token, user: user)
        Haptics.send()
        app.startRealtime()
        Task { await app.chatsViewModel.refresh() }
    }
}
