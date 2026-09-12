import Contacts
import Foundation
import Observation

/// Login / register OTP state machine. Login accepts phone OR email;
/// register is phone-only; cloud-password 2FA may follow the code step.
@Observable
@MainActor
final class AuthViewModel {
    enum Mode { case login, register }
    enum Step { case identifier, code, cloudPassword }

    var mode: Mode = .login
    var step: Step = .identifier

    var identifier = ""
    var phone = ""
    var code = ""
    var displayName = ""
    var username = ""
    var cloudPassword = ""

    var expiresInSeconds: Int?
    var maskedTarget: String?
    var isBusy = false
    var error: String?

    private var loginTicket: String?
    private var isEmailLogin = false

    var app: AppState! = nil

    var activeIdentifier: String {
        mode == .login ? identifier : phone
    }

    func requestCode() async {
        error = nil
        if mode == .login {
            let id = identifier.trimmingCharacters(in: .whitespaces)
            guard !id.isEmpty else { error = "Enter your phone number or email."; return }
            if id.contains("@") {
                guard Validation.validateEmail(id) else { error = "Invalid email address."; return }
                isEmailLogin = true
            } else {
                guard Validation.normalizePhone(id) != nil else { error = "Invalid phone number."; return }
                isEmailLogin = false
            }
        } else {
            guard Validation.normalizePhone(phone) != nil else { error = "Invalid phone number."; return }
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let res: OTPRequestResponse
            if mode == .login {
                res = try await app.authService.requestLoginCode(
                    phone: isEmailLogin ? nil : identifier.trimmingCharacters(in: .whitespaces),
                    email: isEmailLogin ? identifier.trimmingCharacters(in: .whitespaces) : nil)
            } else {
                res = try await app.authService.requestRegisterCode(phone: phone.trimmingCharacters(in: .whitespaces))
            }
            expiresInSeconds = res.expiresInSeconds
            maskedTarget = res.maskedTarget ?? res.target ?? res.phone
            code = ""
            step = .code
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func verifyCode() async {
        error = nil
        guard Validation.validateCode(code) else { error = "Enter the 6-digit code."; return }
        if mode == .register {
            guard Validation.validateDisplayName(displayName) else { error = "Enter your name."; return }
            guard Validation.validateUsername(username) else { error = "Username: 5–32 letters, digits or _."; return }
        }
        isBusy = true
        defer { isBusy = false }
        do {
            if mode == .login {
                let id = identifier.trimmingCharacters(in: .whitespaces)
                switch try await app.authService.verifyLogin(
                    phone: isEmailLogin ? nil : id,
                    email: isEmailLogin ? id : nil,
                    code: code.trimmingCharacters(in: .whitespaces))
                {
                case .session(let token, let user):
                    finishLogin(token: token, user: user)
                case .cloudChallenge(let ticket, _):
                    loginTicket = ticket
                    cloudPassword = ""
                    step = .cloudPassword
                }
            } else {
                let (token, user) = try await app.authService.verifyRegister(
                    phone: phone.trimmingCharacters(in: .whitespaces),
                    code: code.trimmingCharacters(in: .whitespaces),
                    displayName: displayName.trimmingCharacters(in: .whitespaces),
                    username: username.trimmingCharacters(in: .whitespaces))
                finishLogin(token: token, user: user)
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func verifyCloudPassword() async {
        error = nil
        guard let ticket = loginTicket, !cloudPassword.isEmpty else {
            error = "Enter your cloud password."
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

    func back() {
        error = nil
        switch step {
        case .identifier: break
        case .code: step = .identifier
        case .cloudPassword: step = .code
        }
    }

    func switchMode(_ mode: Mode) {
        self.mode = mode
        step = .identifier
        error = nil
        code = ""
    }

    func clearError() { error = nil }

    private func finishLogin(token: String, user: YoohUser) {
        app.session.saveSession(token: token, user: user)
        Haptics.send()
        app.startRealtime()
        Task { await app.chatsViewModel.refresh() }
    }
}
