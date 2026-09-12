import SwiftUI

/// Remote attachment thumbnail with memory+disk cache.
/// `?token=` auth, like the web client.
struct CachedFileImage: View {
    let fileId: String?
    let token: String?
    var height: CGFloat = 180

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(Color(.tertiarySystemFill))
                    .overlay { ProgressView() }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
        .task(id: fileId) { await load() }
    }

    private func load() async {
        guard let fileId, let token else { return }
        if let hit = await ImageCache.shared.image(for: fileId) {
            image = hit
            return
        }
        do {
            let data = try await MediaService().downloadData(fileId: fileId, inline: true, token: token)
            await ImageCache.shared.storeData(data, for: fileId)
            if let img = UIImage(data: data) {
                image = img
            }
        } catch {
            // Thumbnail failure degrades to the file row.
        }
    }
}
