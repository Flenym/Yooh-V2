import SwiftUI

struct AppearanceView: View {
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        @Bindable var theme = theme
        List {
            Section("Интерфейс") {
                Picker("Оформление", selection: $theme.mode) {
                    ForEach(ThemeStore.Mode.allCases, id: \.self) { m in
                        Text(m.title).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.vertical, 4)
            }
            Section("Цвет акцента") {
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
                        .accessibilityLabel(Text("Акцент \(a.name)"))
                    }
                }
                .padding(.vertical, 4)
            }
            Section("Обои чата") {
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
                    .accessibilityLabel(Text("Обои \(w.name)"))
                }
            }
            Section("Размер текста") {
                HStack {
                    Text("A").font(.system(size: 14))
                    Slider(value: $theme.fontScale, in: 0.85...1.3, step: 0.05)
                    Text("A").font(.system(size: 22, weight: .bold))
                }
                Text("Съешь же ещё этих мягких французских булок")
                    .font(.system(size: 17 * theme.fontScale))
                    .padding(.vertical, 4)
            }
            Section {
                Text("Акцент перекрашивает бейджи, кнопки отправки, ссылки и подсветку. Обои применяются ко всем чатам.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Оформление")
        .navigationBarTitleDisplayMode(.inline)
    }
}
