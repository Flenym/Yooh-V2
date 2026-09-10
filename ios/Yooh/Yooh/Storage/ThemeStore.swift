import Foundation
import Observation
import SwiftUI

/// Visual identity store: accent color, chat wallpaper and interface mode.
///
/// Everything here is presentation-only and persists in UserDefaults.
/// Server-backed preferences (notifications/privacy/data) live in
/// `settings.*` and are edited on their own screens.
@Observable
final class ThemeStore {
    static let shared = ThemeStore()

    struct Accent: Identifiable, Hashable {
        let id: String
        let name: String
        let color: Color
    }

    struct Wallpaper: Identifiable, Hashable {
        let id: String
        let name: String
        let top: Color
        let bottom: Color
    }

    static let accents: [Accent] = [
        Accent(id: "pulse", name: "Pulse", color: Color(red: 0.46, green: 0.34, blue: 1.0)),
        Accent(id: "telegram", name: "Sky", color: Color(red: 0.20, green: 0.57, blue: 0.93)),
        Accent(id: "emerald", name: "Emerald", color: Color(red: 0.18, green: 0.83, blue: 0.49)),
        Accent(id: "amber", name: "Amber", color: Color(red: 1.0, green: 0.62, blue: 0.15)),
        Accent(id: "crimson", name: "Crimson", color: Color(red: 1.0, green: 0.30, blue: 0.40)),
    ]

    /// Brand gradient (deep violet family): logo, primary CTAs, active nav.
    static let brandGradient = LinearGradient(
        colors: [Color(red: 0.22, green: 0.23, blue: 0.75),
                 Color(red: 0.18, green: 0.09, blue: 0.58),
                 Color(red: 0.46, green: 0.34, blue: 1.0)],
        startPoint: .bottomLeading,
        endPoint: .topTrailing
    )

    static let wallpapers: [Wallpaper] = [
        Wallpaper(id: "system", name: "System",
                  top: .clear, bottom: .clear),
        Wallpaper(id: "midnight", name: "Midnight Ink",
                  top: Color(red: 0.07, green: 0.07, blue: 0.12),
                  bottom: Color.black),
        Wallpaper(id: "ocean", name: "Deep Ocean",
                  top: Color(red: 0.02, green: 0.12, blue: 0.22),
                  bottom: Color(red: 0.0, green: 0.03, blue: 0.07)),
        Wallpaper(id: "royal", name: "Royal Night",
                  top: Color(red: 0.12, green: 0.05, blue: 0.22),
                  bottom: Color(red: 0.03, green: 0.02, blue: 0.07)),
        Wallpaper(id: "ember", name: "Crimson Dusk",
                  top: Color(red: 0.22, green: 0.06, blue: 0.10),
                  bottom: Color(red: 0.05, green: 0.02, blue: 0.03)),
    ]

    enum Mode: String, CaseIterable {
        case system = "System"
        case dark = "Dark"
        case light = "Light"
    }

    var accentID: String {
        didSet { UserDefaults.standard.set(accentID, forKey: Keys.accent) }
    }

    var wallpaperID: String {
        didSet { UserDefaults.standard.set(wallpaperID, forKey: Keys.wallpaper) }
    }

    var mode: Mode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: Keys.mode) }
    }

    /// Message text scale (0.85…1.3). Multiplies bubble body size on top
    /// of Dynamic Type.
    var fontScale: Double {
        didSet { UserDefaults.standard.set(fontScale, forKey: Keys.fontScale) }
    }

    private init() {
        let d = UserDefaults.standard
        accentID = d.string(forKey: Keys.accent) ?? "pulse"
        wallpaperID = d.string(forKey: Keys.wallpaper) ?? "system"
        mode = Mode(rawValue: d.string(forKey: Keys.mode) ?? "System") ?? .system
        let s = d.double(forKey: Keys.fontScale)
        fontScale = (s >= 0.85 && s <= 1.3) ? s : 1.0
    }

    var accent: Color {
        Self.accents.first(where: { $0.id == accentID })?.color ?? Self.accents[0].color
    }

    var wallpaper: Wallpaper {
        Self.wallpapers.first(where: { $0.id == wallpaperID }) ?? Self.wallpapers[0]
    }

    var colorScheme: ColorScheme? {
        switch mode {
        case .system: return nil
        case .dark: return .dark
        case .light: return .light
        }
    }

    enum Keys {
        static let accent = "yooh.theme.accent"
        static let wallpaper = "yooh.theme.wallpaper"
        static let mode = "yooh.theme.mode"
        static let fontScale = "yooh.theme.fontScale"
    }
}

// MARK: - Hex colors

extension Color {
    /// `#RRGGBB` / `#RRGGBBAA` (also accepts a leading `#` or not).
    init(hex: String, fallback: Color = .gray) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8,
              let v = UInt64(s, radix: 16) else
        {
            self = fallback
            return
        }
        let r, g, b, a: Double
        if s.count == 6 {
            r = Double((v >> 16) & 0xFF) / 255
            g = Double((v >> 8) & 0xFF) / 255
            b = Double(v & 0xFF) / 255
            a = 1
        } else {
            r = Double((v >> 24) & 0xFF) / 255
            g = Double((v >> 16) & 0xFF) / 255
            b = Double((v >> 8) & 0xFF) / 255
            a = Double(v & 0xFF) / 255
        }
        self.init(red: r, green: g, blue: b, opacity: a)
    }
}
