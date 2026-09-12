import Foundation

/// OTP authentication flows (authService.js): register is phone-only,
/// login accepts phone XOR email, optional cloud-password second factor.
final class AuthService {
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func requestRegisterCode(phone: String) async throws -> OTPRequestResponse {
        try await api.send(.registerRequestCode(phone: phone))
    }

    func verifyRegister(phone: String, code: String, displayName: String, username: String) async throws -> (token: String, user: YoohUser) {
        let res: VerifyCodeResponse = try await api.send(
            .registerVerify(phone: phone, code: code, displayName: displayName,
                             username: username.lowercased(), device: DeviceInfo.current()))
        guard let token = res.token, let user = res.user else {
            throw APIError.validation(message: "Unexpected registration response.")
        }
        return (token, user)
    }

    func requestLoginCode(phone: String?, email: String?) async throws -> OTPRequestResponse {
        try await api.send(.loginRequestCode(phone: phone, email: email))
    }

    enum VerifyResult {
        case session(token: String, user: YoohUser)
        case cloudChallenge(ticket: String, preview: ChallengePreview)
    }

    struct ChallengePreview: Decodable {
        let id: String?
        let username: String?
        let displayName: String?
    }

    func verifyLogin(phone: String?, email: String?, code: String) async throws -> VerifyResult {
        struct RawVerify: Decodable {
            let token: String?
            let user: YoohUser?
            let requiresCloudPassword: Bool?
            let loginTicket: String?
            let preview: ChallengePreview?
            enum CodingKeys: String, CodingKey {
                case token, user, requiresCloudPassword, loginTicket
            }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                token = try c.decodeIfPresent(String.self, forKey: .token)
                user = try? c.decode(YoohUser.self, forKey: .user)
                requiresCloudPassword = try c.decodeIfPresent(Bool.self, forKey: .requiresCloudPassword)
                loginTicket = try c.decodeIfPresent(String.self, forKey: .loginTicket)
                preview = try? c.decode(ChallengePreview.self, forKey: .user)
            }
        }
        let res: RawVerify = try await api.send(
            .loginVerify(phone: phone, email: email, code: code, device: DeviceInfo.current()))
        if let token = res.token, let user = res.user {
            return .session(token: token, user: user)
        }
        if res.requiresCloudPassword == true, let ticket = res.loginTicket {
            return .cloudChallenge(ticket: ticket, preview: res.preview ?? ChallengePreview(id: nil, username: nil, displayName: nil))
        }
        throw APIError.validation(message: "Unexpected login response.")
    }

    func verifyCloudPassword(loginTicket: String, password: String) async throws -> (token: String, user: YoohUser) {
        let res: VerifyCodeResponse = try await api.send(.loginVerifyCloudPassword(loginTicket: loginTicket, password: password))
        guard let token = res.token, let user = res.user else {
            throw APIError.validation(message: "Unexpected login response.")
        }
        return (token, user)
    }

    @discardableResult
    func setCloudPassword(_ password: String?) async throws -> Bool {
        struct Res: Decodable { let enabled: Bool? }
        let res: Res = try await api.send(.setCloudPassword(password))
        return res.enabled ?? (password != nil)
    }

    func sessions() async throws -> (current: AuthSession?, others: [AuthSession]) {
        let res: AuthSessionsResponse = try await api.send(.sessions)
        return (res.sessions.current, res.sessions.others ?? [])
    }

    func renameCurrentSession(_ name: String) async throws {
        struct Res: Decodable { let session: AuthSession? }
        let _: Res = try await api.send(.renameCurrentSession(name))
    }

    @discardableResult
    func terminateOtherSessions() async throws -> Int {
        struct Res: Decodable { let removed: Int? }
        let res: Res = try await api.send(.terminateOtherSessions)
        return res.removed ?? 0
    }

    func deleteSession(_ id: String) async throws {
        struct Res: Decodable { let removed: Bool? }
        let _: Res = try await api.send(.deleteSession(id))
    }

    static func extractQRLoginToken(_ raw: String) -> String? {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return nil }
        if let url = URL(string: v),
           let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let t = items.first(where: { $0.name == "yooh_qr_login" })?.value,
           !t.isEmpty
        {
            return t
        }
        if v.count >= 16, v.count <= 200, v.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
            return v
        }
        return nil
    }

    func linkDevice(rawValue: String) async throws {
        guard let token = Self.extractQRLoginToken(rawValue) else {
            throw APIError.validation(message: "This QR code is not a Yooh login code.")
        }
        struct Res: Decodable { let linked: Bool? }
        let _: Res = try await api.send(.linkDevice(token: token))
    }

    struct QRStatus: Decodable {
        let status: String?
        let token: String?
        let user: YoohUser?
        let expiresAt: String?
    }

    func createQRToken() async throws -> (token: String, expiresAt: String?) {
        struct Res: Decodable {
            let token: String?
            let expiresAt: String?
        }
        let res: Res = try await api.send(.qrCreate())
        guard let token = res.token else {
            throw APIError.validation(message: "Couldn't create a QR code.")
        }
        return (token, res.expiresAt)
    }

    func qrStatus(token: String) async throws -> QRStatus {
        try await api.send(.qrStatus(token: token))
    }

    struct StarsTransferResult: Decodable {
        let sent: Int?
        let balance: Int?
    }

    @discardableResult
    func transferStars(target: String, amount: Int) async throws -> StarsTransferResult {
        try await api.send(.transferStars(target: target, amount: amount))
    }

    func deleteAccount(password: String?) async throws {
        struct Res: Decodable { let deleted: Bool? }
        let _: Res = try await api.send(.deleteAccount(password: password))
    }
}
