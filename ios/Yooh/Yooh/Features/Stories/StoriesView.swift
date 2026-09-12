import AVKit
import PhotosUI
import SwiftUI

/// Stories: author strip + viewer + photo creation.
struct StoriesView: View {
    @Environment(AppState.self) private var app
    @State private var viewerGroup: Int?
    @State private var showCreator = false

    var body: some View {
        @Bindable var stories = app.storiesViewModel
        NavigationStack {
            ZStack {
                YoohTheme.TG.background.ignoresSafeArea()
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
                        .scrollContentBackground(.hidden)
                        .refreshable { await stories.refresh() }
                    }
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
                .stroke(ThemeStore.shared.accent, lineWidth: 2.5)
                .frame(width: size + 6, height: size + 6)
        }
    }
}

private struct StoryViewerView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let groups: [(authorId: String, author: PublicUser?, stories: [YoohStory])]
    let startIndex: Int

    @State private var groupIdx: Int
    @State private var storyIdx = 0
    @State private var progress: CGFloat = 0
    @State private var replyText = ""
    @State private var showCaptionEditor = false
    @State private var editCaption = ""
    @State private var isSendingReply = false

    init(groups: [(authorId: String, author: PublicUser?, stories: [YoohStory])], startIndex: Int) {
        self.groups = groups
        self.startIndex = startIndex
        _groupIdx = State(initialValue: startIndex)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let story = live ?? current {
                StoryPageView(story: story)
                    .onAppear {
                        progress = 0
                        Task { await app.storiesViewModel.view(story) }
                        withAnimation(.linear(duration: 5)) { progress = 1 }
                    }
                    .id(story.id)
                    .onChange(of: story.id) { _, _ in
                        replyText = ""
                    }
                    .onChange(of: progress) { _, p in
                        if p >= 1 { advance() }
                    }
            }
            VStack {
                progressSegments
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
                .padding(.horizontal)
                Spacer()
                if let story = live {
                    commentsPreview(for: story)
                }
                reactionBar
                bottomBar
            }
        }
        .sheet(isPresented: $showCaptionEditor) {
            NavigationStack {
                Form {
                    Section("Caption") {
                        TextField("Say something…", text: $editCaption, axis: .vertical)
                    }
                    AsyncButton(title: "Save", isBusy: false) {
                        await saveCaption()
                    }
                    .disabled(editCaption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .navigationTitle("Edit caption")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Cancel") { showCaptionEditor = false }
                    }
                }
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

    private var progressSegments: some View {
        HStack(spacing: 4) {
            ForEach(groups[groupIdx].stories.indices, id: \.self) { i in
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.3))
                        if i < storyIdx {
                            Capsule().fill(Color.white)
                        } else if i == storyIdx {
                            Capsule()
                                .fill(Color.white)
                                .frame(width: geo.size.width * min(max(progress, 0), 1))
                        }
                    }
                }
                .frame(height: 3)
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private var current: YoohStory? {
        guard groups.indices.contains(groupIdx) else { return nil }
        let list = groups[groupIdx].stories
        guard list.indices.contains(storyIdx) else { return nil }
        return list[storyIdx]
    }

    /// Fresh copy from the view model (reactions, comments, caption edits).
    private var live: YoohStory? {
        guard let story = current else { return nil }
        return app.storiesViewModel.liveStory(id: story.id) ?? story
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

    @ViewBuilder
    private func commentsPreview(for story: YoohStory) -> some View {
        if let comments = story.liveComments, !comments.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(comments.suffix(3)) { c in
                    HStack(alignment: .top, spacing: 6) {
                        Text(c.text ?? "")
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var bottomBar: some View {
        if isOwnStory, let story = live {
            HStack {
                Button {
                    Task { await app.storiesViewModel.toggleSaveToProfile(story) }
                } label: {
                    Label((story.saveToProfile ?? false) ? "Saved to profile" : "Save to profile",
                          systemImage: (story.saveToProfile ?? false) ? "bookmark.fill" : "bookmark")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                }
                Spacer()
                Button {
                    editCaption = story.caption ?? ""
                    showCaptionEditor = true
                } label: {
                    Label("Edit", systemImage: "pencil")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                }
                .accessibilityLabel(Text("Edit story caption"))
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        } else {
            HStack(spacing: 8) {
                TextField("Reply…", text: $replyText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...3)
                Button {
                    Task { await sendReply() }
                } label: {
                    if isSendingReply {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .foregroundStyle(.white)
                    }
                }
                .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSendingReply)
                .accessibilityLabel(Text("Send reply"))
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }

    private func sendReply() async {
        guard let story = live else { return }
        isSendingReply = true
        defer { isSendingReply = false }
        if await app.storiesViewModel.reply(story, text: replyText) {
            replyText = ""
            Haptics.send()
        }
    }

    private func saveCaption() async {
        guard let story = live else { return }
        if await app.storiesViewModel.saveCaption(story, caption: editCaption) {
            showCaptionEditor = false
            Haptics.send()
        }
    }

    private func advance() {
        let list = groups[groupIdx].stories
        if storyIdx + 1 < list.count {
            storyIdx += 1
            restartProgress()
        } else if groupIdx + 1 < groups.count {
            groupIdx += 1
            storyIdx = 0
            restartProgress()
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
        restartProgress()
    }

    private func restartProgress() {
        progress = 0
        withAnimation(.linear(duration: 5)) { progress = 1 }
    }
}

private struct StoryPageView: View {
    let story: YoohStory

    var body: some View {
        VStack {
            if story.mediaType == "video",
               let raw = story.video ?? story.image,
               let url = StoryVideoCache.url(storyId: story.id, dataURL: raw)
            {
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(maxHeight: 480)
                    .clipShape(.rect(cornerRadius: YoohTheme.Radius.m))
            } else if let dataURL = story.image ?? story.avatar,
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

/// Caches story video data URLs as temp .mp4 files for AVPlayer.
private enum StoryVideoCache {
    static func url(storyId: String, dataURL: String) -> URL? {
        guard let data = MediaService.data(fromDataURL: dataURL) else { return nil }
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("yooh-story-\(storyId).mp4")
        if FileManager.default.fileExists(atPath: file.path) { return file }
        do {
            try data.write(to: file, options: .atomic)
            return file
        } catch {
            return nil
        }
    }
}

struct StoryCreatorView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var item: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var videoData: Data?
    @State private var videoPlayer: AVPlayer?
    @State private var caption = ""
    @State private var error: String?
    @State private var isPublishing = false

    private var hasMedia: Bool { image != nil || videoData != nil }

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
                    } else if let player = videoPlayer {
                        VideoPlayer(player: player)
                            .frame(height: 280)
                            .clipShape(.rect(cornerRadius: YoohTheme.Radius.m))
                    }
                    PhotosPicker(selection: $item,
                                 matching: .any(of: [.images, .videos])) {
                        Label(hasMedia ? "Change photo or video" : "Choose photo or video",
                              systemImage: "photo")
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
                .disabled(!hasMedia)
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
                    guard let data = try? await new.loadTransferable(type: Data.self) else { return }
                    if let img = UIImage(data: data) {
                        image = img
                        videoData = nil
                        videoPlayer = nil
                    } else {
                        videoData = data
                        image = nil
                        let tmp = FileManager.default.temporaryDirectory
                            .appendingPathComponent("yooh-story-draft.mp4")
                        try? data.write(to: tmp, options: .atomic)
                        videoPlayer = AVPlayer(url: tmp)
                    }
                }
            }
        }
    }

    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        let captionValue: String? = caption.isEmpty ? nil : caption
        let ok: Bool
        if let videoData {
            ok = await app.storiesViewModel.publishVideo(videoData, caption: captionValue)
        } else if let image {
            ok = await app.storiesViewModel.publishPhoto(image, caption: captionValue)
        } else {
            return
        }
        if ok {
            dismiss()
        } else {
            error = app.storiesViewModel.error
        }
    }
}
