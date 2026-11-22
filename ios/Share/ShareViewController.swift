// "Valet" in the share sheet: takes pictures, links, text and files from any app, lets the owner add a note and posts them to his thread.
import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(model: ShareModel(context: extensionContext)))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}

enum Piece: Identifiable {
    case image(id: UUID, data: Data, width: Int, height: Int, thumb: UIImage)
    case link(id: UUID, url: URL)
    case text(id: UUID, body: String)
    case file(id: UUID, name: String, mime: String, data: Data)

    var id: UUID {
        switch self {
        case .image(let id, _, _, _, _), .link(let id, _), .text(let id, _), .file(let id, _, _, _): return id
        }
    }
}

@MainActor @Observable
final class ShareModel {
    var pieces: [Piece] = []
    var note = ""
    var phase = "loading"
    var problem = ""

    @ObservationIgnored private weak var context: NSExtensionContext?
    @ObservationIgnored private let token: String
    @ObservationIgnored private let base = URL(string: "https://concierge-valet-api.kalakasanyt.workers.dev")

    init(context: NSExtensionContext?) {
        self.context = context
        let bundled = Bundle.main.url(forResource: "Pairing", withExtension: "plist").flatMap { NSDictionary(contentsOf: $0)?["token"] as? String }
        token = bundled ?? ""
    }

    var ready: Bool { phase == "ready" && (!pieces.isEmpty || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }

    func load() async {
        guard phase == "loading" else { return }
        let items = context?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }, began = Date()
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let found = await ShareModel.picture(provider) { pieces.append(.image(id: UUID(), data: found.0, width: found.1, height: found.2, thumb: found.3)) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                if let found = await ShareModel.document(provider) { pieces.append(.file(id: UUID(), name: found.0, mime: found.1, data: found.2)) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let url = await ShareModel.item(provider, UTType.url) as? URL { pieces.append(.link(id: UUID(), url: url)) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let body = await ShareModel.item(provider, UTType.plainText) as? String, !body.isEmpty { pieces.append(.text(id: UUID(), body: String(body.prefix(6000)))) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
                if let found = await ShareModel.document(provider) { pieces.append(.file(id: UUID(), name: found.0, mime: found.1, data: found.2)) }
            }
        }
        if token.isEmpty {
            phase = "failed"
            problem = "Ta apka nie jest jeszcze połączona z Valetem."
        } else if pieces.isEmpty {
            phase = "failed"
            problem = "Tego nie umiem wysłać do Valeta."
            await log("nothing usable", providers.map { $0.registeredTypeIdentifiers.joined(separator: " ") }.joined(separator: " | "))
        } else {
            phase = "ready"
            if pieces.count < providers.count { await log("some items skipped", "\(pieces.count) of \(providers.count) read in \(Int(Date().timeIntervalSince(began) * 1000)) ms") }
        }
    }

    private var summary: String {
        var images = 0, files = 0, links = 0, texts = 0, bytes = 0
        for piece in pieces {
            switch piece {
            case .image(_, let data, _, _, _): images += 1; bytes += data.count
            case .file(_, _, _, let data): files += 1; bytes += data.count
            case .link: links += 1
            case .text: texts += 1
            }
        }
        return "\(images) images, \(files) files, \(links) links, \(texts) texts, \(bytes / 1024) KB"
    }

    private func log(_ what: String, _ detail: String = "") async {
        let entry: JSON = ["ts": .number((Date().timeIntervalSince1970 * 1000).rounded()), "what": .string(what), "detail": .string(String(detail.prefix(400)))]
        _ = try? await call("/api/log", ["app": "share", "entries": [entry]], timeout: 6)
    }

    nonisolated private static func item(_ provider: NSItemProvider, _ type: UTType) async -> Any? {
        await withCheckedContinuation { done in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { value, _ in done.resume(returning: value) }
        }
    }

    nonisolated private static func picture(_ provider: NSItemProvider) async -> (Data, Int, Int, UIImage)? {
        let fromFile: (Data, Int, Int, UIImage)? = await withCheckedContinuation { done in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                done.resume(returning: url.flatMap { CGImageSourceCreateWithURL($0 as CFURL, nil) }.flatMap(shrink))
            }
        }
        if let fromFile { return fromFile }
        let loose = await item(provider, UTType.image)
        if let image = loose as? UIImage, let data = image.jpegData(compressionQuality: 0.9) { return CGImageSourceCreateWithData(data as CFData, nil).flatMap(shrink) }
        if let data = loose as? Data { return CGImageSourceCreateWithData(data as CFData, nil).flatMap(shrink) }
        if let url = loose as? URL { return CGImageSourceCreateWithURL(url as CFURL, nil).flatMap(shrink) }
        return nil
    }

    nonisolated private static func shrink(_ source: CGImageSource) -> (Data, Int, Int, UIImage)? {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1568]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let picture = UIImage(cgImage: image)
        guard let data = picture.jpegData(compressionQuality: 0.86) else { return nil }
        return (data, image.width, image.height, picture)
    }

    nonisolated private static func document(_ provider: NSItemProvider) async -> (String, String, Data)? {
        let kind = provider.registeredTypeIdentifiers.first { $0 != UTType.fileURL.identifier } ?? UTType.data.identifier
        return await withCheckedContinuation { done in
            provider.loadFileRepresentation(forTypeIdentifier: kind) { url, _ in
                guard let url, let data = try? Data(contentsOf: url), data.count <= 12_000_000 else {
                    done.resume(returning: nil)
                    return
                }
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                done.resume(returning: (provider.suggestedName.map { url.pathExtension.isEmpty || $0.hasSuffix(".\(url.pathExtension)") ? $0 : "\($0).\(url.pathExtension)" } ?? url.lastPathComponent, mime, data))
            }
        }
    }

    private func call(_ path: String, _ body: JSON, timeout: TimeInterval = 120) async throws -> JSON {
        guard let url = base.flatMap({ URL(string: path, relativeTo: $0) }) else { throw APIError(status: 0) }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body.data
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw APIError(status: code) }
        return JSON.parse(data) ?? .null
    }

    func send() async {
        guard ready else { return }
        phase = "sending"
        problem = ""
        let began = Date()
        do {
            var files: [JSON] = []
            var lines = [note.trimmingCharacters(in: .whitespacesAndNewlines)]
            for piece in pieces {
                switch piece {
                case .image(_, let data, let width, let height, _):
                    var file = try await call("/api/upload", ["name": "Zdjęcie.jpg", "mime": "image/jpeg", "data": .string(data.base64EncodedString()), "w": .number(Double(width)), "h": .number(Double(height))])["file"]
                    file["w"] = .number(Double(width))
                    file["h"] = .number(Double(height))
                    files.append(file)
                case .file(_, let name, let mime, let data):
                    files.append(try await call("/api/upload", ["name": .string(name), "mime": .string(mime), "data": .string(data.base64EncodedString()), "w": 0, "h": 0])["file"])
                case .link(_, let url): lines.append(url.absoluteString)
                case .text(_, let body): lines.append(body)
                }
            }
            _ = try await call("/api/message", ["text": .string(lines.filter { !$0.isEmpty }.joined(separator: "\n")), "files": .array(files)])
            Haptic.done()
            await log("shared", "\(summary), sent in \(Int(Date().timeIntervalSince(began) * 1000)) ms")
            context?.completeRequest(returningItems: nil)
        } catch {
            Haptic.fail()
            phase = "ready"
            problem = "Nie udało się wysłać. Sprawdź połączenie i spróbuj jeszcze raz."
            await log("share failed", "\(summary), \(error.brief) after \(Int(Date().timeIntervalSince(began) * 1000)) ms")
        }
    }

    func cancel() {
        context?.cancelRequest(withError: CocoaError(.userCancelled))
    }
}

struct ShareView: View {
    @Bindable var model: ShareModel
    @FocusState private var typing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Wyślij do Valeta").font(Face.serif(23, .semibold)).foregroundStyle(Paper.fg)
                Spacer()
                Button { model.cancel() } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Paper.muted).frame(width: 34, height: 34).background(Paper.soft, in: Circle())
                }
                .accessibilityLabel("Anuluj")
            }
            if model.phase == "loading" {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                if !model.pieces.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) { ForEach(model.pieces) { preview($0) } }
                    }
                }
                TextField("Dopisz, co Valet ma z tym zrobić", text: $model.note, axis: .vertical)
                    .font(Face.sans(16.5))
                    .foregroundStyle(Paper.fg)
                    .tint(Paper.accent)
                    .lineLimit(1...5)
                    .focused($typing)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 13)
                    .background(Paper.field, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
                if !model.problem.isEmpty { Text(model.problem).font(Face.sans(14)).foregroundStyle(Paper.err) }
                Button {
                    typing = false
                    Task { await model.send() }
                } label: {
                    HStack(spacing: 8) {
                        if model.phase == "sending" { ProgressView().tint(Paper.onAccent) }
                        Text(model.phase == "sending" ? "Wysyłam" : "Wyślij").frame(maxWidth: model.phase == "sending" ? nil : .infinity)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(PillStyle(solid: true, height: 50))
                .disabled(!model.ready)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .background(Paper.bg.ignoresSafeArea())
        .task { await model.load() }
    }

    @ViewBuilder private func preview(_ piece: Piece) -> some View {
        switch piece {
        case .image(_, _, _, _, let thumb):
            Image(uiImage: thumb).resizable().scaledToFill().frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
        case .link(_, let url):
            tile("link", url.host ?? "Link", url.absoluteString)
        case .text(_, let body):
            tile("text.alignleft", "Tekst", body)
        case .file(_, let name, _, let data):
            tile("doc", name, data.count >= 1_048_576 ? String(format: "%.1f MB", Double(data.count) / 1_048_576) : "\(max(1, data.count / 1024)) KB")
        }
    }

    private func tile(_ symbol: String, _ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(Paper.muted)
            Text(title).font(Face.sans(14, .semibold)).foregroundStyle(Paper.fg).lineLimit(1)
            Text(detail).font(Face.sans(12.5)).foregroundStyle(Paper.muted).lineLimit(2)
        }
        .padding(12)
        .frame(width: 210, height: 96, alignment: .topLeading)
        .background(Paper.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
    }
}
