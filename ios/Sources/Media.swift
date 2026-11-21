// Pictures and files: a small memory cache for images, thumbnails of files kept on the server, a full-screen viewer and file chips.
import SwiftUI
import UIKit

@MainActor
final class ImageStore {
    static let shared = ImageStore()
    private let cache = NSCache<NSString, UIImage>()
    private var loading: [String: Task<UIImage?, Never>] = [:]

    private func key(_ url: URL) -> String { url.host == AppModel.base.host ? url.path : url.absoluteString }

    func image(for url: URL) async -> UIImage? {
        let name = key(url)
        if let hit = cache.object(forKey: name as NSString) { return hit }
        if let running = loading[name] { return await running.value }
        let task = Task<UIImage?, Never> {
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return await Task.detached(priority: .userInitiated) { UIImage(data: data)?.preparingForDisplay() }.value
        }
        loading[name] = task
        let image = await task.value
        loading[name] = nil
        if let image { cache.setObject(image, forKey: name as NSString) }
        return image
    }
}

struct RemoteImage: View {
    let url: URL?
    var mode: ContentMode = .fill
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Paper.soft
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: mode).transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: image != nil)
        .task(id: url) {
            guard let url else { return }
            image = await ImageStore.shared.image(for: url)
        }
    }
}

struct FileImage: View {
    let id: String
    var mode: ContentMode = .fill
    @Environment(AppModel.self) private var model
    @State private var url: URL?

    var body: some View {
        RemoteImage(url: url, mode: mode)
            .task(id: id) { url = await model.link(id) }
    }
}

struct ImageViewer: View {
    let id: String
    var caption = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var zoom: CGFloat = 1
    @State private var held: CGFloat = 1
    @State private var pull: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.opacity(1 - min(0.6, abs(pull.height) / 500)).ignoresSafeArea()
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(zoom)
                    .offset(pull)
                    .gesture(MagnifyGesture().onChanged { zoom = max(1, min(5, held * $0.magnification)) }.onEnded { _ in held = zoom })
                    .simultaneousGesture(DragGesture().onChanged { if zoom <= 1.01 { pull = CGSize(width: 0, height: $0.translation.height) } }.onEnded { value in
                        if zoom <= 1.01, abs(value.translation.height) > 120 { dismiss() } else { withAnimation(Motion.snap) { pull = .zero } }
                    })
                    .onTapGesture(count: 2) { withAnimation(Motion.snap) { zoom = zoom > 1 ? 1 : 2.4; held = zoom } }
            } else {
                ProgressView().tint(.white)
            }
        }
        .overlay(alignment: .top) {
            HStack {
                Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).frame(width: 40, height: 40).background(.white.opacity(0.16), in: Circle()) }
                Spacer()
                if let image {
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(caption.isEmpty ? "Obrazek" : caption, image: Image(uiImage: image))) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold)).frame(width: 40, height: 40).background(.white.opacity(0.16), in: Circle())
                    }
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .overlay(alignment: .bottom) {
            if !caption.isEmpty { Text(caption).font(Face.sans(14)).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center).padding(20) }
        }
        .statusBarHidden()
        .task {
            if let url = await model.link(id) { image = await ImageStore.shared.image(for: url) }
        }
    }
}

struct FileChip: View {
    let file: FileItem
    var mine = false
    var wide = false
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var viewing = false
    @State private var busy = false

    var body: some View {
        if file.isImage && !wide {
            Button { viewing = true } label: {
                FileImage(id: file.id)
                    .frame(width: min(230, 230 * max(0.6, min(1.5, file.ratio))), height: min(230, 230 / max(0.6, min(1.5, file.ratio))) )
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
            .fullScreenCover(isPresented: $viewing) { ImageViewer(id: file.id, caption: file.name).environment(model) }
        } else {
            Button { open() } label: {
                HStack(spacing: 11) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Paper.soft)
                        if file.isImage { FileImage(id: file.id).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous)) }
                        else { Text(file.ext.isEmpty ? "PLIK" : file.ext).font(Face.round(10.5, .bold)).foregroundStyle(Paper.muted) }
                    }
                    .frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name).font(Face.sans(15, .semibold)).foregroundStyle(Paper.fg).lineLimit(1)
                        Text("\(file.label) · \(file.sizeText)").font(Face.sans(13)).foregroundStyle(Paper.muted)
                    }
                    Spacer(minLength: 4)
                    if busy { ProgressView() } else { Text(file.isImage ? "Pokaż" : "Otwórz").font(Face.sans(14, .semibold)).foregroundStyle(Paper.accent) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Paper.card)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .frame(maxWidth: wide ? .infinity : 300, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
            .fullScreenCover(isPresented: $viewing) { ImageViewer(id: file.id, caption: file.name).environment(model) }
        }
    }

    private func open() {
        Haptic.tap()
        if file.isImage {
            viewing = true
            return
        }
        busy = true
        Task {
            if let url = await model.link(file.id) { openURL(url) } else { model.say("Nie udało się otworzyć pliku") }
            busy = false
        }
    }
}
