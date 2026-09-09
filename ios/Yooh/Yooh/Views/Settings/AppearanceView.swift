import SwiftUI

/// Appearance: interface mode, accent color and chat wallpaper
/// (presentation-only, stored on-device via ThemeStore).
struct AppearanceView: View {
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        @Bindable var theme = theme
        List {
            Section("Interface") {
                Picker("Appearance", selection: $theme.mode) {
                    ForEach(ThemeStore.Mode.allCases, id: \.self) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.vertical, 4)
            }
            Section("Accent color") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 52))], spacing: 12) {
                    ForEach(ThemeStore.accents) { a in
                        Button {
                            Haptics.selection()
                            theme.accentID = a.id
                        } label: {
                            VStack(spacing: 6) {
                                Circle()
                                    .fill(a.color)
                                    .frame(width: 44, height: 44)
                                    .overlay {
                                        if theme.accentID == a.id {
                                            Circle().stroke(Color.white, lineWidth: 2.5)
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(.white)
                                        }
                                    }
                                Text(a.name)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("\(a.name) accent"))
                    }
                }
                .padding(.vertical, 4)
            }
            Section("Chat wallpaper") {
                ForEach(ThemeStore.wallpapers) { w in
                    Button {
                        Haptics.selection()
                        theme.wallpaperID = w.id
                    } label: {
                        HStack(spacing: YoohTheme.Spacing.m) {
                            if w.id == "system" {
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(Color(.tertiarySystemFill))
                                    .frame(width: 56, height: 56)
                                    .overlay {
                                        Image(systemName: "circle.lefthalf.filled")
                                            .foregroundStyle(.secondary)
                                    }
                            } else {
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(LinearGradient(colors: [w.top, w.bottom],
                                                         startPoint: .top, endPoint: .bottom))
                                    .frame(width: 56, height: 56)
                            }
                            Text(w.name)
                                .font(.system(size: 17))
                                .foregroundStyle(.primary)
                            Spacer()
                            if theme.wallpaperID == w.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(ThemeStore.shared.accent)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("\(w.name) wallpaper"))
                }
            }
            Section {
                Text("Accent recolors badges, send buttons, links and highlights. Wallpaper applies to all conversations.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}
