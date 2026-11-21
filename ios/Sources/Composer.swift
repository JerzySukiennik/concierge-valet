// The writing field: one main button that is the voice conversation when the field is empty and send when it is not, attachments behind the plus, and dictation that turns the field into live waves.
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct Composer: View {
    @Binding var text: String
    @Binding var picks: [Pick]
    var focus: FocusState<Bool>.Binding
    let onVoice: () -> Void

    @Environment(AppModel.self) private var model
    @State private var dictation = Dictation()
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var pickingFiles = false
    @State private var shooting = false
    @State private var finishing = false

    private var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && picks.isEmpty }

    var body: some View {
        VStack(spacing: 8) {
            if !picks.isEmpty { tray.transition(.move(edge: .bottom).combined(with: .opacity)) }
            Group {
                if dictation.active { dictating.transition(.opacity) } else { field.transition(.opacity) }
            }
            .padding(5)
            .frame(minHeight: 50)
            .background(Paper.field, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.1), radius: 14, y: 8)
        }
        .padding(.horizontal, 12)
        .animation(Motion.snap, value: dictation.active)
        .animation(Motion.snap, value: picks.count)
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 6, matching: .images)
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task { await take(items) }
        }
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { take(urls) }
        }
        .fullScreenCover(isPresented: $shooting) {
            CameraPicker { image in
                if let image, let pick = Composer.shrink(image, name: "Zdjęcie.jpg") { picks.append(pick) }
            }
            .ignoresSafeArea()
        }
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: 2) {
            Menu {
                Button("Zdjęcia", systemImage: "photo.on.rectangle") { pickingPhotos = true }
                if UIImagePickerController.isSourceTypeAvailable(.camera) { Button("Aparat", systemImage: "camera") { shooting = true } }
                Button("Pliki", systemImage: "folder") { pickingFiles = true }
            } label: {
                Image(systemName: "plus").font(.system(size: 19, weight: .medium)).foregroundStyle(Paper.muted).frame(width: 38, height: 38).contentShape(Circle())
            }
            .accessibilityLabel("Dodaj załącznik")
            TextField("Wiadomość", text: $text, axis: .vertical)
                .font(Face.sans(16.5))
                .foregroundStyle(Paper.fg)
                .tint(Paper.accent)
                .lineLimit(1...6)
                .focused(focus)
                .padding(.vertical, 8)
                .padding(.horizontal, 4)
            if empty {
                Button { startDictation() } label: {
                    Image(systemName: "mic").font(.system(size: 18, weight: .medium)).foregroundStyle(Paper.muted).frame(width: 38, height: 38).contentShape(Circle())
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Dyktuj")
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
            Button {
                if empty { onVoice() } else { send() }
            } label: {
                ZStack {
                    Circle().fill(Paper.accent)
                    Image(systemName: empty ? "waveform" : "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Paper.onAccent)
                        .contentTransition(.symbolEffect(.replace.downUp))
                }
                .frame(width: 38, height: 38)
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel(empty ? "Rozmowa głosowa" : "Wyślij")
        }
        .animation(Motion.snap, value: empty)
    }

    private var dictating: some View {
        HStack(spacing: 6) {
            Button {
                Haptic.tap()
                dictation.cancel()
            } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(Paper.muted).frame(width: 38, height: 38).contentShape(Circle())
            }
            .accessibilityLabel("Anuluj dyktowanie")
            WaveBar(levels: dictation.levels).frame(height: 38).frame(maxWidth: .infinity)
            if finishing { ProgressView().frame(width: 38, height: 38) }
            else {
                Button("Wstaw") { finish(send: false) }.buttonStyle(PillStyle(height: 38))
                Button("Wyślij") { finish(send: true) }.buttonStyle(PillStyle(solid: true, height: 38))
            }
        }
    }

    private var tray: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(picks) { pick in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if pick.isImage, let image = UIImage(data: pick.data) {
                                Image(uiImage: image).resizable().scaledToFill()
                            } else {
                                VStack(spacing: 3) {
                                    Image(systemName: "doc").font(.system(size: 18))
                                    Text(pick.name).font(Face.sans(10)).lineLimit(1).padding(.horizontal, 4)
                                }
                                .foregroundStyle(Paper.muted)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(Paper.soft)
                            }
                        }
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        Button {
                            picks.removeAll { $0.id == pick.id }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Paper.onInk).frame(width: 20, height: 20).background(Paper.ink, in: Circle())
                        }
                        .offset(x: 5, y: -5)
                        .accessibilityLabel("Usuń załącznik")
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.top, 6)
        }
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty || !picks.isEmpty else { return }
        Haptic.tap()
        model.send(body, picks: picks)
        text = ""
        picks = []
        focus.wrappedValue = false
    }

    private func startDictation() {
        Haptic.tap()
        focus.wrappedValue = false
        Task {
            if !(await dictation.start(model)) { model.say("Włącz mikrofon dla Valeta w Ustawieniach iPhone'a") }
        }
    }

    private func finish(send now: Bool) {
        Haptic.press()
        finishing = true
        Task {
            let said = await dictation.stop()
            finishing = false
            guard !said.isEmpty else {
                model.say("Nic nie usłyszałem")
                return
            }
            text = text.trimmingCharacters(in: .whitespaces).isEmpty ? said : "\(text) \(said)"
            if now { send() } else { focus.wrappedValue = true }
        }
    }

    private func take(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let pick = Composer.shrink(image, name: "Zdjęcie.jpg") else { continue }
            picks.append(pick)
        }
    }

    private func take(_ urls: [URL]) {
        for url in urls.prefix(6) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            if data.count > 12_000_000 {
                model.say("Plik jest za duży (limit 12 MB)")
                continue
            }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            if mime.hasPrefix("image/"), let image = UIImage(data: data), let pick = Composer.shrink(image, name: url.lastPathComponent) { picks.append(pick) }
            else { picks.append(Pick(name: url.lastPathComponent, mime: mime, data: data)) }
        }
    }

    static func shrink(_ image: UIImage, name: String) -> Pick? {
        let longest = max(image.size.width, image.size.height), scale = min(1, 1568 / max(1, longest))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = drawn.jpegData(compressionQuality: 0.86) else { return nil }
        let base = (name as NSString).deletingPathExtension
        return Pick(name: "\(base.isEmpty ? "Zdjęcie" : base).jpg", mime: "image/jpeg", data: data, width: Int(size.width), height: Int(size.height))
    }
}

struct WaveBar: View {
    let levels: [CGFloat]

    var body: some View {
        Canvas { context, box in
            let step: CGFloat = 6, count = Int(box.width / step)
            let shown = Array(levels.suffix(count))
            for (i, level) in shown.enumerated() {
                let h = max(4, min(1, level * 7) * (box.height - 6))
                let x = box.width - CGFloat(shown.count - i) * step
                context.fill(Path(roundedRect: CGRect(x: x, y: (box.height - h) / 2, width: 3, height: h), cornerRadius: 1.5), with: .color(Paper.accent))
            }
        }
        .animation(.linear(duration: 0.06), value: levels.count)
        .accessibilityLabel("Dyktowanie trwa")
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let owner: CameraPicker
        init(_ owner: CameraPicker) { self.owner = owner }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            owner.done(info[.originalImage] as? UIImage)
            owner.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            owner.done(nil)
            owner.dismiss()
        }
    }
}
