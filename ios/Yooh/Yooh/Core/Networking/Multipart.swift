import Foundation

/// Multipart/form-data builder for `POST /api/chats/:id/files`.
struct MultipartBody {
    let boundary: String
    private var data = Data()

    init(boundary: String = "YoohBoundary-\(UUID().uuidString)") {
        self.boundary = boundary
    }

    mutating func addField(name: String, value: String) {
        var s = "--\(boundary)\r\n"
        s += "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n"
        s += "\(value)\r\n"
        data.append(Data(s.utf8))
    }

    mutating func addFile(name: String, filename: String, mimeType: String, fileData: Data) {
        var s = "--\(boundary)\r\n"
        s += "Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n"
        s += "Content-Type: \(mimeType)\r\n\r\n"
        data.append(Data(s.utf8))
        data.append(fileData)
        data.append(Data("\r\n".utf8))
    }

    func finalize() -> Data {
        var out = data
        out.append(Data("--\(boundary)--\r\n".utf8))
        return out
    }

    var contentType: String {
        "multipart/form-data; boundary=\(boundary)"
    }
}
