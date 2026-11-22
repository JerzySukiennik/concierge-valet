// Agents and their look: an agent's page with its role and model, the avatar editor (name, kind, colours, shape, pixel drawing) and the list of WhatsApp chats Valet keeps an eye on.
import SwiftUI
import UIKit

enum AvatarKit {
    static let swatches = ["#ffffff", "#f8f6f1", "#ece8df", "#1d1c19", "#1f5a46", "#6fd3b0", "#e9c46a", "#b8821c", "#d9822b", "#2440d8", "#10261f"]
    static let pixels = ["..1111..", ".114411.", "11111111", ".22..22.", ".22..22.", "........", ".3....3.", "..3333.."]
    static let kinds = [("orbita", "Orbita"), ("buzka", "Buźka"), ("piksel", "Piksel")]
    static let states = [("idle", "Spokój"), ("listening", "Słucha"), ("thinking", "Myśli"), ("working", "Pracuje"), ("speaking", "Mówi"), ("happy", "Gotowe"), ("sleeping", "Śpi")]
    static let slots = ["valet": "chat", "atelier": "docs", "kurier": "text"]
    static let models = [("claude-sonnet-5-5", "Sonnet 5.5"), ("claude-haiku-5-5", "Haiku 5.5"), ("claude-opus-5-5", "Opus 5.5")]
    static let about = [
        "valet": "Odpisuje od razu, pamięta, co mu mówisz, i przekazuje dłuższą pracę pozostałym agentom.",
        "atelier": "Robi w tle pliki: PDF, dokumenty, arkusze, prezentacje i małe strony. Wynik wraca jako odpowiedź w wątku.",
        "kurier": "Pisze poranny brief i Weekly Briefing, a do tego krótkie teksty i przypomnienia.",
    ]

    static func defaults(_ kind: String) -> JSON {
        var cfg: JSON = ["pk": "#ffffff", "ink": "#1d1c19", "acc": "#1f5a46"]
        switch kind {
        case "buzka":
            cfg["eye"] = "pill"
            cfg["gap"] = 13
            cfg["mouth"] = "none"
        case "piksel":
            cfg["px"] = .array(pixels.map(JSON.string))
        default:
            cfg["sats"] = 1
            cfg["tilt"] = -24
        }
        return cfg
    }

    static func whole(_ avatar: JSON) -> JSON {
        let kind = kinds.contains { $0.0 == avatar["type"].text } ? avatar["type"].text : "orbita"
        var cfg = defaults(kind)
        for (key, value) in avatar["cfg"].object { cfg[key] = value }
        return ["type": .string(kind), "cfg": cfg]
    }

    static func hex(_ color: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }
}

struct Block<Content: View>: View {
    var title = ""
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if !title.isEmpty { Text(title.uppercased()).font(Face.sans(11.5, .semibold)).kerning(0.7).foregroundStyle(Paper.muted).padding(.horizontal, 6) }
            CardShell(radius: 20) { content }
        }
    }
}

struct AgentDetail: View {
    let key: String
    @Environment(AppModel.self) private var model
    @State private var mood = "idle"

    var body: some View {
        let agent = model.agent(key), slot = AvatarKit.slots[key] ?? "chat"
        ScrollView {
            VStack(spacing: 18) {
                Button {
                    Haptic.tap()
                    mood = "happy"
                    Task {
                        try? await Task.sleep(for: .seconds(1.3))
                        mood = "idle"
                    }
                } label: {
                    AvatarView(avatar: agent["avatar"], state: mood, size: 116)
                }
                .buttonStyle(PressStyle(scale: 0.93))
                .padding(.top, 18)
                VStack(spacing: 5) {
                    Text(agent["name"].text).font(Face.serif(28, .semibold)).foregroundStyle(Paper.fg)
                    Text(agent["role"].text).font(Face.sans(14.5)).foregroundStyle(Paper.muted)
                }
                Text(AvatarKit.about[key] ?? "").font(Face.serif(16.5)).lineSpacing(4).foregroundStyle(Paper.fg).multilineTextAlignment(.center).padding(.horizontal, 12)
                Block(title: "Praca") {
                    HStack {
                        Text("Model").font(Face.sans(16)).foregroundStyle(Paper.fg)
                        Spacer()
                        Picker("Model", selection: Binding(get: { model.settings["models"][slot].text }, set: { model.save(["models": .object([slot: .string($0)])]) })) {
                            ForEach(AvatarKit.models, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        .labelsHidden()
                        .tint(Paper.accent)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 50)
                }
                Block(title: "Wygląd") {
                    NavigationLink {
                        AvatarEditor(key: key)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Edytuj awatar").font(Face.sans(16, .medium)).foregroundStyle(Paper.accent)
                                Text("\(AvatarKit.kinds.first { $0.0 == agent["avatar"]["type"].text }?.1 ?? "Orbita"), nazwa, kolory i kształt").font(Face.sans(13)).foregroundStyle(Paper.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Paper.faint)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 58)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle(scale: 0.985))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
        .background(Paper.bg)
        .navigationTitle(agent["name"].text)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AvatarEditor: View {
    let key: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var avatar: JSON = .null
    @State private var mood = "idle"
    @State private var brush: Character = "1"
    @State private var saving = false

    private var kind: String { avatar["type"].text }
    private var changed: Bool {
        let now = model.agent(key)
        return !avatar.isNull && (name.trimmingCharacters(in: .whitespaces) != now["name"].text || avatar != AvatarKit.whole(now["avatar"]))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(spacing: 14) {
                    AvatarView(avatar: avatar, state: mood, size: 132).padding(.top, 14)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(AvatarKit.states, id: \.0) { item in
                                Button {
                                    Haptic.pick()
                                    mood = item.0
                                } label: {
                                    Text(item.1).font(Face.sans(13.5, .medium)).padding(.horizontal, 13).frame(height: 34)
                                        .foregroundStyle(mood == item.0 ? Paper.onInk : Paper.fg)
                                        .background(mood == item.0 ? Paper.ink : Paper.soft, in: Capsule())
                                }
                                .buttonStyle(PressStyle())
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.horizontal, -16)
                }
                Block {
                    HStack {
                        Text("Nazwa").font(Face.sans(16)).foregroundStyle(Paper.fg)
                        TextField("Nazwa", text: $name).font(Face.sans(16)).multilineTextAlignment(.trailing).submitLabel(.done).autocorrectionDisabled()
                            .onChange(of: name) { _, fresh in if fresh.count > 24 { name = String(fresh.prefix(24)) } }
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 50)
                }
                VStack(alignment: .leading, spacing: 7) {
                    label("Rodzaj")
                    Picker("Rodzaj", selection: Binding(get: { kind }, set: { fresh in
                        guard fresh != kind else { return }
                        var cfg = AvatarKit.defaults(fresh)
                        for part in ["pk", "ink", "acc"] { cfg[part] = avatar["cfg"][part] }
                        avatar = ["type": .string(fresh), "cfg": cfg]
                    })) {
                        ForEach(AvatarKit.kinds, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                }
                Block(title: "Kolory") {
                    colorRow("pk", "Krążek")
                    colorRow("ink", "Rysunek").hairline()
                    colorRow("acc", "Akcent").hairline()
                }
                Block(title: "Kształt") { shape }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
            .animation(Motion.snap, value: kind)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Paper.bg)
        .navigationTitle("Awatar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving { ProgressView() } else { Button("Zapisz") { save() }.font(Face.sans(16, .semibold)).tint(Paper.accent).disabled(!changed) }
            }
        }
        .onAppear {
            guard avatar.isNull else { return }
            let now = model.agent(key)
            name = now["name"].text
            avatar = AvatarKit.whole(now["avatar"])
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased()).font(Face.sans(11.5, .semibold)).kerning(0.7).foregroundStyle(Paper.muted).padding(.horizontal, 6)
    }

    private func set(_ part: String, _ value: JSON) {
        var cfg = avatar["cfg"]
        cfg[part] = value
        avatar["cfg"] = cfg
    }

    private func colorRow(_ part: String, _ title: String) -> some View {
        let current = avatar["cfg"][part].text.lowercased()
        return HStack(spacing: 10) {
            Text(title).font(Face.sans(15)).foregroundStyle(Paper.fg).frame(width: 66, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(AvatarKit.swatches, id: \.self) { tone in
                        Button {
                            Haptic.pick()
                            set(part, .string(tone))
                        } label: {
                            Circle().fill(Color(css: tone) ?? .white).frame(width: 28, height: 28)
                                .overlay(Circle().strokeBorder(Color.primary.opacity(0.14), lineWidth: 1))
                                .overlay(Circle().strokeBorder(Paper.accent, lineWidth: 2.5).padding(-4).opacity(current == tone ? 1 : 0))
                                .padding(4)
                        }
                        .buttonStyle(PressStyle(scale: 0.9))
                        .accessibilityLabel("Kolor \(tone)")
                    }
                }
                .padding(.vertical, 6)
            }
            ColorPicker("Własny kolor", selection: Binding(get: { Color(css: current) ?? .white }, set: { set(part, .string(AvatarKit.hex($0))) }), supportsOpacity: false).labelsHidden()
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
    }

    @ViewBuilder private var shape: some View {
        let cfg = avatar["cfg"]
        switch kind {
        case "buzka":
            choice("Oczy", "eye", [("pill", "pigułki"), ("round", "okrągłe"), ("square", "kwadratowe")], cfg["eye"].string ?? "pill")
            slider("Rozstaw", "gap", 9...24, 1, cfg["gap"].double ?? 13).hairline()
            choice("Usta", "mouth", [("none", "brak"), ("line", "kreska"), ("smile", "uśmiech"), ("o", "kółko")], cfg["mouth"].string ?? "none").hairline()
        case "piksel":
            pixelPad
        default:
            slider("Satelity", "sats", 0...3, 1, cfg["sats"].double ?? 1)
            slider("Nachylenie", "tilt", -50...50, 2, cfg["tilt"].double ?? -24).hairline()
        }
    }

    private func slider(_ title: String, _ part: String, _ range: ClosedRange<Double>, _ step: Double, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(Face.sans(15, .medium)).foregroundStyle(Paper.fg)
                Spacer()
                Text("\(Int(value))").font(Face.round(14)).foregroundStyle(Paper.muted)
            }
            Slider(value: Binding(get: { value }, set: { fresh in
                if fresh != value { set(part, .number(fresh)) }
            }), in: range, step: step).tint(Paper.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func choice(_ title: String, _ part: String, _ options: [(String, String)], _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(Face.sans(15, .medium)).foregroundStyle(Paper.fg)
            Picker(title, selection: Binding(get: { value }, set: { set(part, .string($0)) })) {
                ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var pixelPad: some View {
        let stored = avatar["cfg"]["px"].array.compactMap(\.string), rows = stored.count == 8 ? stored : AvatarKit.pixels
        let puck = Color(css: avatar["cfg"]["pk"].string) ?? .white, ink = Color(css: avatar["cfg"]["ink"].string) ?? .black, accent = Color(css: avatar["cfg"]["acc"].string) ?? Paper.accent
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Piksele").font(Face.sans(15, .medium)).foregroundStyle(Paper.fg)
                Spacer()
                Text("Rysuj palcem po siatce").font(Face.sans(13)).foregroundStyle(Paper.muted)
            }
            Picker("Pędzel", selection: $brush) {
                ForEach([(".", "gumka"), ("1", "piksel"), ("2", "oko"), ("3", "usta"), ("4", "akcent")], id: \.0) { Text($0.1).tag(Character($0.0)) }
            }
            .pickerStyle(.segmented)
            GeometryReader { box in
                let cell = box.size.width / 8
                Canvas { context, _ in
                    context.fill(Path(roundedRect: CGRect(origin: .zero, size: box.size), cornerRadius: 14), with: .color(puck))
                    for (y, row) in rows.enumerated() {
                        for (x, mark) in row.prefix(8).enumerated() {
                            let rect = CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell, height: cell).insetBy(dx: 1.5, dy: 1.5)
                            if "1234".contains(mark) {
                                context.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(mark == "1" || mark == "2" ? ink : accent))
                                if mark == "2" || mark == "4" { context.fill(Path(ellipseIn: rect.insetBy(dx: cell * 0.32, dy: cell * 0.32)), with: .color(puck.opacity(0.85))) }
                            } else {
                                context.stroke(Path(roundedRect: rect, cornerRadius: 4), with: .color(ink.opacity(0.12)), lineWidth: 1)
                            }
                        }
                    }
                }
                .gesture(DragGesture(minimumDistance: 0).onChanged { touch in
                    let x = Int(touch.location.x / cell), y = Int(touch.location.y / cell)
                    guard (0..<8).contains(x), (0..<8).contains(y) else { return }
                    var grid = rows.map { Array($0.padding(toLength: 8, withPad: ".", startingAt: 0)) }
                    guard grid[y][x] != brush else { return }
                    grid[y][x] = brush
                    Haptic.pick()
                    set("px", .array(grid.map { JSON.string(String($0)) }))
                })
            }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 300)
            .frame(maxWidth: .infinity)
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Paper.line, lineWidth: 1).frame(maxWidth: 300).allowsHitTesting(false))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func save() {
        let typed = name.trimmingCharacters(in: .whitespaces)
        saving = true
        Task {
            let body: JSON = ["agent": ["key": .string(key), "name": .string(typed.isEmpty ? model.agent(key)["name"].text : typed), "avatar": avatar]]
            if let reply = try? await model.call("/api/settings", body), !reply["settings"].isNull {
                model.settings = reply["settings"]
                Haptic.done()
                model.say("Zapisane")
                dismiss()
            } else {
                Haptic.fail()
                model.say("Nie udało się zapisać")
            }
            saving = false
        }
    }
}

struct WatchList: View {
    @Environment(AppModel.self) private var model
    @State private var fresh = ""

    private var names: [String] { model.settings["whatsapp"]["watch"].array.compactMap(\.string) }

    var body: some View {
        List {
            Section {
                ForEach(names, id: \.self) { name in
                    Text(name).font(Face.sans(16)).foregroundStyle(Paper.fg)
                        .swipeActions { Button("Usuń") { store(names.filter { $0 != name }) }.tint(Paper.muted) }
                }
                HStack {
                    TextField("Nazwa rozmowy", text: $fresh).font(Face.sans(16)).submitLabel(.done).autocorrectionDisabled().onSubmit(add)
                    Button("Dodaj", action: add).font(Face.sans(16, .semibold)).tint(Paper.accent).disabled(fresh.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } footer: {
                Text("Valet czyta te rozmowy na bieżąco i sam mówi, gdy pojawi się coś, co Ciebie dotyczy. Nazwa musi być taka sama jak w WhatsAppie. Przesuń w lewo, żeby usunąć.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Paper.bg)
        .navigationTitle("Pilnowane rozmowy")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func add() {
        let name = fresh.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !names.contains(name) else { return }
        fresh = ""
        Haptic.tap()
        store(names + [name])
    }

    private func store(_ list: [String]) {
        model.save(["whatsapp": ["watch": .array(list.map(JSON.string))]])
    }
}
