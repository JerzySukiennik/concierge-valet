// Everything beside the conversation: the side panel with what is next, and the screens it opens for background tasks, created files, memory, reminders and settings.
import SwiftUI

struct PanelView: View {
    let onRoute: (Route) -> Void
    let onPending: () -> Void
    @Environment(AppModel.self) private var model

    private var upcoming: [CalendarEvent] {
        let now = Date().timeIntervalSince1970 * 1000
        return model.calendar["today"].array.map(CalendarEvent.init).filter { $0.end > now }.sorted { $0.start < $1.start }.prefix(3).map { $0 }
    }

    var body: some View {
        let sessions = model.mac["code"]["sessions"].int ?? 0, reach = model.mac["code"]["on"].bool == true
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                AvatarView(avatar: model.agent("valet")["avatar"], state: model.state, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.agent("valet")["name"].string ?? "Valet").font(Face.serif(21, .semibold)).foregroundStyle(Paper.fg)
                    HStack(spacing: 6) {
                        Circle().fill(model.online ? Paper.live : Paper.faint).frame(width: 7, height: 7)
                        Text([model.online ? "Czuwa" : "Łączenie", reach ? "Mac online" : "Mac poza zasięgiem", reach && sessions > 0 ? "\(sessions) \(sessions == 1 ? "sesja" : sessions < 5 ? "sesje" : "sesji")" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(Face.sans(13)).foregroundStyle(Paper.muted).lineLimit(1).minimumScaleFactor(0.85)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 12)
            if !model.pending.isEmpty {
                Button(action: onPending) {
                    HStack(spacing: 10) {
                        Text("\(model.pending.count)").font(Face.round(13, .bold)).foregroundStyle(Paper.onAccent).frame(minWidth: 26, minHeight: 26).background(Paper.accent, in: Capsule())
                        Text("Czeka na Ciebie").font(Face.sans(15, .semibold))
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
            }
            label("Najbliższe")
            CardShell {
                let list = upcoming
                if list.isEmpty {
                    Text(model.calendar["on"].bool == true ? "Nic w kalendarzu na dziś i jutro" : "Kalendarz nie jest podłączony").font(Face.sans(14)).foregroundStyle(Paper.muted).padding(14)
                }
                ForEach(Array(list.enumerated()), id: \.element.id) { index, event in
                    HStack(spacing: 10) {
                        Capsule().fill(event.tint).frame(width: 4, height: 22)
                        Text(event.title).font(Face.sans(14.5, .semibold)).foregroundStyle(Paper.fg).lineLimit(2)
                        Spacer(minLength: 6)
                        Text(event.allDay ? "cały dzień" : When.near(event.start)).font(Face.round(13, .semibold)).foregroundStyle(Paper.muted)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .overlay(alignment: .top) { if index > 0 { Rectangle().fill(Paper.sep).frame(height: 1) } }
                }
            }
            label("Valet")
            let running = model.tasks.filter(\.running).count
            item("clock", "W tle", badge: running > 0 ? "\(running) trwa" : "", lit: running > 0, .tasks)
            item("sparkles", "Stworzone", badge: model.files.isEmpty ? "" : "\(model.files.count)", lit: false, .files)
            item("doc.text", "Pamięć", badge: model.facts.isEmpty ? "" : "\(model.facts.count)", lit: false, .memory)
            item("bell", "Przypomnienia", badge: model.sched.isEmpty ? "" : "\(model.sched.count)", lit: false, .reminders)
            item("gearshape", "Ustawienia", badge: "", lit: false, .settings)
            Spacer(minLength: 0)
            HStack {
                Text("Dzisiaj")
                Spacer()
                Text("\(money(model.spend["today"].double ?? 0)) z \(money(model.spend["limit"].double ?? 6)) USD")
            }
            .font(Face.sans(13))
            .foregroundStyle(Paper.muted)
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .hairline()
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased()).font(Face.sans(11.5, .semibold)).kerning(0.7).foregroundStyle(Paper.muted).padding(.horizontal, 8).padding(.top, 14).padding(.bottom, 6)
    }

    private func item(_ symbol: String, _ title: String, badge: String, lit: Bool, _ route: Route) -> some View {
        Button { onRoute(route) } label: {
            HStack(spacing: 13) {
                Image(systemName: symbol).font(.system(size: 18, weight: .regular)).foregroundStyle(Paper.muted).frame(width: 24)
                Text(title).font(Face.sans(16)).foregroundStyle(Paper.fg)
                Spacer()
                if !badge.isEmpty {
                    Text(badge).font(Face.round(13)).foregroundStyle(lit ? Paper.tintFg : Paper.muted)
                        .padding(.horizontal, lit ? 9 : 0).padding(.vertical, lit ? 5 : 0)
                        .background(lit ? Paper.tint : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: 0.98))
    }
}

struct PanelSheet: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var title: String { ["tasks": "W tle", "files": "Stworzone", "memory": "Pamięć", "reminders": "Przypomnienia", "settings": "Ustawienia"][route.rawValue] ?? "" }

    var body: some View {
        NavigationStack {
            Group {
                switch route {
                case .tasks: tasks
                case .files: files
                case .memory: memory
                case .reminders: reminders
                case .settings: SettingsView()
                }
            }
            .background(Paper.bg)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Gotowe") { dismiss() }.font(Face.sans(16, .semibold)).tint(Paper.accent) }
            }
            .toolbarBackground(Paper.bg, for: .navigationBar)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
        .presentationBackground(Paper.bg)
    }

    private func blank(_ text: String) -> some View {
        Text(text).font(Face.serif(17)).foregroundStyle(Paper.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity, maxHeight: .infinity).padding(36)
    }

    @ViewBuilder private var tasks: some View {
        let list = model.tasks.sorted { ($0.running ? 1 : 0, $0.updated) > ($1.running ? 1 : 0, $1.updated) }
        if list.isEmpty { blank("Valet nie ma teraz zadań w tle. Poproś go o dokument, obrazek albo dłuższy research.") }
        else {
            ScrollView {
                LazyVStack(spacing: 10) { ForEach(list) { TaskCard(task: $0, full: true) } }
                    .padding(16)
                    .animation(Motion.move, value: list.map(\.id))
            }
        }
    }

    @ViewBuilder private var files: some View {
        let list = model.files.sorted { $0.ts > $1.ts }
        if list.isEmpty { blank("Tu pojawią się dokumenty i obrazki, które Valet dla Ciebie stworzy.") }
        else {
            ScrollView {
                LazyVStack(spacing: 10) { ForEach(list) { FileChip(file: $0, wide: true) } }.padding(16)
            }
        }
    }

    @ViewBuilder private var memory: some View {
        if model.facts.isEmpty { blank("Valet nic jeszcze nie zapamiętał. Powiedz mu „zapamiętaj, że…”.") }
        else {
            List {
                ForEach(Array(model.facts.enumerated()), id: \.offset) { _, fact in
                    Text(fact["text"].text).font(Face.serif(16.5)).foregroundStyle(Paper.fg).lineSpacing(3).padding(.vertical, 4)
                        .listRowBackground(Paper.bg)
                        .listRowSeparatorTint(Paper.sep)
                        .swipeActions {
                            Button("Zapomnij") { if let id = fact["id"].int { model.forget(fact: id) } }.tint(Paper.muted)
                        }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    @ViewBuilder private var reminders: some View {
        let list = model.sched.sorted { ($0["due"].double ?? 0) < ($1["due"].double ?? 0) }
        if list.isEmpty { blank("Nie masz ustawionych przypomnień. Powiedz Valetowi, o czym i kiedy ma przypomnieć.") }
        else {
            List {
                ForEach(Array(list.enumerated()), id: \.offset) { _, row in
                    let builtin = row["builtin"].text
                    let kind = builtin.hasPrefix("cal:") ? "przypomnienie z kalendarza" : ["daily": "codziennie", "weekly": "co tydzień", "weekdays": "w dni robocze", "monthly": "co miesiąc"][row["repeat"].text] ?? "jednorazowo"
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row["text"].text).font(Face.sans(15.5, .semibold)).foregroundStyle(Paper.fg)
                            Text(kind).font(Face.sans(13)).foregroundStyle(Paper.muted)
                        }
                        Spacer(minLength: 6)
                        Text(When.near(row["due"].double ?? 0)).font(Face.round(13.5)).foregroundStyle(Paper.muted)
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Paper.bg)
                    .listRowSeparatorTint(Paper.sep)
                    .swipeActions {
                        if builtin.isEmpty { Button("Usuń") { if let id = row["id"].int { model.drop(sched: id) } }.tint(Paper.muted) }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var leaving = false

    private static let models = [("claude-sonnet-5-5", "Sonnet 5.5"), ("claude-haiku-5-5", "Haiku 5.5"), ("claude-opus-5-5", "Opus 5.5")]
    private static let slots = [("chat", "Rozmowa w czacie"), ("voice", "Rozmowa głosowa"), ("text", "Krótkie teksty"), ("docs", "Dokumenty")]
    private static let signs = [("marka", "Made by Concierge Valet"), ("made", "Made by Valet"), ("asystent", "Valet, asystent"), ("napisal", "Napisał Valet, zatwierdzone"), ("cytat", "Cytat z podpisem"), ("tylda", "~ Valet"), ("kod", "Valet w ramce")]
    private static let nudges = [(0, "Wyłączone"), (10, "10 min"), (15, "15 min"), (30, "30 min"), (60, "1 godz.")]

    var body: some View {
        let s = model.settings
        Form {
            Section("Agenci") {
                ForEach(["valet", "atelier", "kurier"], id: \.self) { key in
                    let agent = s["agents"][key]
                    if !agent.isNull {
                        HStack(spacing: 12) {
                            AvatarView(avatar: agent["avatar"], size: 36, animated: false)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(agent["name"].text).font(Face.sans(16, .semibold)).foregroundStyle(Paper.fg)
                                if !agent["role"].text.isEmpty { Text(agent["role"].text).font(Face.sans(13)).foregroundStyle(Paper.muted) }
                            }
                        }
                    }
                }
            }
            Section("Modele") {
                ForEach(SettingsView.slots, id: \.0) { slot in
                    Picker(slot.1, selection: Binding(get: { s["models"][slot.0].text }, set: { model.save(["models": .object([slot.0: .string($0)])]) })) {
                        ForEach(SettingsView.models, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
            }
            Section {
                Stepper(value: Binding(get: { s["dailyUsd"].double ?? 6 }, set: { model.save(["dailyUsd": .number($0)]) }), in: 0.5...50, step: 0.5) {
                    Text("Limit dzienny: \(money(s["dailyUsd"].double ?? 6)) USD")
                }
            } header: { Text("Wydatki") } footer: {
                Text("Dzisiaj \(money(model.spend["today"].double ?? 0)) USD, w tym miesiącu \(money(model.spend["month"].double ?? 0)) USD.")
            }
            Section("Briefy") {
                Toggle("Poranny brief", isOn: Binding(get: { s["briefs"]["daily"].bool ?? true }, set: { saveBriefs(daily: $0) }))
                Toggle("Brief tygodniowy", isOn: Binding(get: { s["briefs"]["weekly"].bool ?? true }, set: { saveBriefs(weekly: $0) }))
                Picker("Godzina", selection: Binding(get: { s["briefs"]["hour"].int ?? 7 }, set: { saveBriefs(hour: $0) })) {
                    ForEach(5..<12, id: \.self) { Text("\($0):00").tag($0) }
                }
            }
            Section("Kalendarz") {
                Picker("Przypomnienie przed", selection: Binding(get: { s["calendar"]["nudge"].int ?? 30 }, set: { model.save(["calendar": ["nudge": .number(Double($0))]]) })) {
                    ForEach(SettingsView.nudges, id: \.0) { Text($0.1).tag($0.0) }
                }
                let hidden = Set(s["calendar"]["hidden"].array.compactMap(\.string))
                ForEach(model.calendar["calendars"].array.map { $0["name"].text }, id: \.self) { name in
                    Toggle(name, isOn: Binding(get: { !hidden.contains(name) }, set: { show in
                        var next = hidden
                        if show { next.remove(name) } else { next.insert(name) }
                        model.save(["calendar": ["hidden": .array(next.sorted().map(JSON.string))]])
                    }))
                }
            }
            Section("WhatsApp") {
                Picker("Podpis", selection: Binding(get: { s["whatsapp"]["sign"].string ?? "marka" }, set: { model.save(["whatsapp": ["sign": .string($0)]]) })) {
                    ForEach(SettingsView.signs, id: \.0) { Text($0.1).tag($0.0) }
                }
                Toggle("Valet sam mówi o ważnych wiadomościach", isOn: Binding(get: { s["whatsapp"]["proactive"].bool ?? true }, set: { model.save(["whatsapp": ["proactive": .bool($0)]]) }))
                let link = model.mac["link"]
                Text(link["on"].bool == true ? (link["state"].text == "open" ? "Łącze działa" : "Łącze czeka na kod QR na Macu") : "Łącze jest wyłączone").font(Face.sans(14)).foregroundStyle(Paper.muted)
            }
            Section("Claude Code") {
                Picker("Powiadomienia o sesjach", selection: Binding(get: { s["code"]["notify"].string ?? "away" }, set: { model.save(["code": ["notify": .string($0)]]) })) {
                    Text("Gdy nie ma mnie przy Macu").tag("away")
                    Text("Zawsze").tag("always")
                    Text("Nigdy").tag("off")
                }
                Picker("Prośby o zgodę", selection: Binding(get: { s["code"]["permissions"].string ?? "off" }, set: { model.save(["code": ["permissions": .string($0)]]) })) {
                    Text("Wyłączone").tag("off")
                    Text("Gdy nie ma mnie przy Macu").tag("away")
                }
            }
            Section {
                Text("Powiadomienia przychodzą na razie przez apkę Valeta dodaną do ekranu początkowego z Safari. Zostaw ją na telefonie.").font(Face.sans(14)).foregroundStyle(Paper.muted)
            } header: { Text("Powiadomienia") }
            Section {
                Button("Odłącz tę apkę") { leaving = true }.foregroundStyle(Paper.err)
            }
        }
        .scrollContentBackground(.hidden)
        .tint(Paper.accent)
        .confirmationDialog("Odłączyć apkę od Valeta?", isPresented: $leaving, titleVisibility: .visible) {
            Button("Odłącz", role: .destructive) { model.unpair() }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Rozmowa zostaje na serwerze. Żeby wrócić, trzeba będzie wkleić klucz dostępu.") }
    }

    private func saveBriefs(daily: Bool? = nil, weekly: Bool? = nil, hour: Int? = nil) {
        let b = model.settings["briefs"]
        model.save(["briefs": ["daily": .bool(daily ?? b["daily"].bool ?? true), "weekly": .bool(weekly ?? b["weekly"].bool ?? true), "hour": .number(Double(hour ?? b["hour"].int ?? 7))]])
    }
}
