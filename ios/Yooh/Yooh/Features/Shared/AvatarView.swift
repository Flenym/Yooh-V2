import SwiftUI

/// Avatar: base64 data-URL (server JSON) → cached image, else initials.
struct AvatarView: View {
    let dataURL: String?
    let name: String
    var size: CGFloat = YoohTheme.Layout.avatarM
    var isOnline: Bool = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let img = AvatarLoader.image(for: dataURL) {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                } else {
                    Circle()
                        .fill(AvatarLoader.color(for: name))
                        .overlay {
                            Text(AvatarLoader.initials(for: name))
                                .font(.system(size: size * 0.38, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityLabel(Text("Avatar of \(name)"))

            if isOnline {
                Circle()
                    .fill(YoohTheme.TG.presence)
                    .frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
            }
        }
    }
}

enum AvatarLoader {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(for dataURL: String?) -> UIImage? {
        guard let dataURL, !dataURL.isEmpty else { return nil }
        if let hit = cache.object(forKey: dataURL as NSString) { return hit }
        guard let data = MediaService.data(fromDataURL: dataURL),
              let img = UIImage(data: data) else { return nil }
        cache.setObject(img, forKey: dataURL as NSString)
        return img
    }

    static func initials(for name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first }.map(String.init).joined()
        return s.isEmpty ? "?" : s.uppercased()
    }

    static func color(for name: String) -> Color {
        let palette: [Color] = [.blue, .green, .orange, .purple, .pink, .teal, .indigo]
        return palette[abs(name.hashValue) % palette.count]
    }
}
