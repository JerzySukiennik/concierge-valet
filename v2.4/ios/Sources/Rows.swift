// The thread as rows: day separators, the owner's bubbles, Valet's text without bubbles, labels for messages Valet wrote on its own, and the line that shows what it is doing now.
import SwiftUI

struct Row: Identifiable, Hashable {
    enum Kind: Hashable {
        case day(String)
        case message(Message, own: Bool, join: Bool)
        case echo(Outgoing)
    }

    let id: String
    let kind: Kind
    var gap: CGFloat = 14

    static func build(_ messages: [Message], _ outgoing: [Outgoing]) -> [Row] {
        var rows: [Row] = [], lastDay = "", previous: Message?
        rows.reserveCapacity(messages.count + 12)
        for m in messages {
            let day = When.dayTitle(m.ts)
            if day != lastDay {
                rows.append(Row(id: "day-\(m.id)", kind: .day(day), gap: rows.isEmpty ? 6 : 22))
                lastDay = day
                previous = nil
            }
            var own = false
            if m.who == "agent", m.kind == "text" || m.kind == "remind" {
                if let flag = m.data["own"].bool { own = flag }
                else if m.kind == "remind" { own = true }
                else if let p = previous { own = !p.mine && m.ts - p.ts > 90_000 }
                else { own = true }
            }
            let join = !own && previous.map { $0.who == m.who && $0.agent == m.agent && $0.isBubble && m.isBubble && m.ts - $0.ts < 300_000 } == true
            rows.append(Row(id: "m-\(m.id)", kind: .message(m, own: own, join: join), gap: join ? 5 : 14))
            previous = m
        }
        for item in outgoing { rows.append(Row(id: "o-\(item.id.uuidString)", kind: .echo(item))) }
        return rows
    }
}

struct RowView: View {
    let row: Row
    @Environment(AppModel.self) private var model

    var body: some View {
        switch row.kind {
        case .day(let title):
            Text(title.uppercased())
                .font(Face.sans(11.5, .semibold))
                .kerning(0.7)
                .foregroundStyle(Paper.muted)
                .frame(maxWidth: .infinity)
        case .echo(let item):
            EchoRow(item: item)
        case .message(let m, let own, _):
            MessageRow(message: m, own: own)
        }
    }
}

struct EchoRow: View {
    let item: Outgoing
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !item.text.isEmpty { Bubble(text: item.text).opacity(item.failed ? 1 : 0.55) }
            if !item.picks.isEmpty {
                Text(item.picks.count == 1 ? "Wysyłam plik" : "Wysyłam pliki: \(item.picks.count)")
                    .font(Face.sans(13)).foregroundStyle(Paper.muted)
            }
            if item.failed {
                HStack(spacing: 8) {
                    Text("Nie wysłano").font(Face.sans(13)).foregroundStyle(Paper.err)
                    Button("Ponów") { model.resend(item) }.buttonStyle(PillStyle(height: 32))
                    Button("Usuń") { model.discard(item) }.buttonStyle(PillStyle(height: 32))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

struct Bubble: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Face.sans(16.5))
            .foregroundStyle(Paper.fg)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Paper.me, in: UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous))
            .frame(maxWidth: 300, alignment: .trailing)
    }
}

struct MessageRow: View {
    let message: Message
    let own: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        let m = message
        if m.who == "sys" {
            Text(m.text)
                .font(Face.sans(13))
                .foregroundStyle(m.kind == "error" ? Paper.err : Paper.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
        } else if m.mine {
            mine(m)
        } else if m.isBubble {
            said(m)
        } else {
            CardView(message: m)
        }
    }

    private func mine(_ m: Message) -> some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !m.text.isEmpty {
                Bubble(text: m.text).modifier(TextActions(text: m.text))
            }
            ForEach(m.files) { FileChip(file: $0, mine: true) }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func said(_ m: Message) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if own {
                Signature(avatar: model.agent(m.agent)["avatar"], text: "\(model.agent(m.agent)["name"].string ?? "Valet") \(m.kind == "remind" ? "przypomina" : "sam z siebie") · \(When.time(m.ts))")
            } else if m.agent != "valet" {
                Signature(avatar: model.agent(m.agent)["avatar"], text: model.agent(m.agent)["name"].string ?? m.agent)
            }
            if let quoted = m.replyTo.flatMap({ id in model.messages.first { $0.id == id } }), !quoted.text.isEmpty, own {
                Text(quoted.text).font(Face.sans(13.5)).foregroundStyle(Paper.muted).lineLimit(2).padding(.leading, 10)
                    .overlay(alignment: .leading) { Capsule().fill(Paper.line).frame(width: 3) }
            }
            if !m.text.isEmpty {
                RichText(text: m.text).modifier(TextActions(text: m.text, speakable: true))
            }
            ForEach(m.files) { FileChip(file: $0, mine: false) }
            if !Message.known.contains(m.kind) {
                Text("Ta wiadomość ma kartę, której ta wersja apki jeszcze nie zna.").font(Face.sans(13)).foregroundStyle(Paper.muted)
            }
            let sources = m.data["sources"].array
            if !sources.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                            if let url = URL(string: source["url"].text) {
                                Link(destination: url) {
                                    Text(source["title"].text).font(Face.sans(12.5, .medium)).lineLimit(1).frame(maxWidth: 190)
                                        .padding(.horizontal, 11).padding(.vertical, 7)
                                        .foregroundStyle(Paper.fg)
                                        .background(Paper.soft, in: Capsule())
                                }
                            }
                        }
                    }
                }
                .scrollClipDisabled()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TextActions: ViewModifier {
    let text: String
    var speakable = false
    @State private var selecting = false

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button("Kopiuj", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = text
                    Haptic.tap()
                }
                Button("Zaznacz tekst", systemImage: "text.cursor") { selecting = true }
                ShareLink(item: text) { Label("Udostępnij", systemImage: "square.and.arrow.up") }
                if speakable { Button("Przeczytaj", systemImage: "speaker.wave.2") { Speaker.shared.say(text) } }
            }
            .sheet(isPresented: $selecting) {
                SelectableText(text: text)
                    .padding(.horizontal, 14)
                    .padding(.top, 24)
                    .background(Paper.bg)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Paper.bg)
            }
    }
}

struct SelectableText: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.backgroundColor = .clear
        view.font = UIFont.systemFont(ofSize: Face.scaled(17))
        view.textColor = UIColor(Paper.fg)
        view.tintColor = UIColor(Paper.accent)
        view.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 24, right: 4)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) { view.text = text }
}

struct Signature: View {
    let avatar: JSON
    let text: String

    var body: some View {
        HStack(spacing: 7) {
            AvatarView(avatar: avatar, size: 18, animated: false)
            Text(text).font(Face.sans(12.5, .medium)).foregroundStyle(Paper.muted)
        }
    }
}

struct RichText: View {
    enum Block: Hashable {
        case paragraph(AttributedString)
        case list([AttributedString])
    }

    let blocks: [Block]
    var size: CGFloat = 17.5

    init(text: String, size: CGFloat = 17.5) {
        self.size = size
        var out: [Block] = [], paragraph: [String] = [], items: [AttributedString] = []
        func flushParagraph() {
            if !paragraph.isEmpty { out.append(.paragraph(RichText.inline(paragraph.joined(separator: "\n")))) }
            paragraph = []
        }
        func flushList() {
            if !items.isEmpty { out.append(.list(items)) }
            items = []
        }
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("• ") {
                flushParagraph()
                items.append(RichText.inline(String(trimmed.dropFirst(2))))
            } else if trimmed.isEmpty {
                flushParagraph()
                flushList()
            } else {
                flushList()
                paragraph.append(line)
            }
        }
        flushParagraph()
        flushList()
        blocks = out
    }

    static func inline(_ source: String) -> AttributedString {
        let linked = source.replacingOccurrences(of: "(^|\\s)(https?://[^\\s<)]+)", with: "$1<$2>", options: .regularExpression)
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        guard var styled = try? AttributedString(markdown: linked, options: options) else { return AttributedString(source) }
        for run in styled.runs where run.inlinePresentationIntent?.contains(.code) == true {
            styled[run.range].font = .system(size: Face.scaled(15), design: .monospaced)
            styled[run.range].foregroundColor = Paper.tintFg
        }
        return styled
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    Text(text)
                case .list(let items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Circle().fill(Paper.faint).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 4 }
                                Text(item)
                            }
                        }
                    }
                }
            }
        }
        .font(Face.serif(size))
        .lineSpacing(size * 0.26)
        .foregroundStyle(Paper.fg)
        .tint(Paper.accent)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct LiveText: View {
    let text: String
    @State private var shown = 0

    var body: some View {
        RichText(text: String(text.prefix(shown)))
            .task(id: text.count) {
                if shown > text.count { shown = 0 }
                while shown < text.count, !Task.isCancelled {
                    shown = min(text.count, shown + max(2, (text.count - shown) / 5))
                    try? await Task.sleep(for: .milliseconds(33))
                }
            }
            .accessibilityLabel(text)
    }
}

struct WorkRow: View {
    let text: String
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 9) {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { i in
                        let wave = sin((t - Double(i) * 0.16) * 2 * .pi / 1.2)
                        Circle().fill(Paper.accent).frame(width: 6, height: 6)
                            .opacity(0.3 + 0.7 * max(0, wave))
                            .offset(y: -3 * max(0, wave))
                    }
                }
            }
            Text(text.isEmpty ? "Myśli" : text).font(Face.serif(15.5)).italic().foregroundStyle(Paper.muted)
                .contentTransition(.opacity)
                .animation(.easeInOut(duration: 0.2), value: text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(text.isEmpty ? "Valet myśli" : text)
    }
}
