import SwiftUI

/// Contacts tab: global user search + public groups + join/open.
struct ContactsView: View {
    @Environment(AppState.self) private var app
    @State private var search = ""
    @State private var openedChat: YoohChat?

    var body: some View {
        NavigationStack {
            ContactsSearchBody(
                search: $search,
                onPickUser: { user in
                    Task {
                        if let chat = await app.contactsViewModel.openDirect(with: user) {
                            openedChat = chat
                        }
                    }
                },
                onJoinPublic: { dc in
                    Task {
                        if let chat = await app.contactsViewModel.joinPublic(dc) {
                            openedChat = chat
                        }
                    }
                }
            )
            .navigationTitle("Contacts")
            .navigationDestination(item: $openedChat) { chat in
                ChatDetailView(chat: chat, app: app)
            }
        }
    }
}
