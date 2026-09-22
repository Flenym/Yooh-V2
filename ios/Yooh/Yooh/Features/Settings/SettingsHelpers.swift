import SwiftUI

enum SettingsReader {
    static func section(_ name: String, of user: YoohUser?) -> [String: AnyCodable] {
        if case .object(let o) = user?.settings?[name] { return o }
        return [:]
    }

    static func bool(_ key: String, in section: [String: AnyCodable], default d: Bool) -> Bool {
        if case .bool(let b) = section[key] { return b }
        return d
    }

    static func string(_ key: String, in section: [String: AnyCodable], default d: String) -> String {
        section[key]?.stringValue ?? d
    }
}

enum Audience: String, CaseIterable {
    case everyone = "Everyone"
    case contacts = "Contacts"
    case nobody = "Nobody"

    var title: String {
        switch self {
        case .everyone: return "Все"
        case .contacts: return "Контакты"
        case .nobody: return "Никто"
        }
    }

    var wire: String { rawValue.lowercased() }
    static func from(_ wire: String) -> Audience {
        switch wire.lowercased() {
        case "contacts": return .contacts
        case "nobody": return .nobody
        default: return .everyone
        }
    }
}

struct SettingToggleRow: View {
    let title: String
    let subtitle: String?
    @Binding var isOn: Bool
    var onChange: (Bool) -> Void

    init(title: String, subtitle: String? = nil, isOn: Binding<Bool>,
         onChange: @escaping (Bool) -> Void) {
        self.title = title
        self.subtitle = subtitle
        self._isOn = isOn
        self.onChange = onChange
    }

    var body: some View {
        Toggle(isOn: Binding(
            get: { isOn },
            set: { v in isOn = v; onChange(v) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 17))
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

struct AudienceRow: View {
    let title: String
    let subtitle: String?
    @Binding var selection: Audience
    var onChange: (Audience) -> Void

    init(title: String, subtitle: String? = nil, selection: Binding<Audience>,
         onChange: @escaping (Audience) -> Void) {
        self.title = title
        self.subtitle = subtitle
        self._selection = selection
        self.onChange = onChange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 17))
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Picker(title, selection: Binding(
                get: { selection },
                set: { v in selection = v; onChange(v) }
            )) {
                ForEach(Audience.allCases, id: \.self) { a in
                    Text(a.title).tag(a)
                }
            }
            .pickerStyle(.segmented)
        }
        .padding(.vertical, 6)
    }
}
