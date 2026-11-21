// Cards in the thread: weather, briefs, background tasks, calendar, WhatsApp drafts, Claude Code sessions and their questions, films, videos, pictures, recipes and skills.
import SwiftUI

struct CardView: View {
    let message: Message
    @Environment(AppModel.self) private var model

    var body: some View {
        let m = message, d = m.data
        switch m.kind {
        case "sky": CardShell { SkyView(sky: d["sky"]).padding(14) }
        case "brief": BriefCard(message: m)
        case "task": TaskCard(task: model.tasks.first { $0.id == d["task"].int } ?? TaskItem(raw: ["id": d["task"], "title": .string(m.text), "status": "done", "agent": .string(m.agent)]))
        case "agenda": AgendaCard(agenda: d["agenda"])
        case "event": EventCard(message: m)
        case "wa": DraftCard(message: m)
        case "code": SessionCard(message: m)
        case "ask": AskCard(message: m)
        case "recipe": RecipeCard(recipe: d["recipe"])
        case "skill": SkillCard(message: m)
        case "videos": VideosCard(message: m)
        case "title": FilmCard(title: d["title"])
        case "titles": ShelfCard(message: m)
        case "image": PictureCard(message: m)
        default: EmptyView()
        }
    }
}

struct QuoteBox<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 13)
            .padding(.vertical, 10)
            .background(Paper.me, in: UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 5, topTrailingRadius: 16, style: .continuous))
            .padding(.horizontal, 14)
            .padding(.top, 10)
    }
}

struct CodeBlock: View {
    let text: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(Paper.fg).padding(10).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Paper.soft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct SkyView: View {
    let sky: JSON

    private static let night: [Double] = [20, 26, 51], glow: [Double] = [243, 200, 166], clear: [Double] = [134, 196, 239], grey: [Double] = [164, 176, 188]

    private static func mix(_ a: [Double], _ b: [Double], _ k: Double) -> [Double] { zip(a, b).map { $0 + ($1 - $0) * k } }

    private func tone(_ hour: Double, _ cloud: Double) -> Color {
        let rise = sky["rise"].double ?? 7, set = sky["set"].double ?? 16
        let day = SkyView.mix(SkyView.clear, SkyView.grey, min(1, cloud / 100))
        let edge = min(abs(hour - rise), abs(hour - set))
        var rgb = day
        if hour < rise - 0.9 || hour > set + 0.9 { rgb = SkyView.night }
        else if edge <= 0.9 { rgb = hour < rise || hour > set ? SkyView.mix(SkyView.glow, SkyView.night, edge / 0.9) : SkyView.mix(SkyView.glow, day, edge / 0.9) }
        return Color(red: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255)
    }

    var body: some View {
        let hours = sky["hours"].array.compactMap(\.double), temp = sky["temp"].array.compactMap(\.double), rain = sky["rain"].array.compactMap(\.double), cloud = sky["cloud"].array.compactMap(\.double)
        let n = max(2, hours.count), low = temp.min() ?? 0, span = max(1, (temp.max() ?? 1) - low)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(Int((sky["now"].double ?? sky["max"].double ?? 0).rounded()))°").font(Face.round(34, .semibold)).foregroundStyle(Paper.fg)
                Text([sky["city"].text, sky["note"].text].filter { !$0.isEmpty }.joined(separator: " · ")).font(Face.sans(13.5)).foregroundStyle(Paper.muted).lineLimit(2)
                Spacer(minLength: 4)
                Text("\(sky["min"].int ?? 0)° / \(sky["max"].int ?? 0)°").font(Face.round(14)).foregroundStyle(Paper.muted)
            }
            GeometryReader { box in
                let w = box.size.width, h = box.size.height
                let x: (Int) -> CGFloat = { CGFloat($0) / CGFloat(n - 1) * w }
                let y: (Double) -> CGFloat = { CGFloat(24 - (($0 - low) / span) * 17) / 30 * h }
                ZStack(alignment: .topLeading) {
                    LinearGradient(stops: hours.enumerated().map { Gradient.Stop(color: tone($0.element, $0.offset < cloud.count ? cloud[$0.offset] : 0), location: CGFloat($0.offset) / CGFloat(n - 1)) }, startPoint: .leading, endPoint: .trailing)
                    ForEach(Array(rain.enumerated()).filter { $0.element >= 50 }, id: \.offset) { item in
                        Rectangle().fill(.white.opacity(0.22)).frame(width: w / CGFloat(n - 1) + 2, height: h).offset(x: x(item.offset) - w / CGFloat(n - 1) / 2)
                    }
                    Path { path in
                        for (i, t) in temp.enumerated() {
                            let p = CGPoint(x: x(i), y: y(t))
                            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
                        }
                    }
                    .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    if let at = sky["at"].int, at >= 0, at < temp.count {
                        Circle().fill(.white).frame(width: 9, height: 9).overlay(Circle().stroke(.black.opacity(0.25), lineWidth: 1)).position(x: x(at), y: y(temp[at]))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .frame(height: 62)
            GeometryReader { box in
                ForEach(Array(hours.enumerated()).filter { Int($0.element) % 3 == 0 }, id: \.offset) { item in
                    Text("\(Int(item.element))").font(Face.round(11, .medium)).foregroundStyle(Paper.muted)
                        .position(x: min(box.size.width - 8, max(8, CGFloat(item.offset) / CGFloat(n - 1) * box.size.width)), y: 7)
                }
            }
            .frame(height: 14)
        }
    }
}

struct BriefCard: View {
    let message: Message

    var body: some View {
        let d = message.data
        CardShell {
            VStack(alignment: .leading, spacing: 12) {
                Text(d["title"].string ?? "Brief").font(Face.serif(21, .semibold)).foregroundStyle(Paper.fg)
                if !message.text.isEmpty { RichText(text: message.text, size: 16.5) }
                if !d["agenda"].isNull { AgendaView(agenda: d["agenda"], empty: false) }
                if !d["sky"].isNull { SkyView(sky: d["sky"]) }
                let week = d["week"].array
                if !week.isEmpty {
                    HStack(spacing: 0) {
                        ForEach(Array(week.enumerated()), id: \.offset) { _, day in
                            VStack(spacing: 4) {
                                Text(When.key.date(from: day["day"].text).map { When.weekdayShort.string(from: $0) } ?? "").font(Face.sans(11.5)).foregroundStyle(Paper.muted)
                                Text("\(day["max"].int ?? 0)°").font(Face.round(15))
                                Text("\(day["min"].int ?? 0)°").font(Face.round(12.5, .medium)).foregroundStyle(Paper.muted)
                                Capsule().fill(Paper.accent.opacity(0.15 + 0.85 * (day["rain"].double ?? 0) / 100)).frame(width: 18, height: 4)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .padding(16)
        }
    }
}

struct TaskCard: View {
    let task: TaskItem
    var full = false
    @Environment(AppModel.self) private var model

    var body: some View {
        CardShell {
            HStack(spacing: 11) {
                AvatarView(avatar: model.agent(task.agent)["avatar"], state: task.running ? "working" : task.status == "done" ? "idle" : "sleeping", size: 34, animated: task.running)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title).font(Face.sans(15, .semibold)).foregroundStyle(Paper.fg).lineLimit(2)
                    Text(detail).font(Face.sans(13)).foregroundStyle(Paper.muted).lineLimit(2).contentTransition(.opacity)
                }
                Spacer(minLength: 4)
                if task.running {
                    Button("Przerwij") {
                        Haptic.tap()
                        model.cancel(task: task.id)
                    }
                    .buttonStyle(PillStyle(height: 34))
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
        }
    }

    private var detail: String {
        guard full, !task.running else { return task.line }
        return [task.line, task.usd > 0 ? "\(money(task.usd)) USD" : "", task.updated > 0 ? When.stamp.string(from: When.date(task.updated)) : ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct CalendarEvent: Identifiable, Hashable {
    let raw: JSON
    var id: String { "\(raw["id"].text)-\(start)" }
    var title: String { raw["title"].text }
    var start: Double { raw["start"].double ?? 0 }
    var end: Double { raw["end"].double ?? start }
    var allDay: Bool { raw["allDay"].bool ?? false }
    var place: String { raw["location"].text }
    var cal: String { raw["cal"].text }
    var tint: Color { Color(css: raw["color"].string) ?? Paper.accent }
    var last: Double { end > start ? end - 1 : start }
    var sub: String { [place, cal].filter { !$0.isEmpty }.joined(separator: " · ") }

    var span: String {
        let first = When.key.string(from: When.date(start)), final = When.key.string(from: When.date(last))
        if allDay { return first == final ? "\(When.dayLong.string(from: When.date(start))) · cały dzień" : "\(When.dayShort.string(from: When.date(start))) do \(When.dayShort.string(from: When.date(last))) · całe dni" }
        if first == final { return "\(When.dayLong.string(from: When.date(start))) · \(When.time(start))–\(When.time(end))" }
        return "\(When.dayShort.string(from: When.date(start))) \(When.time(start)) do \(When.dayShort.string(from: When.date(end))) \(When.time(end))"
    }
}

struct AgendaView: View {
    let agenda: JSON
    var empty = true

    private var days: [(key: String, events: [CalendarEvent])] {
        let count = max(1, agenda["days"].int ?? 1), events = agenda["events"].array.map(CalendarEvent.init)
        guard let from = When.key.date(from: agenda["from"].text) else { return [] }
        var out: [(String, [CalendarEvent])] = []
        for i in 0..<count {
            let key = When.key.string(from: from.addingTimeInterval(Double(i) * 86400 + 43200))
            let list = events.filter { When.key.string(from: When.date($0.start)) <= key && When.key.string(from: When.date($0.last)) >= key }
            if list.isEmpty && (!empty || count > 7) { continue }
            out.append((key, list))
        }
        return out
    }

    var body: some View {
        let list = days, heads = (agenda["days"].int ?? 1) > 1
        VStack(alignment: .leading, spacing: 12) {
            ForEach(list, id: \.key) { day in
                VStack(alignment: .leading, spacing: 8) {
                    if heads, let date = When.key.date(from: day.key) {
                        Text(When.dayTitle(date.timeIntervalSince1970 * 1000 + 43_200_000)).font(Face.sans(13.5, .semibold)).foregroundStyle(Paper.fg)
                    }
                    let whole = day.events.filter(\.allDay), timed = day.events.filter { !$0.allDay }
                    if !whole.isEmpty {
                        ForEach(whole) { e in
                            Text(e.title).font(Face.sans(13.5, .medium)).padding(.horizontal, 10).padding(.vertical, 5)
                                .background(e.tint.opacity(0.16), in: Capsule()).foregroundStyle(Paper.fg)
                        }
                    }
                    ForEach(timed) { e in
                        let now = Date().timeIntervalSince1970 * 1000
                        HStack(spacing: 11) {
                            Capsule().fill(e.tint).frame(width: 4).frame(maxHeight: .infinity)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title).font(Face.sans(15, .semibold)).foregroundStyle(Paper.fg)
                                if !e.sub.isEmpty { Text(e.sub).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                            }
                            Spacer(minLength: 6)
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(When.key.string(from: When.date(e.start)) == day.key ? When.time(e.start) : "trwa").font(Face.round(14))
                                if When.key.string(from: When.date(e.last)) == day.key { Text(When.time(e.end)).font(Face.round(12, .medium)).foregroundStyle(Paper.muted) }
                            }
                            .foregroundStyle(Paper.fg)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(e.end <= now ? 0.5 : 1)
                    }
                    if day.events.isEmpty { Text("Nic w kalendarzu").font(Face.sans(14)).foregroundStyle(Paper.muted) }
                }
            }
        }
    }
}

struct AgendaCard: View {
    let agenda: JSON

    var body: some View {
        let days = agenda["days"].int ?? 1
        let from = When.key.date(from: agenda["from"].text) ?? Date()
        let label = days == 1 ? When.dayTitle(from.timeIntervalSince1970 * 1000 + 43_200_000).lowercased() : "\(When.dayShort.string(from: from)) do \(When.dayShort.string(from: from.addingTimeInterval(Double(days - 1) * 86400)))"
        CardShell {
            CardHead(symbol: "calendar", title: "Kalendarz", detail: label)
            AgendaView(agenda: agenda, empty: days <= 7).padding(14)
        }
    }
}

struct EventCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var busy = false
    @State private var failed = false

    var body: some View {
        let raw = message.data["event"], e = CalendarEvent(raw: raw), done = raw["done"].text, op = raw["op"].text
        let gone = done == "undone" || done == "deleted"
        let state = failed ? "Nie udało się, spróbuj jeszcze raz" : ["undone": "Cofnięte, wydarzenia nie ma w kalendarzu", "deleted": "Usunięte z kalendarza", "kept": "Zostaje w kalendarzu"][done] ?? ["added": "Dodane do kalendarza", "changed": "Zmienione w kalendarzu", "ask_delete": "Usunąć z kalendarza?"][op] ?? ""
        CardShell {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 0) {
                    Text(When.weekdayShort.string(from: When.date(e.start)).replacingOccurrences(of: ".", with: "").uppercased()).font(Face.sans(10.5, .bold)).foregroundStyle(e.tint)
                    Text(When.dayNumber.string(from: When.date(e.start))).font(Face.round(21)).foregroundStyle(Paper.fg)
                }
                .frame(width: 46, height: 48)
                .background(e.tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.title).font(Face.sans(15.5, .semibold)).foregroundStyle(Paper.fg).strikethrough(gone, color: Paper.muted)
                    Text(e.span).font(Face.sans(13)).foregroundStyle(Paper.muted)
                    if !e.sub.isEmpty { Text(e.sub).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.top, 13)
            .opacity(gone ? 0.6 : 1)
            CardFoot(state: state, failed: failed) {
                if done.isEmpty, op == "added" { Button("Cofnij") { run("undo") }.buttonStyle(PillStyle(height: 36)) }
                if done.isEmpty, op == "ask_delete" {
                    Button("Zostaw") { run("keep") }.buttonStyle(PillStyle(height: 36))
                    Button("Usuń") { run("delete") }.buttonStyle(PillStyle(solid: true, height: 36))
                }
            }
            .disabled(busy)
        }
    }

    private func run(_ act: String) {
        Haptic.press()
        busy = true
        Task {
            failed = !(await model.act("/api/calendar/act", on: message, ["act": .string(act)], key: "event"))
            busy = false
        }
    }
}

struct DraftCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var busy = false
    @FocusState private var editing: Bool

    var body: some View {
        let w = message.data["wa"], state = w["state"].text
        let to: [JSON] = w["to"].array.isEmpty ? [["chat": w["chat"], "group": w["group"], "state": state == "sent" ? "sent" : "draft"]] : w["to"].array
        let names = to.map { $0["chat"].text }
        let whom = names.count > 1 ? "\(names.dropLast().joined(separator: ", ")) i \(names.last ?? "")" : "\(names.first ?? "")\(to.first?["group"].bool == true ? " (grupa)" : "")"
        let open = state == "draft" || state == "failed", partly = to.contains { $0["state"].text == "sent" }
        let time = w["sentAt"].double.map { When.time($0) } ?? ""
        let line = busy ? "Wysyłam" : ["draft": "Stuknij Wyślij albo napisz „tak”", "sending": "Wysyłam", "sent": "Wysłane\(time.isEmpty ? "" : " o \(time)")", "dropped": "Odrzucone, nic nie wysłano", "failed": w["error"].string ?? "Nie udało się wysłać"][state] ?? ""
        CardShell {
            CardHead(symbol: "bubble.left", title: "WhatsApp", detail: "do: \(whom)")
            QuoteBox {
                if open && !partly {
                    TextField("Treść wiadomości", text: $text, axis: .vertical).font(Face.sans(15.5)).foregroundStyle(Paper.fg).focused($editing)
                } else {
                    Text(RichText.inline(w["text"].text)).font(Face.sans(15.5)).foregroundStyle(Paper.fg)
                }
                if !w["sign"].text.isEmpty { Text(RichText.inline(w["sign"].text)).font(Face.sans(12.5)).foregroundStyle(Paper.muted) }
            }
            CardFoot(state: line, failed: state == "failed" && !busy) {
                if open {
                    Button("Odrzuć") { run("drop") }.buttonStyle(PillStyle(height: 38))
                    Button(state == "failed" ? "Ponów" : to.count > 1 ? "Wyślij do \(to.count)" : "Wyślij") { run("send") }.buttonStyle(PillStyle(solid: true, height: 38))
                }
            }
            .disabled(busy)
        }
        .onAppear { text = w["text"].text }
        .onChange(of: w["text"].text) { _, fresh in if !editing { text = fresh } }
    }

    private func run(_ act: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if act == "send", body.isEmpty { return }
        Haptic.press()
        editing = false
        busy = true
        Task {
            let ok = await model.act("/api/whatsapp/act", on: message, ["act": .string(act), "text": .string(body)], key: "wa")
            busy = false
            if ok, act == "send" { Haptic.done() } else if !ok { model.say("Nie udało się połączyć z serwerem") }
        }
    }
}

struct SessionCard: View {
    let message: Message

    var body: some View {
        let c = message.data["code"], state = c["state"].text
        let minutes = c["minutes"].int ?? 0
        let line = ["queued": "Przekazane, ruszy po bieżącej turze", "working": "Przekazane, ruszy po bieżącej turze", "running": "Sesja pracuje", "done": "Sesja skończyła\(minutes > 0 ? " po \(minutes) min" : "")"][state] ?? "Przekazane"
        CardShell {
            CardHead(symbol: "terminal", title: "Claude Code", detail: "do sesji: \(c["title"].text)")
            QuoteBox { Text(RichText.inline(message.text)).font(Face.sans(15.5)).foregroundStyle(Paper.fg) }
            HStack(spacing: 7) {
                if state == "running" { PulseDot() }
                Text("\(line) · \(c["project"].text)").font(Face.sans(13)).foregroundStyle(Paper.muted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
    }
}

struct PulseDot: View {
    @State private var on = false

    var body: some View {
        Circle().fill(Paper.live).frame(width: 7, height: 7)
            .overlay(Circle().stroke(Paper.live.opacity(on ? 0 : 0.5), lineWidth: 6).scaleEffect(on ? 2.2 : 1))
            .onAppear { withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { on = true } }
    }
}

struct AskCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var picked: [String: Set<String>] = [:]
    @State private var busy = false

    private static let tools = ["Bash": "polecenie w terminalu", "Edit": "zmianę pliku", "Write": "zapis pliku", "NotebookEdit": "zmianę notatnika", "WebFetch": "pobranie strony", "WebSearch": "szukanie w sieci", "Read": "odczyt pliku"]

    var body: some View {
        let a = message.data["ask"], question = a["kind"].text == "question", state = a["state"].text, open = state == "open"
        let questions = a["questions"].array, alone = questions.count == 1 && questions[0]["multi"].bool != true
        let time = a["at"].double.map { When.time($0) } ?? ""
        let why = a["why"].text
        let gone = why == "local" ? "Rozstrzygnięte przy Macu" : why == "aborted" ? "Nieaktualne, sesja poszła dalej" : why.isEmpty ? "Nieaktualne" : why
        let line = ["open": question ? "Wybierz albo odpisz własnymi słowami" : "Stuknij albo napisz „pozwól”", "allowed": "Pozwolono\(time.isEmpty ? "" : " o \(time)")", "denied": "Odmówiono\(time.isEmpty ? "" : " o \(time)")", "answered": "Odpowiedź: \(a["reply"].text.isEmpty ? "wysłana" : a["reply"].text)", "gone": gone][state] ?? ""
        CardShell {
            CardHead(symbol: "terminal", title: "Claude Code", detail: "sesja: \(a["title"].text)")
            if question {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(questions.enumerated()), id: \.offset) { _, q in
                        VStack(alignment: .leading, spacing: 8) {
                            if !q["header"].text.isEmpty { Text(q["header"].text.uppercased()).font(Face.sans(11, .semibold)).kerning(0.5).foregroundStyle(Paper.muted) }
                            Text(q["question"].text).font(Face.serif(16.5)).foregroundStyle(Paper.fg)
                            ForEach(Array(q["options"].array.enumerated()), id: \.offset) { _, option in
                                let label = option["label"].text, on = picked[q["question"].text]?.contains(label) == true
                                Button {
                                    choose(q, label, alone: alone)
                                } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(label).font(Face.sans(15, .medium)).foregroundStyle(Paper.fg)
                                            if !option["description"].text.isEmpty { Text(option["description"].text).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                                        }
                                        Spacer(minLength: 4)
                                        Image(systemName: on ? "checkmark.circle.fill" : "chevron.right").font(.system(size: on ? 18 : 12, weight: .semibold)).foregroundStyle(on ? Paper.accent : Paper.faint)
                                    }
                                    .multilineTextAlignment(.leading)
                                    .padding(.horizontal, 13)
                                    .padding(.vertical, 11)
                                    .background(on ? Paper.tint : Color.clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(on ? Paper.accent.opacity(0.5) : Paper.line, lineWidth: 1))
                                }
                                .buttonStyle(PressStyle(scale: 0.98))
                                .disabled(!open || busy)
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)
            } else {
                let tool = a["tool"].text, parts = tool.components(separatedBy: "__")
                let what = AskCard.tools[tool] ?? (tool.hasPrefix("mcp__") && parts.count > 2 ? "narzędzie „\(parts.dropFirst(2).joined(separator: " ").replacingOccurrences(of: "_", with: " "))” (\(parts[1].replacingOccurrences(of: "_", with: " ")))" : tool)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Prosi o zgodę na \(what)\(a["agent"].bool == true ? " (pomocniczy agent)" : "")").font(Face.serif(16)).foregroundStyle(Paper.fg)
                    CodeBlock(text: a["summary"].text)
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
            CardFoot(state: "\(line) · \(a["project"].text)") {
                if open, !question {
                    Button("Odmów") { finish(["act": "deny"]) }.buttonStyle(PillStyle(height: 38))
                    Button("Pozwól") { finish(["act": "allow"]) }.buttonStyle(PillStyle(solid: true, height: 38))
                }
                if open, question, !alone {
                    Button("Wyślij odpowiedź") {
                        finish(["act": "answer", "answers": .object(Dictionary(uniqueKeysWithValues: questions.map { ($0["question"].text, JSON.string((picked[$0["question"].text] ?? []).sorted().joined(separator: ", "))) }))])
                    }
                    .buttonStyle(PillStyle(solid: true, height: 38))
                    .disabled(!questions.allSatisfy { !(picked[$0["question"].text] ?? []).isEmpty })
                }
            }
            .disabled(busy)
        }
    }

    private func choose(_ q: JSON, _ label: String, alone: Bool) {
        Haptic.pick()
        let key = q["question"].text
        var now = picked[key] ?? []
        if q["multi"].bool == true { if now.contains(label) { now.remove(label) } else { now.insert(label) } } else { now = [label] }
        picked[key] = now
        if alone { finish(["act": "answer", "answers": .object([key: .string(label)])]) }
    }

    private func finish(_ body: JSON) {
        Haptic.press()
        busy = true
        Task {
            if !(await model.act("/api/code/act", on: message, body, key: "ask")) { model.say("Nie udało się połączyć z serwerem") }
            busy = false
        }
    }
}

struct RecipeCard: View {
    let recipe: JSON
    @Environment(\.openURL) private var openURL
    @State private var done: Set<Int> = []

    var body: some View {
        CardShell {
            CardHead(symbol: "frying.pan", title: "Przepis", detail: [recipe["servings"].text, recipe["time"].text].filter { !$0.isEmpty }.joined(separator: " · "))
            VStack(alignment: .leading, spacing: 12) {
                Text(recipe["title"].text).font(Face.serif(20, .semibold)).foregroundStyle(Paper.fg)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(recipe["ingredients"].array.enumerated()), id: \.offset) { index, item in
                        let on = done.contains(index)
                        Button {
                            Haptic.pick()
                            if on { done.remove(index) } else { done.insert(index) }
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: 17)).foregroundStyle(on ? Paper.accent : Paper.faint)
                                (Text(item["amount"].text.isEmpty ? "" : "\(item["amount"].text) ").fontWeight(.semibold) + Text(item["item"].text))
                                    .font(Face.sans(15)).foregroundStyle(on ? Paper.muted : Paper.fg).strikethrough(on, color: Paper.muted).multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(Array(recipe["steps"].array.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(index + 1)").font(Face.round(13)).foregroundStyle(Paper.muted).frame(width: 18, alignment: .trailing)
                            Text(step.text).font(Face.serif(16)).foregroundStyle(Paper.fg).lineSpacing(3)
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, recipe["source"].text.isEmpty ? 14 : 0)
            if let url = URL(string: recipe["source"].text), !recipe["source"].text.isEmpty {
                CardFoot(state: "Stuknij składnik, żeby go odhaczyć") { Button("Źródło") { openURL(url) }.buttonStyle(PillStyle(height: 36)) }
            }
        }
    }
}

struct SkillCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var busy = false

    var body: some View {
        let k = message.data["skill"], state = k["state"].text, open = state == "draft" || state == "failed"
        let time = k["at"].double.map { When.time($0) } ?? ""
        let line = ["draft": "Stuknij Zainstaluj albo napisz „zainstaluj”", "installed": "Zainstalowany na Macu\(time.isEmpty ? "" : " o \(time)")", "dropped": "Odrzucony, nic nie zainstalowano", "failed": k["why"].string ?? "Nie udało się zainstalować"][state] ?? ""
        CardShell {
            CardHead(symbol: "terminal", title: "Skill dla Claude", detail: "/\(k["name"].text)")
            VStack(alignment: .leading, spacing: 8) {
                Text(k["description"].text).font(Face.serif(16)).foregroundStyle(Paper.fg)
                CodeBlock(text: k["body"].text).frame(maxHeight: 180)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            CardFoot(state: line, failed: state == "failed") {
                if open {
                    Button("Odrzuć") { run("drop") }.buttonStyle(PillStyle(height: 38))
                    Button(state == "failed" ? "Ponów" : "Zainstaluj") { run("install") }.buttonStyle(PillStyle(solid: true, height: 38))
                }
            }
            .disabled(busy)
        }
    }

    private func run(_ act: String) {
        Haptic.press()
        busy = true
        Task {
            if !(await model.act("/api/skill/act", on: message, ["act": .string(act)], key: "skill")) { model.say("Nie udało się połączyć z serwerem") }
            busy = false
        }
    }
}

struct VideosCard: View {
    let message: Message
    @Environment(\.openURL) private var openURL

    private func length(_ total: Int) -> String {
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    var body: some View {
        let list = message.data["videos"].array.filter { $0["id"].text.range(of: "^[\\w-]{6,20}$", options: .regularExpression) != nil }
        CardShell {
            CardHead(symbol: "play.rectangle.fill", title: "YouTube", detail: message.text)
            VStack(spacing: 12) {
                ForEach(Array(list.enumerated()), id: \.offset) { index, v in
                    Button {
                        if let url = URL(string: "https://www.youtube.com/watch?v=\(v["id"].text)") { openURL(url) }
                    } label: {
                        let lead = index == 0
                        Group {
                            if lead {
                                VStack(alignment: .leading, spacing: 8) { thumb(v, lead: true); meta(v) }
                            } else {
                                HStack(alignment: .top, spacing: 11) { thumb(v, lead: false).frame(width: 128); meta(v) }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(PressStyle(scale: 0.98))
                }
            }
            .padding(14)
        }
    }

    private func thumb(_ v: JSON, lead: Bool) -> some View {
        RemoteImage(url: URL(string: "https://i.ytimg.com/vi/\(v["id"].text)/\(lead ? "hqdefault" : "mqdefault").jpg"))
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: lead ? 14 : 10, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                Text(v["live"].bool == true ? "na żywo" : length(v["seconds"].int ?? 0)).font(Face.round(11)).foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 2).background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 5, style: .continuous)).padding(6)
            }
    }

    private func meta(_ v: JSON) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(v["title"].text).font(Face.sans(14.5, .semibold)).foregroundStyle(Paper.fg).lineLimit(3).multilineTextAlignment(.leading)
            Text([v["channel"].text, (v["views"].double ?? 0) > 0 ? "\((v["views"].double ?? 0).formatted(.number.notation(.compactName).locale(When.locale))) wyświetleń" : ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(Face.sans(12.5)).foregroundStyle(Paper.muted).lineLimit(2).multilineTextAlignment(.leading)
        }
    }
}

struct FilmCard: View {
    let title: JSON
    @Environment(\.openURL) private var openURL
    @State private var whole = false
    private static let tmdb = "https://image.tmdb.org/t/p/"

    private var sub: String {
        let t = title, movie = t["type"].text == "movie", year = t["year"].int ?? 0
        var years = ""
        if year > 0 {
            if movie { years = "\(year)" }
            else if t["ended"].bool == true { years = (t["lastYear"].int ?? year) != year ? "\(year)–\(t["lastYear"].int ?? year)" : "\(year)" }
            else { years = "od \(year)" }
        }
        var length = ""
        if movie, let run = t["runtime"].int, run > 0 { length = "\(run >= 60 ? "\(run / 60) h " : "")\(run % 60) min" }
        else if let seasons = t["seasons"].int, seasons > 0 { length = "\(seasons) sez." }
        return [years, length, t["genres"].array.compactMap(\.string).joined(separator: ", ")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        let t = title, w = t["watch"]
        CardShell {
            if !t["backdrop"].text.isEmpty {
                RemoteImage(url: URL(string: "\(FilmCard.tmdb)w780\(t["backdrop"].text)")).aspectRatio(16 / 9, contentMode: .fit)
            }
            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .top, spacing: 12) {
                    if !t["poster"].text.isEmpty {
                        RemoteImage(url: URL(string: "\(FilmCard.tmdb)w342\(t["poster"].text)")).frame(width: 74, height: 111).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t["name"].text).font(Face.serif(20, .semibold)).foregroundStyle(Paper.fg)
                        if !t["original"].text.isEmpty { Text(t["original"].text).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                        Text(sub).font(Face.sans(13)).foregroundStyle(Paper.muted)
                        if let rating = t["rating"].double, rating > 0 {
                            HStack(spacing: 5) {
                                Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Paper.orange)
                                Text(String(format: "%.1f", rating).replacingOccurrences(of: ".", with: ",")).font(Face.round(13.5))
                            }
                            .padding(.top, 3)
                        }
                    }
                }
                if !t["tagline"].text.isEmpty { Text(t["tagline"].text).font(Face.serif(15)).italic().foregroundStyle(Paper.muted) }
                if !t["overview"].text.isEmpty {
                    Text(t["overview"].text).font(Face.serif(15.5)).lineSpacing(3).foregroundStyle(Paper.fg).lineLimit(whole ? nil : 4)
                        .onTapGesture { withAnimation(Motion.snap) { whole.toggle() } }
                }
                let crew = [t["makers"].array.isEmpty ? "" : "\(t["type"].text == "movie" ? "Reż." : "Twórcy:") \(t["makers"].array.compactMap(\.string).joined(separator: ", "))", t["cast"].array.compactMap(\.string).joined(separator: ", ")].filter { !$0.isEmpty }.joined(separator: " · ")
                if !crew.isEmpty { Text(crew).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                if w.isNull {
                    Text("Nie ma jeszcze danych o streamingu w Polsce").font(Face.sans(13)).foregroundStyle(Paper.muted)
                } else {
                    let groups: [(String, [JSON])] = [("W abonamencie", w["stream"].array), ("Za darmo", w["free"].array)]
                    let shown = groups.filter { !$0.1.isEmpty }
                    let rest: [(String, [JSON])] = shown.isEmpty ? (w["rent"].array.isEmpty ? (w["buy"].array.isEmpty ? [] : [("Do kupienia", w["buy"].array)]) : [("Do wypożyczenia", w["rent"].array)]) : shown
                    ForEach(Array(rest.enumerated()), id: \.offset) { _, group in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(group.0).font(Face.sans(11.5, .semibold)).foregroundStyle(Paper.muted)
                            Text(group.1.map { $0["name"].text }.joined(separator: " · ")).font(Face.sans(14, .medium)).foregroundStyle(Paper.fg)
                        }
                    }
                }
                HStack(spacing: 8) {
                    if !t["trailer"].text.isEmpty, let url = URL(string: "https://www.youtube.com/watch?v=\(t["trailer"].text)") { Button("Zwiastun") { openURL(url) }.buttonStyle(PillStyle(solid: true, height: 38)) }
                    if let url = URL(string: w["link"].string ?? t["page"].text) { Button(w["link"].string == nil ? "Więcej" : "Gdzie obejrzeć") { openURL(url) }.buttonStyle(PillStyle(height: 38)) }
                }
                Text("Dane: TMDB. Dostępność: JustWatch.").font(Face.sans(11)).foregroundStyle(Paper.faint)
            }
            .padding(14)
        }
    }
}

struct ShelfCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var asked: Int?

    var body: some View {
        CardShell {
            CardHead(symbol: "film", title: message.text)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 11) {
                    ForEach(Array(message.data["titles"].array.enumerated()), id: \.offset) { _, t in
                        Button {
                            Haptic.tap()
                            asked = t["id"].int
                            Task {
                                if (try? await model.call("/api/title", ["type": t["type"], "id": t["id"]])) == nil { model.say("Nie udało się otworzyć tytułu") }
                                asked = nil
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                RemoteImage(url: URL(string: "https://image.tmdb.org/t/p/w342\(t["poster"].text)")).frame(width: 104, height: 156).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .opacity(asked == t["id"].int ? 0.5 : 1)
                                Text(t["name"].text).font(Face.sans(13, .semibold)).foregroundStyle(Paper.fg).lineLimit(2).multilineTextAlignment(.leading)
                                Text([t["year"].int.map(String.init) ?? "", (t["rating"].double ?? 0) > 0 ? String(format: "%.1f", t["rating"].double ?? 0).replacingOccurrences(of: ".", with: ",") : ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(Face.sans(12)).foregroundStyle(Paper.muted)
                            }
                            .frame(width: 104, alignment: .leading)
                        }
                        .buttonStyle(PressStyle(scale: 0.97))
                    }
                }
                .padding(14)
            }
        }
    }
}

struct PictureCard: View {
    let message: Message
    @Environment(AppModel.self) private var model
    @State private var viewing = false

    var body: some View {
        let file = FileItem(raw: message.data["image"])
        VStack(alignment: .leading, spacing: 7) {
            Button { viewing = true } label: {
                FileImage(id: file.id).aspectRatio(file.ratio, contentMode: .fit).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
            }
            .buttonStyle(PressStyle(scale: 0.985))
            if !message.text.isEmpty { Text(message.text).font(Face.sans(13)).foregroundStyle(Paper.muted).padding(.horizontal, 4) }
        }
        .fullScreenCover(isPresented: $viewing) { ImageViewer(id: file.id, caption: message.text).environment(model) }
    }
}
