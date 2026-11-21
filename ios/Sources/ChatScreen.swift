// The one screen of the app: the thread with its top bar, the bar of decisions that wait for the owner, the writing field, the side panel and the voice conversation.
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Paper.bg.ignoresSafeArea()
            if model.paired { ChatScreen() } else { PairView() }
        }
    }
}

struct PairView: View {
    @Environment(AppModel.self) private var model
    @State private var key = ""

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            AvatarView(avatar: ["type": "orbita", "cfg": ["pk": "#1d1c19", "ink": "#ffffff", "acc": "#ffffff", "sats": 3, "tilt": -24]], size: 96)
            Text("Valet").font(Face.serif(34, .semibold)).foregroundStyle(Paper.fg)
            Text("Wklej klucz dostępu z ustawień Valeta, żeby połączyć tę apkę.").font(Face.sans(15)).foregroundStyle(Paper.muted).multilineTextAlignment(.center).padding(.horizontal, 36)
            SecureField("Klucz dostępu", text: $key)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(Face.sans(16))
                .padding(.horizontal, 16)
                .frame(height: 50)
                .background(Paper.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
                .padding(.horizontal, 28)
            Button("Połącz") { model.pair(key) }
                .buttonStyle(PillStyle(solid: true, height: 48))
                .disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).count < 16)
            Spacer()
            Spacer()
        }
    }
}

enum Route: String, Identifiable {
    case tasks, files, memory, reminders, settings
    var id: String { rawValue }
}

struct ChatScreen: View {
    @Environment(AppModel.self) private var model
    @State private var voice = VoiceCenter()
    @State private var open = false
    @GestureState private var pull: CGFloat = 0
    @State private var route: Route?
    @State private var showPending = false
    @State private var searching = false
    @State private var jump: String?
    @State private var focusRequest = 0

    private let width: CGFloat = 304

    var body: some View {
        let shift = max(-width, min(0, (open ? 0 : -width) + pull)), progress = 1 + shift / width
        ThreadList(jump: $jump) {
            nav
        } bottom: {
            BottomBar(voice: voice, showPending: $showPending, focusRequest: focusRequest)
        }
        .simultaneousGesture(DragGesture(minimumDistance: 24).updating($pull) { value, state, _ in
            guard !open, value.startLocation.x < 230, value.translation.width > 0, value.translation.width > abs(value.translation.height) * 1.7 else { return }
            state = value.translation.width
        }.onEnded { value in
            guard !open, value.startLocation.x < 230, value.translation.width > abs(value.translation.height) * 1.7 else { return }
            if value.translation.width > 80 || value.predictedEndTranslation.width > 220 { show(true) }
        })
        .overlay {
            if progress > 0.001 {
                Paper.scrim.opacity(0.36 * progress).ignoresSafeArea()
                    .onTapGesture { show(false) }
                    .accessibilityLabel("Zamknij panel")
            }
        }
        .overlay(alignment: .leading) {
            PanelView(onRoute: { next in
                show(false)
                route = next
            }, onPending: {
                show(false)
                showPending = true
            })
            .frame(width: width)
            .frame(maxHeight: .infinity)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: 30, topTrailingRadius: 30, style: .continuous)
                    .fill(Paper.bg)
                    .shadow(color: .black.opacity(0.18 * progress), radius: 30, x: 10)
                    .ignoresSafeArea()
            }
            .offset(x: shift)
            .gesture(DragGesture(minimumDistance: 10).updating($pull) { value, state, _ in state = min(0, value.translation.width) }.onEnded { value in
                if value.translation.width < -70 || value.predictedEndTranslation.width < -160 { show(false) }
            })
            .accessibilityHidden(!open)
        }
        .animation(Motion.move, value: open)
        .animation(pull == 0 ? Motion.move : nil, value: pull)
        .overlay(alignment: .top) { toast }
        .sheet(item: $route) { PanelSheet(route: $0).environment(model) }
        .sheet(isPresented: $showPending) { PendingSheet().environment(model) }
        .sheet(isPresented: $searching) {
            SearchSheet { id in jump = "m-\(id)" }.environment(model)
        }
        .fullScreenCover(isPresented: Binding(get: { voice.presented }, set: { voice.presented = $0 })) {
            VoiceCover(voice: voice) {
                voice.end()
                focusRequest += 1
            }
            .environment(model)
        }
        .onChange(of: model.pending.isEmpty) { _, none in if none { showPending = false } }
        .task { await rehearse() }
    }

    private func rehearse() async {
        let env = ProcessInfo.processInfo.environment
        guard env["VALET_OPEN"] != nil || env["VALET_JUMP"] != nil else { return }
        try? await Task.sleep(for: .seconds(2.5))
        if let id = env["VALET_JUMP"] { jump = "m-\(id)" }
        switch env["VALET_OPEN"] ?? "" {
        case "panel": open = true
        case "pending": showPending = true
        case "search": searching = true
        case "voice": await voice.start(model)
        case "cover": voice.presented = true
        case "type": focusRequest += 1
        case let name: route = Route(rawValue: name)
        }
    }

    private func show(_ value: Bool) {
        if value != open { Haptic.tap() }
        if value { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
        open = value
    }

    private var nav: some View {
        HStack(spacing: 0) {
            Button { show(true) } label: {
                MenuGlyph().stroke(Paper.fg, style: StrokeStyle(lineWidth: 1.9, lineCap: .round)).frame(width: 20, height: 12).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Panel")
            Spacer(minLength: 0)
            Button { show(true) } label: {
                HStack(spacing: 9) {
                    AvatarView(avatar: model.agent("valet")["avatar"], state: model.state, size: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(model.agent("valet")["name"].string ?? "Valet").font(Face.serif(18, .semibold)).foregroundStyle(Paper.fg)
                        if !model.online { Text("Łączenie").font(Face.sans(11.5)).foregroundStyle(Paper.muted).transition(.opacity) }
                    }
                }
            }
            .buttonStyle(PressStyle(scale: 0.97))
            .animation(Motion.snap, value: model.online)
            Spacer(minLength: 0)
            Button { searching = true } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 18, weight: .medium)).foregroundStyle(Paper.fg).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Szukaj w rozmowie")
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
    }

    @ViewBuilder private var toast: some View {
        if !model.notice.isEmpty {
            Text(model.notice)
                .font(Face.sans(14, .medium))
                .foregroundStyle(Paper.onInk)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Paper.ink, in: Capsule())
                .padding(.top, 54)
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(10)
        }
    }
}

struct MenuGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + 1))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + 1))
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY - 1))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.62, y: rect.maxY - 1))
        return path
    }
}

struct ThreadList<Top: View, Bottom: View>: View {
    @Binding var jump: String?
    @ViewBuilder var top: Top
    @ViewBuilder var bottom: Bottom
    @Environment(AppModel.self) private var model
    @State private var nearBottom = true
    @State private var settled = false
    @State private var unseen = 0
    @State private var window = 36
    @State private var flash = ""

    var body: some View {
        let all = Row.build(model.messages, model.outgoing)
        let rows = Array(all.suffix(window))
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if rows.count < all.count || model.hasMore {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
                            .onScrollVisibilityChange(threshold: 0.6) { seen in
                                if seen, settled { grow(proxy, keep: rows.first?.id) }
                            }
                    }
                    if all.isEmpty, model.booted {
                        VStack(spacing: 10) {
                            Text("Napisz albo powiedz, czego potrzebujesz.").font(Face.serif(19)).foregroundStyle(Paper.fg).multilineTextAlignment(.center)
                            Text("Valet odpowie tutaj i sam się odezwie, gdy coś będzie ważne.").font(Face.sans(14)).foregroundStyle(Paper.muted).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 120)
                        .padding(.horizontal, 24)
                    }
                    ForEach(rows) { row in
                        RowView(row: row)
                            .background { RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Paper.tint.opacity(row.id == flash ? 1 : 0)).padding(-8) }
                            .padding(.top, row.gap)
                            .id(row.id)
                    }
                    if model.working {
                        WorkRow(text: model.statusText).padding(.top, 16).transition(.opacity)
                    }
                    Color.clear.frame(height: 18).id("end")
                }
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .animation(Motion.snap, value: model.working)
                .animation(.easeInOut(duration: 0.35), value: flash)
                .overlay(alignment: .bottom) {
                    Color.clear.frame(height: 240).allowsHitTesting(false)
                        .onScrollVisibilityChange(threshold: 0.02) { seen in
                            nearBottom = seen
                            if seen { unseen = 0 }
                        }
                }
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .safeAreaInset(edge: .top, spacing: 0) {
                top
                    .background(Paper.bg.ignoresSafeArea(.container, edges: .top))
                    .overlay(alignment: .bottom) {
                        LinearGradient(colors: [Paper.bg, Paper.bg.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 14).offset(y: 14).allowsHitTesting(false)
                    }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                bottom.overlay(alignment: .top) {
                    if !nearBottom {
                        Button {
                            Haptic.tap()
                            withAnimation(Motion.move) { proxy.scrollTo("end", anchor: .bottom) }
                        } label: {
                            HStack(spacing: 6) {
                                if unseen > 0 { Text("\(unseen)").font(Face.round(13, .bold)) }
                                Image(systemName: "arrow.down").font(.system(size: 14, weight: .bold))
                            }
                            .foregroundStyle(Paper.fg)
                            .padding(.horizontal, unseen > 0 ? 13 : 0)
                            .frame(minWidth: 38, minHeight: 38)
                            .background(Paper.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(Paper.line, lineWidth: 1))
                            .shadow(color: .black.opacity(0.14), radius: 10, y: 5)
                        }
                        .buttonStyle(PressStyle(scale: 0.92))
                        .offset(y: -58)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                        .accessibilityLabel("Przewiń na dół")
                    }
                }
                .animation(Motion.snap, value: nearBottom)
            }
            .onChange(of: model.arrived) { _, _ in
                if nearBottom || !model.outgoing.isEmpty || model.messages.last?.mine == true {
                    withAnimation(Motion.move) { proxy.scrollTo("end", anchor: .bottom) }
                } else {
                    unseen += 1
                }
            }
            .onChange(of: model.working) { _, _ in
                if nearBottom { withAnimation(Motion.move) { proxy.scrollTo("end", anchor: .bottom) } }
            }
            .onChange(of: jump) { _, target in
                guard let target else { return }
                jump = nil
                if let index = all.firstIndex(where: { $0.id == target }) { window = max(window, all.count - index + 8) }
                Task {
                    try? await Task.sleep(for: .milliseconds(80))
                    withAnimation(Motion.move) { proxy.scrollTo(target, anchor: .center) }
                    flash = target
                    try? await Task.sleep(for: .seconds(1.4))
                    if flash == target { flash = "" }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                guard nearBottom else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    withAnimation(Motion.move) { proxy.scrollTo("end", anchor: .bottom) }
                }
            }
            .task {
                try? await Task.sleep(for: .seconds(1))
                settled = true
            }
        }
    }

    private func grow(_ proxy: ScrollViewProxy, keep: String?) {
        Task {
            if window < model.messages.count + model.outgoing.count + 8 {
                window += 36
            } else if model.hasMore, !model.loadingOlder {
                await model.loadOlder()
                window += 60
            } else {
                return
            }
            guard let keep else { return }
            try? await Task.sleep(for: .milliseconds(16))
            proxy.scrollTo(keep, anchor: .top)
        }
    }
}

struct BottomBar: View {
    let voice: VoiceCenter
    @Binding var showPending: Bool
    let focusRequest: Int
    @Environment(AppModel.self) private var model
    @State private var text = UserDefaults.standard.string(forKey: "draft") ?? ""
    @State private var picks: [Pick] = []
    @FocusState private var typing: Bool

    var body: some View {
        let waiting = model.pending.count
        VStack(spacing: 8) {
            if voice.running, !voice.presented {
                Button { voice.presented = true } label: {
                    HStack(spacing: 9) {
                        PulseDot()
                        Text("Rozmowa trwa").font(Face.sans(14.5, .semibold))
                        Spacer()
                        Text("Wróć").font(Face.sans(14.5, .semibold))
                    }
                    .foregroundStyle(Paper.onInk)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Paper.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .padding(.horizontal, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if waiting > 0, !typing {
                Button {
                    Haptic.tap()
                    showPending = true
                } label: {
                    HStack(spacing: 10) {
                        Text("\(waiting)").font(Face.round(13, .bold)).foregroundStyle(Paper.onAccent).frame(minWidth: 26, minHeight: 26).background(Paper.accent, in: Capsule())
                            .contentTransition(.numericText())
                        Text(waiting == 1 ? "Czeka na Twoją decyzję" : "Czekają na Twoją decyzję").font(Face.sans(14.5, .semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).opacity(0.7)
                    }
                    .foregroundStyle(Paper.tintFg)
                    .padding(.leading, 10)
                    .padding(.trailing, 14)
                    .frame(height: 46)
                    .background(Paper.tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .padding(.horizontal, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            Composer(text: $text, picks: $picks, focus: $typing) {
                Haptic.press()
                Task { await voice.start(model) }
            }
        }
        .padding(.top, 4)
        .padding(.bottom, 8)
        .background(Paper.bg.ignoresSafeArea(.container, edges: .bottom))
        .overlay(alignment: .top) {
            LinearGradient(colors: [Paper.bg.opacity(0), Paper.bg], startPoint: .top, endPoint: .bottom).frame(height: 26).offset(y: -26).allowsHitTesting(false)
        }
        .animation(Motion.snap, value: waiting)
        .animation(Motion.snap, value: typing)
        .animation(Motion.snap, value: voice.running && !voice.presented)
        .onChange(of: focusRequest) { _, _ in typing = true }
        .onChange(of: text) { _, fresh in UserDefaults.standard.set(fresh, forKey: "draft") }
    }
}

struct VoiceCover: View {
    let voice: VoiceCenter
    let onType: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Paper.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Button { voice.presented = false } label: {
                        Image(systemName: "chevron.down").font(.system(size: 18, weight: .semibold)).foregroundStyle(Paper.fg).frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("Zwiń rozmowę")
                    Spacer()
                }
                .padding(.horizontal, 8)
                Spacer()
                Button { voice.interrupt() } label: {
                    ZStack {
                        Circle().stroke(Paper.accent.opacity(0.28), lineWidth: 1.5).frame(width: 148, height: 148).scaleEffect(1.12 + min(0.5, voice.level * 4))
                        Circle().stroke(Paper.accent.opacity(0.14), lineWidth: 1.5).frame(width: 148, height: 148).scaleEffect(1.26 + min(0.8, voice.level * 7))
                        AvatarView(avatar: model.agent("valet")["avatar"], state: voice.mood, size: 148)
                    }
                    .animation(.easeOut(duration: 0.12), value: voice.level)
                }
                .buttonStyle(PressStyle(scale: 0.97))
                .accessibilityLabel("Przerwij Valetowi")
                Text(voice.label).font(Face.serif(26, .medium)).foregroundStyle(Paper.fg).padding(.top, 34)
                    .contentTransition(.opacity).animation(.easeInOut(duration: 0.2), value: voice.label)
                Text(voice.muted ? "Mikrofon jest wyciszony." : voice.state == "connecting" ? "Chwilę, łączę. Możesz już mówić." : "Mów śmiało. Stuknij Valeta, żeby mu przerwać.").font(Face.sans(14.5)).foregroundStyle(Paper.muted).multilineTextAlignment(.center).frame(maxWidth: 260).padding(.top, 10)
                Spacer()
                Spacer()
                HStack(alignment: .top, spacing: 30) {
                    control(voice.muted ? "mic.slash.fill" : "mic.slash", voice.muted ? "Włącz" : "Wycisz", on: voice.muted) { voice.toggleMute() }
                    Button {
                        Haptic.press()
                        voice.end()
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "xmark").font(.system(size: 24, weight: .semibold)).foregroundStyle(Paper.onInk).frame(width: 74, height: 74).background(Paper.ink, in: Circle())
                            Text("Zakończ").font(Face.sans(12.5, .medium)).foregroundStyle(Paper.muted)
                        }
                    }
                    .buttonStyle(PressStyle(scale: 0.93))
                    .offset(y: -8)
                    control("keyboard", "Pisz", on: false) { onType() }
                }
                .padding(.bottom, 34)
            }
        }
    }

    private func control(_ symbol: String, _ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 21, weight: .medium)).foregroundStyle(on ? Paper.onAccent : Paper.fg).frame(width: 58, height: 58).background(on ? Paper.accent : Paper.soft, in: Circle())
                Text(title).font(Face.sans(12.5, .medium)).foregroundStyle(Paper.muted)
            }
        }
        .buttonStyle(PressStyle(scale: 0.93))
    }
}

struct PendingSheet: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let list = model.pending
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 9) {
                    Text("Czeka na Ciebie").font(Face.serif(22, .semibold)).foregroundStyle(Paper.fg)
                    Text("\(list.count)").font(Face.round(12.5, .bold)).foregroundStyle(Paper.onAccent).frame(minWidth: 24, minHeight: 24).background(Paper.accent, in: Capsule())
                        .contentTransition(.numericText())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .padding(.top, 22)
                if list.isEmpty { Text("Nic teraz nie czeka na Twoją decyzję.").font(Face.serif(16.5)).foregroundStyle(Paper.muted).padding(.horizontal, 4) }
                ForEach(list) { message in
                    CardView(message: message).transition(.asymmetric(insertion: .opacity, removal: .scale(scale: 0.95).combined(with: .opacity)))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .animation(Motion.move, value: list.map(\.id))
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Paper.bg)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
        .presentationBackground(Paper.bg)
    }
}

struct SearchSheet: View {
    let onPick: (Int) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool

    private var hits: [Message] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard needle.count >= 2 else { return [] }
        return model.messages.reversed().filter { $0.text.lowercased().contains(needle) }.prefix(40).map { $0 }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Paper.muted)
                TextField("Szukaj w rozmowie", text: $query).font(Face.sans(16.5)).focused($focused).submitLabel(.search).autocorrectionDisabled()
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Paper.faint) } }
            }
            .padding(.horizontal, 14)
            .frame(height: 46)
            .background(Paper.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
            .overlay(alignment: .trailing) {
                Button("Anuluj") { dismiss() }.font(Face.sans(16)).tint(Paper.accent).offset(x: 78)
            }
            .padding(.leading, 16)
            .padding(.trailing, 94)
            .padding(.top, 22)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(hits) { m in
                        Button {
                            onPick(m.id)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(m.mine ? model.owner : model.agent(m.agent)["name"].string ?? "Valet") · \(When.stamp.string(from: When.date(m.ts)))").font(Face.sans(12, .medium)).foregroundStyle(Paper.muted)
                                Text(m.text).font(Face.sans(15)).foregroundStyle(Paper.fg).lineLimit(3).multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 11)
                            .hairline(.bottom)
                        }
                        .buttonStyle(.plain)
                    }
                    if hits.isEmpty {
                        Text(query.count < 2 ? "Wpisz co najmniej dwie litery." : "Nic nie znalazłem w wczytanej części rozmowy.").font(Face.sans(14)).foregroundStyle(Paper.muted).padding(.top, 24).frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
            }
        }
        .background(Paper.bg)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
        .presentationBackground(Paper.bg)
        .onAppear { focused = true }
    }
}
