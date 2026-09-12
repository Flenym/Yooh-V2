import SwiftUI

/// Design tokens: spacing, radii, adaptive messenger palette, Liquid Glass.
///
/// Glass policy (matches the product rule): system glass only on
/// navigation chrome, floating controls, sheets and menus — never on
/// bubble bodies, rows or reading surfaces.
enum YoohTheme {
    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 28
    }

    enum Radius {
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 22
        static let pill: CGFloat = 999
    }

    enum Layout {
        static let minTouch: CGFloat = 44
        static let avatarS: CGFloat = 32
        static let avatarM: CGFloat = 48
        static let avatarL: CGFloat = 72
        static let avatarXL: CGFloat = 96
        static let maxBubbleWidth: CGFloat = 520
    }

    enum TG {
        private static func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {
            Color(UIColor { traits in
                traits.userInterfaceStyle == .dark ? dark : light
            })
        }

        static let background = dynamic(.white, UIColor(red: 0.035, green: 0.035, blue: 0.08, alpha: 1))
        static let card = Color(.secondarySystemBackground)
        static let field = dynamic(
            UIColor(red: 0.94, green: 0.94, blue: 0.96, alpha: 1),
            UIColor(red: 0.13, green: 0.13, blue: 0.15, alpha: 1)
        )
        static let incoming = dynamic(
            .white,
            UIColor(red: 0.13, green: 0.13, blue: 0.15, alpha: 1)
        )
        static let outgoing = dynamic(
            UIColor(red: 0.87, green: 0.97, blue: 0.80, alpha: 1),
            UIColor(red: 0.10, green: 0.10, blue: 0.11, alpha: 1)
        )
        static let outgoingBorder = dynamic(
            UIColor(white: 0, alpha: 0.06),
            UIColor(white: 1, alpha: 0.10)
        )

        static var badge: Color { ThemeStore.shared.accent }
        static let badgeMuted = Color(.systemGray)
        static let checksRead = Color(red: 0.35, green: 0.78, blue: 0.35)
        static let checksSent = Color.secondary
        static let presence = Color(red: 0.30, green: 0.75, blue: 0.30)
        static let dayChip = dynamic(
            UIColor(red: 0.90, green: 0.90, blue: 0.93, alpha: 1),
            UIColor(red: 0.16, green: 0.16, blue: 0.18, alpha: 1)
        )

        static var wallpaperTop: Color {
            let w = ThemeStore.shared.wallpaper
            if w.id == "system" {
                return dynamic(
                    UIColor(red: 0.93, green: 0.92, blue: 0.88, alpha: 1),
                    UIColor(red: 0.07, green: 0.07, blue: 0.12, alpha: 1)
                )
            }
            return w.top
        }

        static var wallpaperBottom: Color {
            let w = ThemeStore.shared.wallpaper
            if w.id == "system" {
                return dynamic(
                    UIColor(red: 0.85, green: 0.87, blue: 0.84, alpha: 1),
                    UIColor.black
                )
            }
            return w.bottom
        }

        static func senderColor(for userId: String) -> Color {
            let palette: [Color] = [.red, .orange, .yellow, .green, .teal, .blue, .purple, .pink]
            return palette[abs(userId.hashValue) % palette.count]
        }
    }
}

/// Native Liquid Glass surface (iOS 26+) with ultraThinMaterial fallback.
struct YoohGlass: ViewModifier {
    enum Style { case regular, interactive }

    var style: Style = .regular
    var cornerRadius: CGFloat = YoohTheme.Radius.xl

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            let tint = ThemeStore.shared.accent.opacity(style == .interactive ? 0.10 : 0.06)
            switch style {
            case .regular:
                content.glassEffect(.regular.tint(tint), in: RoundedRectangle(cornerRadius: cornerRadius))
            case .interactive:
                content.glassEffect(.regular.tint(tint).interactive(), in: RoundedRectangle(cornerRadius: cornerRadius))
            }
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(.white.opacity(0.10), lineWidth: 0.7)
                }
        }
    }
}

extension View {
    func yoohGlass(_ style: YoohGlass.Style = .regular, cornerRadius: CGFloat = YoohTheme.Radius.xl) -> some View {
        modifier(YoohGlass(style: style, cornerRadius: cornerRadius))
    }

    @ViewBuilder
    func yoohIf<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition { transform(self) } else { self }
    }
}
