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
        /// Primary brand accent (iMessage-like blue, adaptive).
        static let accent = Color.accentColor
        static let incomingBubble = Color(.secondarySystemBackground)
        static let outgoingBubble = Color.accentColor
        static let outgoingText = Color.white
        static let destructive = Color.red
        static let online = Color.green
        static let subtleText = Color.secondary
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
                content.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
            case .interactive:
                content.glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            content
                .background(.ultraThinMaterial, in: .rect(cornerRadius: cornerRadius))
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
