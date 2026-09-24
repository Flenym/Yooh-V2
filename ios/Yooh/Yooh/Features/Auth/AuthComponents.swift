import SwiftUI

/// Shared premium-dark styling for the auth flow (see reference
/// auth-phone-01/02/03): near-black background, violet→blue CTA.
enum AuthUI {
    static let bgTop = Color(red: 0.05, green: 0.06, blue: 0.11)
    static let bgBottom = Color(red: 0.015, green: 0.02, blue: 0.045)
    static let card = Color.white.opacity(0.07)
    static let cardStroke = Color.white.opacity(0.09)
    static let hint = Color.white.opacity(0.55)
    static let faint = Color.white.opacity(0.35)

    static let cta = LinearGradient(
        colors: [Color(red: 0.55, green: 0.36, blue: 1.0),
                 Color(red: 0.17, green: 0.42, blue: 0.95)],
        startPoint: .leading, endPoint: .trailing
    )
    static let ctaDisabled = Color.white.opacity(0.10)
}

/// Ambient dark background with violet/blue glows.
struct AuthBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [AuthUI.bgTop, AuthUI.bgBottom],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            Circle()
                .fill(Color(red: 0.45, green: 0.3, blue: 1.0).opacity(0.16))
                .frame(width: 360, height: 360)
                .blur(radius: 110)
                .offset(x: -150, y: -330)
            Circle()
                .fill(Color(red: 0.15, green: 0.4, blue: 1.0).opacity(0.14))
                .frame(width: 320, height: 320)
                .blur(radius: 110)
                .offset(x: 160, y: 360)
        }
    }
}

/// Yooh brand mark from the YoohLogo asset, with a gradient fallback.
struct YoohLogoMark: View {
    var size: CGFloat = 120

    var body: some View {
        if UIImage(named: "YoohLogo") != nil {
            Image("YoohLogo")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.28)
                    .fill(ThemeStore.brandGradient)
                    .frame(width: size, height: size)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: size * 0.44))
                    .foregroundStyle(.white)
            }
        }
    }
}

/// Big gradient CTA from the reference (полная ширина, 60pt).
struct AuthCTAButton: View {
    let title: String
    var isEnabled: Bool = true
    var isBusy: Bool = false
    var action: () -> Void

    var body: some View {
        Button {
            guard isEnabled, !isBusy else { return }
            Haptics.send()
            action()
        } label: {
            ZStack {
                if isEnabled {
                    AuthUI.cta
                } else {
                    AuthUI.ctaDisabled
                }
                HStack(spacing: 8) {
                    if isBusy { ProgressView().tint(.white) }
                    Text(title)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(isEnabled ? .white : AuthUI.hint)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
        .disabled(!isEnabled || isBusy)
    }
}

/// Grouped card container for auth inputs.
struct AuthCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(AuthUI.card, in: RoundedRectangle(cornerRadius: 26))
        .overlay {
            RoundedRectangle(cornerRadius: 26)
                .stroke(AuthUI.cardStroke, lineWidth: 1)
        }
    }
}

/// Circular glass back button from the reference.
struct AuthBackButton: View {
    var action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(Color.white.opacity(0.08), in: .circle)
                .overlay {
                    Circle().stroke(Color.white.opacity(0.14), lineWidth: 1)
                }
        }
        .accessibilityLabel(Text("Назад"))
    }
}

/// Big centered auth title + subtitle.
struct AuthHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 10) {
            Text(title)
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.system(size: 16))
                .foregroundStyle(AuthUI.hint)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
