import PhotosUI
import SwiftUI

/// Stories: author strip + latest grid, full-screen viewer, photo creation.
struct StoriesView: View {
    @Environment(AppState.self) private var app
    @State private var viewerGroup: Int?
    @State private var showCreator = false

    var body: some View {
        @Bindable var stories = app.storiesViewModel
        NavigationStack {
            Group {
                if stories.stories.isEmpty, !stories.isLoading {
                    EmptyStateView(symbol: "circle.dashed", title: "No stories",
                                   subtitle: "Stories from your contacts will appear here.")
                } else {
                    List {
                        Section {
                            strip
                                .listRowInsets(EdgeInsets())
                                .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await stories.refresh() }
                }
            }
            .navigationTitle("Stories")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showCreator = true
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityLabel(Text("Create story"))
                }
            }
            .overlay(alignment: .top) {
                if let error = stories.error {
                    ErrorBanner(message: error, onDismiss: { stories.clearError() })
                }
            }
            .sheet(isPresented: $showCreator) {
                StoryCreatorView()
            }
            .fullScreenCover(isPresented: Binding(
                get: { viewerGroup != nil },
                set: { if !$0 { viewerGroup = nil } }
            )) {
                if let idx = viewerGroup, stories.groups.indices.contains(idx) {
                    StoryViewerView(groups: stories.groups, startIndex: idx)
                }
            }
            .task {
                await stories.refresh()
            }
        }
    }

    private var strip: some View {
        @Bindable var stories = app.storiesViewModel
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: YoohTheme.Spacing.m) {
                ForEach(stories.groups.indices, id: \.self) { i in
                    let g = stories.groups[i]
                    Button {
                        viewerGroup = i
                    } label: {
                        VStack(spacing: 4) {
                            StoryRingAvatar(group: g, size: 64)
                            Text(g.author?.title ?? "Story")
                                .font(.caption2)
                                .lineLimit(1)
                                .frame(width: 64)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, YoohTheme.Spacing.l)
            .padding(.vertical, YoohTheme.Spacing.s)
        }
    }
}

private struct StoryRingAvatar: View {
    let group: (authorId: String, author: PublicUser?, stories: [YoohStory])
    var size: CGFloat

    var body: some View {
        AvatarView(dataURL: group.author?.avatar ?? group.stories.first?.image,
                   name: group.author?.title ?? "?",
                   size: size)
        .overlay {
            Circle()
                .stroke(Color.accentColor, lineWidth: 2.5)
                .frame(width: size + 6, height: size + 6)
        }
    }
}

// MARK: - Viewer

private struct StoryViewerView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let groups: [(authorId: String, author: PublicUser?, stories: [YoohStory])]
    let startIndex: Int

    @State private var groupIdx: Int
    @State private var storyIdx = 0
    @State private var progress: CGFloat = 0

    init(groups: [(authorId: String, author: PublicUser?, stories: [YoohStory])], startIndex: Int) {
        self.groups = groups
        self.startIndex = startIndex
        _groupIdx = State(initialValue: startIndex)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let story = current {
                StoryPageView(story: story)
                    .onAppear {
                        progress = 0
                        Task { await app.storiesViewModel.view(story) }
                        withAnimation(.linear(duration: 5)) { progress = 1 }
                    }
                    .id(story.id)
                    .onChange(of: progress) { _, p in
                        if p >= 1 { advance() }
                    }
            }
            VStack {
                HStack {
                    AvatarView(dataURL: groups[groupIdx].author?.avatar,
                               name: groups[groupIdx].author?.title ?? "?",
                               size: 32)
                    Text(groups[groupIdx].author?.title ?? "")
                        .foregroundStyle(.white)
                        .font(.subheadline.bold())
                    Spacer()
                    if isOwnStory {
                        Button {
                            Task {
                                if let s = current {
                                    await app.storiesViewModel.delete(s)
                                }
                                advance()
                            }
                        } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(.white)
                        }
                        .accessibilityLabel(Text("Delete story"))
                    }
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(Text("Close viewer"))
                }
                .padding()
                Spacer()
                reactionBar
            }
        }
        .gesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    if value.translation.width > 60 { retreat() }
                    else if value.translation.width < -60 { advance() }
                }
        )
        .accessibilityElement(children: .contain)
    }

    private var current: YoohStory? {
        guard groups.indices.contains(groupIdx) else { return nil }
        let list = groups[groupIdx].stories
        guard list.indices.contains(storyIdx) else { return nil }
        return list[storyIdx]
    }

    private var isOwnStory: Bool {
        current?.authorId == app.session.currentUser?.id
    }

    private var reactionBar: some View {
        HStack(spacing: YoohTheme.Spacing.l) {
            ForEach(["❤️", "👍", "😮", "🔥"], id: \.self) { emoji in
                Button {
                    if let s = current {
                        Task { await app.storiesViewModel.react(s, emoji: emoji) }
                    }
                    Haptics.selection()
                } label: {
                    Text(emoji).font(.title)
                }
                .accessibilityLabel(Text("React \(emoji)"))
            }
        }
        .padding()
        .yoohGlass()
        .padding()
    }

    private func advance() {
        let list = groups[groupIdx].stories
        if storyIdx + 1 < list.count {
            storyIdx += 1
            progress = 0
            withAnimation(.linear(duration: 5)) { progress = 1 }
        } else if groupIdx + 1 < groups.count {
            groupIdx += 1
            storyIdx = 0
            progress = 0
            withAnimation(.linear(duration: 5)) { progress = 1 }
        } else {
            dismiss()
        }
    }

    private func retreat() {
        if storyIdx > 0 {
            storyIdx -= 1
        } else if groupIdx > 0 {
            groupIdx -= 1
            storyIdx = groups[groupIdx].stories.count - 1
        }
        progress = 0
        withAnimation(.linear(duration: 5)) { progress = 1 }
    }
}

private struct StoryPageView: View {
    let story: YoohStory

    var body: some View {
        VStack {
            if let dataURL = story.image ?? story.avatar,
               let data = MediaService.data(fromDataURL: dataURL),
               let img = UIImage(data: data)
            {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: YoohTheme.Radius.l)
                    .fill(Color(.darkGray))
                    .overlay {
                        Text(story.title ?? "Yooh")
                            .font(.largeTitle.bold())
                            .foregroundStyle(.white)
                    }
                    .padding()
            }
            if let caption = story.caption, !caption.isEmpty {
                Text(caption)
                    .foregroundStyle(.white)
                    .padding()
            }
        }
    }
}

// MARK: - Creator

private struct StoryCreatorView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var item: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var caption = ""
    @State private var error: String?
    @State private var isPublishing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 280)
                            .clipShape(.rect(cornerRadius: YoohTheme.Radius.m))
                    }
                    PhotosPicker(selection: $item, matching: .images) {
                        Label(image == nil ? "Choose photo" : "Change photo", systemImage: "photo")
                    }
                }
                Section("Caption") {
                    TextField("Say something…", text: $caption, axis: .vertical)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                AsyncButton(title: "Publish", isBusy: isPublishing) {
                    await publish()
                }
                .disabled(image == nil)
            }
            .navigationTitle("New story")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onChange(of: item) { _, new in
                guard let new else { return }
                Task {
                    if let data = try? await new.loadTransferable(type: Data.self),
                       let img = UIImage(data: data)
                    {
                        image = img
                    }
                }
            }
        }
    }

    private func publish() async {
        guard let image else { return }
        isPublishing = true
        defer { isPublishing = false }
        if await app.storiesViewModel.publishPhoto(image, caption: caption.isEmpty ? nil : caption) {
            dismiss()
        } else {
            error = app.storiesViewModel.error
        }
    }
}
