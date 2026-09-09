import SwiftUI

/// Single source of truth for spacing, radii, typography and glass usage.
///
/// Rules (Apple HIG + project spec):
/// - System semantic colors first; brand accents sparingly.
/// - Liquid Glass ONLY via `YoohGlass` helpers on interactive/system surfaces
///   (tab bar is native, nav bars are native, floating composer/controls).
/// - Never blanket-blur whole screens.
enum YoohTheme {
    // MARK: - Spacing

    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 28
    }

    // MARK: - Radius

    enum Radius {
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 22
        static let pill: CGFloat = 999
    }

    // MARK: - Colors

    enum Colors {
        /// Primary brand accent — follows the theme accent (Settings → Appearance).
        /// Read inside view bodies so accent changes refresh the UI.
        static var accent: Color { ThemeStore.shared.accent }
        static let incomingBubble = Color(.secondarySystemBackground)
        static var outgoingBubble: Color { ThemeStore.shared.accent }
        static let outgoingText = Color.white
        static let destructive = Color.red
        static let online = Color.green
        static let subtleText = Color.secondary
    }

    // MARK: - Messenger palette (Telegram-style density, original values)
    //
    // Adaptive pairs: dark values follow the reference glass-black style,
    // light values follow classic messenger light themes. No third-party
    // artwork is used anywhere — icons are SF Symbols, colors are our own.

    enum TG {
        private static func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {
            Color(UIColor { traits in
                traits.userInterfaceStyle == .dark ? dark : light
            })
        }

        /// App/chat-list background: pure black (dark) / white (light).
        static let background = dynamic(.white, .black)
        /// Grouped cards (settings, menus): system grays.
        static let card = Color(.secondarySystemBackground)
        /// Search fields, folder chips, composer field.
        static let field = dynamic(
            UIColor(red: 0.94, green: 0.94, blue: 0.96, alpha: 1),
            UIColor(red: 0.13, green: 0.13, blue: 0.15, alpha: 1)
        )
        /// Incoming bubble.
        static let incoming = dynamic(
            .white,
            UIColor(red: 0.13, green: 0.13, blue: 0.15, alpha: 1)
        )
        /// Outgoing bubble (Telegram-green family).
        static let outgoing = dynamic(
            UIColor(red: 0.87, green: 0.97, blue: 0.80, alpha: 1),
            UIColor(red: 0.10, green: 0.10, blue: 0.11, alpha: 1)
        )
        static let outgoingBorder = dynamic(
            UIColor(white: 0, alpha: 0.06),
            UIColor(white: 1, alpha: 0.10)
        )
        /// Unread badge / links / active states — the theme accent.
        static var badge: Color { ThemeStore.shared.accent }
        /// Muted badge.
        static let badgeMuted = Color(.systemGray)
        /// Read checkmarks on outgoing messages.
        static let checksRead = Color(red: 0.35, green: 0.78, blue: 0.35)
        static let checksSent = Color.secondary
        /// Online presence.
        static let presence = Color(red: 0.30, green: 0.75, blue: 0.30)
        /// Day separator chip.
        static let dayChip = dynamic(
            UIColor(red: 0.90, green: 0.90, blue: 0.93, alpha: 1),
            UIColor(red: 0.16, green: 0.16, blue: 0.18, alpha: 1)
        )
        /// Chat wallpaper: theme choice, or the adaptive default.
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

        /// Sender-name colors for group chats (hash-picked, like classic messengers).
        static func senderColor(for userId: String) -> Color {
            let palette: [Color] = [
                .red, .orange, .yellow, .green, .teal, .blue, .purple, .pink,
            ]
            return palette[abs(userId.hashValue) % palette.count]
        }
    }

    // MARK: - Typography (Dynamic Type friendly, relative styles only)

    enum Fonts {
        static let chatTitle = Font.headline
        static let chatPreview = Font.subheadline
        static let timestamp = Font.caption
        static let message = Font.body
        static let sectionHeader = Font.footnote
    }

    // MARK: - Layout

    enum Layout {
        /// Minimum touch target (HIG 44pt).
        static let minTouch: CGFloat = 44
        static let avatarS: CGFloat = 32
        static let avatarM: CGFloat = 48
        static let avatarL: CGFloat = 72
        static let avatarXL: CGFloat = 96
        static let maxBubbleWidth: CGFloat = 520
        static let composerMaxHeight: CGFloat = 140
    }
}

// MARK: - Liquid Glass helpers

/// Applies native Liquid Glass where available (iOS 26+), with a graceful
/// `.ultraThinMaterial` fallback on older systems.
///
/// Use for: floating composer, floating action buttons, sheets' grabbers'
/// siblings, context toolbars, viewer overlays — never for full screens.
struct YoohGlass: ViewModifier {
    enum Style {
        case regular
        case interactive
    }

    var style: Style = .regular
    var cornerRadius: CGFloat = YoohTheme.Radius.xl

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            switch style {
            case .regular:
                content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius))
            case .interactive:
                content.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: cornerRadius))
            }
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
        }
    }
}

extension View {
    /// Native Liquid Glass surface with automatic fallback.
    func yoohGlass(_ style: YoohGlass.Style = .regular, cornerRadius: CGFloat = YoohTheme.Radius.xl) -> some View {
        modifier(YoohGlass(style: style, cornerRadius: cornerRadius))
    }

    /// Applies `transform` only when `condition` holds (keeps call sites flat).
    @ViewBuilder
    func yoohIf<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition { transform(self) } else { self }
    }
}
