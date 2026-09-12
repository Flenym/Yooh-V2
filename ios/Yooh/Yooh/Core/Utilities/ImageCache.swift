import UIKit

/// In-memory + disk image cache (avatars, thumbnails). Disk lives in
/// Caches: the OS may purge it, everything is refetchable.
actor ImageCache {
    static let shared = ImageCache()

    private let memory = NSCache<NSString, UIImage>()

    nonisolated private var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yooh-images", isDirectory: true)
    }

    private init() {
        memory.countLimit = 200
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    func image(for key: String) -> UIImage? {
        if let hit = memory.object(forKey: key as NSString) { return hit }
        let url = cacheDir.appendingPathComponent(safeFileName(key))
        guard let data = try? Data(contentsOf: url),
              let img = UIImage(data: data) else { return nil }
        memory.setObject(img, forKey: key as NSString)
        return img
    }

    func store(_ image: UIImage, for key: String) {
        memory.setObject(image, forKey: key as NSString)
        let url = cacheDir.appendingPathComponent(safeFileName(key))
        Task.detached(priority: .background) {
            if let data = image.jpegData(compressionQuality: 0.85) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }

    func storeData(_ data: Data, for key: String) {
        if let img = UIImage(data: data) {
            memory.setObject(img, forKey: key as NSString)
        }
        let url = cacheDir.appendingPathComponent(safeFileName(key))
        Task.detached(priority: .background) {
            try? data.write(to: url, options: .atomic)
        }
    }

    func clear() {
        memory.removeAllObjects()
        try? FileManager.default.removeItem(at: cacheDir)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    private func safeFileName(_ key: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        if key.rangeOfCharacter(from: allowed.inverted) == nil, key.count <= 64 {
            return key
        }
        return "k\(abs(key.hashValue))"
    }
}
