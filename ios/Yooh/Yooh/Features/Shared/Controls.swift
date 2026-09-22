import SwiftUI
import Translation

/// Floating circular action button (SF Symbols only, glass surface).
struct GlassIconButton: View {
    let symbol: String
    var accessibility: String
    var size: CGFloat = YoohTheme.Layout.minTouch
    var filled: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: {
            Haptics.selection()
            action()
        }) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(filled ? .white : .primary)
                .frame(width: size, height: size)
                .background(filled ? AnyShapeStyle(ThemeStore.shared.accent) : AnyShapeStyle(Color.clear))
                .clipShape(Circle())
        }
        .yoohIf(!filled) { $0.yoohGlass(.interactive, cornerRadius: size / 2) }
        .accessibilityLabel(Text(accessibility))
    }
}

/// Empty state: SF Symbol + title + subtitle.
struct EmptyStateView: View {
    let symbol: String
    let title: String
    let subtitle: String?

    init(symbol: String, title: String, subtitle: String? = nil) {
        self.symbol = symbol
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(spacing: YoohTheme.Spacing.m) {
            Image(systemName: symbol)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding()
        .accessibilityElement(children: .combine)
    }
}

/// Inline error banner with retry/dismiss.
struct ErrorBanner: View {
    let message: String
    var onRetry: (() -> Void)? = nil
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.primary)
            Spacer()
            if let onRetry {
                Button("Повторить", action: onRetry)
                    .font(.footnote.bold())
            }
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel(Text("Закрыть ошибку"))
            }
        }
        .padding(YoohTheme.Spacing.s)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: YoohTheme.Radius.m))
        .padding(.horizontal, YoohTheme.Spacing.l)
    }
}

/// Inline success/notice banner.
struct NoticeBanner: View {
    let message: String
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: YoohTheme.Spacing.s) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.primary)
            Spacer()
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel(Text("Закрыть уведомление"))
            }
        }
        .padding(YoohTheme.Spacing.s)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: YoohTheme.Radius.m))
        .padding(.horizontal, YoohTheme.Spacing.l)
    }
}

/// Button that runs an async action with a spinner and double-tap guard.
struct AsyncButton: View {
    let title: String
    var isBusy: Bool
    var action: () async -> Void

    var body: some View {
        Button {
            guard !isBusy else { return }
            Task { await action() }
        } label: {
            HStack {
                Spacer()
                if isBusy { ProgressView().tint(.white) }
                Text(title).bold()
                Spacer()
            }
            .frame(minHeight: YoohTheme.Layout.minTouch)
        }
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}

/// Small "bot" marker next to bot names.
struct BotTag: View {
    var body: some View {
        Text("bot")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(ThemeStore.shared.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(ThemeStore.shared.accent.opacity(0.15), in: .capsule)
            .accessibilityLabel(Text("Бот"))
    }
}

extension View {
    /// System translation sheet (iOS 18+, on-device when packs installed).
    @ViewBuilder
    func translateSheet(isPresented: Binding<Bool>, text: String) -> some View {
        if #available(iOS 18, *) {
            self.translationPresentation(isPresented: isPresented, text: text)
        } else {
            self
        }
    }
}
