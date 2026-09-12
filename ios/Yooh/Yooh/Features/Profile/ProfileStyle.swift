import PhotosUI
import SwiftUI

enum ProfileStyle {
    static let statusPresets = ["", "🔥", "⭐", "🎧", "🎮", "💼", "🌙", "☕", "🏖️", "💪", "🎨", "🚀", "💤", "🎉"]
    static let colorPresets = ["#f4c84c", "#3390ec", "#9d6bff", "#2fd47e", "#ffa726", "#ff4d67", "#5ac8fa", "#c0c0c0"]

    static func banner(dataURL: String?, height: CGFloat = 170) -> some View {
        Group {
            if let dataURL, !dataURL.isEmpty,
               let data = MediaService.data(fromDataURL: dataURL),
               let img = UIImage(data: data)
            {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(colors: [Color(red: 0.25, green: 0.2, blue: 0.6),
                                        Color(red: 0.08, green: 0.05, blue: 0.18)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
        .accessibilityLabel(Text("Profile banner"))
    }

    static func decoratedAvatar(avatarURL: String?, name: String, badge: PremiumBadge?, size: CGFloat) -> some View {
        ZStack(alignment: .bottomTrailing) {
            AvatarView(dataURL: avatarURL, name: name, size: size)
            if let badge, badge.type == "photo",
               let raw = badge.photo, !raw.isEmpty,
               let data = (MediaService.data(fromDataURL: raw) ?? Data(base64Encoded: raw)),
               let frame = UIImage(data: data)
            {
                Image(uiImage: frame)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .opacity(0.9)
                    .allowsHitTesting(false)
                    .accessibilityLabel(Text("Avatar decoration"))
            }
            if let badge, badge.type == "star", let star = badge.star, !star.isEmpty {
                Text(star)
                    .font(.system(size: size * 0.3))
                    .background(
                        Circle()
                            .fill(Color(hex: badge.bgColor ?? "#f4c84c"))
                            .frame(width: size * 0.36, height: size * 0.36)
                    )
                    .offset(x: 2, y: 2)
                    .accessibilityLabel(Text("Profile badge"))
            }
        }
    }
}

struct ProfilePhotoPicker: View {
    @Binding var item: PhotosPickerItem?
    let title: String
    let symbol: String

    var body: some View {
        PhotosPicker(selection: $item, matching: .images) {
            Label(title, systemImage: symbol)
        }
    }
}
