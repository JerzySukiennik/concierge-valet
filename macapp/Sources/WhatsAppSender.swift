// Concierge Valet for macOS: sends an approved WhatsApp message the way Jurek would: brings WhatsApp forward, searches the chat by name, checks that it opened, pastes the text (and a file with the text as its caption) and presses Send.
import AppKit
import ApplicationServices

@MainActor
enum WhatsAppSender {
    static let bundleID = "net.whatsapp.WhatsApp"

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    static func send(query: String, target: String, text: String, file: String? = nil, dryRun: Bool) async throws -> String {
        guard AXIsProcessTrusted() else { throw Failure("Aplikacja Concierge Valet na Macu nie ma uprawnienia Dostępność, więc nie może sterować WhatsAppem. Włącz je w Ustawieniach systemowych: Prywatność i ochrona, Dostępność.") }
        if (CGSessionCopyCurrentDictionary() as? [String: Any])?["CGSSessionScreenIsLocked"] as? Bool == true {
            throw Failure("Mac jest zablokowany, więc nie mogę wysłać.")
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure("Pusta wiadomość.") }
        if let file, !FileManager.default.fileExists(atPath: file) { throw Failure("Nie ma pliku do wysłania.") }
        let previous = NSWorkspace.shared.frontmostApplication
        let app = try await launch()
        let began = Date()
        var marks = ["send to \(target.count) chars, dry \(dryRun)"]
        func mark(_ name: String) { marks.append("\(name) \(Int(Date().timeIntervalSince(began) * 1000)) ms") }
        defer {
            mark("end")
            note(marks)
            if let previous, previous.bundleIdentifier != bundleID { front(previous) }
        }
        let ax = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(ax, 2)
        guard await waitFor(10, { window(ax) != nil }) else { throw Failure("WhatsApp nie otworzył okna.") }
        front(app)
        if !(await waitFor(1.5, { frontmost(app) })) {
            app.unhide()
            app.activate(options: [.activateAllWindows])
            if !(await waitFor(1.5, { frontmost(app) })), let url = app.bundleURL {
                let config = NSWorkspace.OpenConfiguration()
                config.activates = true
                _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: config)
            }
        }
        guard await waitFor(3, { frontmost(app) }) else { throw Failure("Nie udało się przełączyć na WhatsAppa, nic nie wysłałem.") }
        try await pause(0.3)
        mark("front")

        if !header(ax, target) {
            if let search = menuItem(ax, menu: "File", suffix: "Search") { AXUIElementPerformAction(search, kAXPressAction as CFString) } else { try keys(app, 3, .maskCommand) }
            try await pause(0.4)
            try keys(app, 0, .maskCommand)
            try keys(app, 51)
            try await type(app, query)
            mark("typed")
            var button: AXUIElement?
            _ = await waitFor(5) { button = findChat(ax, target); return button != nil }
            guard let button else {
                marks += ["chat not found"] + dump(ax)
                try? keys(app, 53)
                throw Failure("Nie znalazłem w WhatsAppie czatu „\(target)”.")
            }
            mark("row")
            AXUIElementPerformAction(button, kAXPressAction as CFString)
            guard await waitFor(4, { header(ax, target) }) else {
                marks += ["chat did not open"] + seen(ax)
                try? keys(app, 53)
                throw Failure("Nie otworzył się czat „\(target)”, nic nie wysłałem.")
            }
        }
        mark("chat open")

        var composer: AXUIElement?
        var clicked = false
        _ = await waitFor(4) {
            if let c = focused(ax, kAXTextAreaRole) { composer = c; return true }
            if !clicked, let c = find(ax, last: true, { string($0, kAXRoleAttribute) == kAXTextAreaRole }) { clicked = true; try? click(app, c) }
            return false
        }
        guard let composer else { throw Failure("Czat „\(target)” się otworzył, ale nie widzę pola wiadomości.") }
        guard (value(composer) ?? "").isEmpty else { throw Failure("W czacie „\(target)” jest niewysłany szkic, nie ruszam go.") }
        mark("composer")

        guard let file else {
            try await paste(app, { $0.setString(text, forType: .string) }, until: { same(value(composer) ?? "", text) })
            guard same(value(composer) ?? "", text) else {
                try? await erase(app, text)
                throw Failure("Tekst nie wkleił się poprawnie, nic nie wysłałem.")
            }
            mark("pasted")
            if dryRun {
                try await erase(app, text)
                guard await waitFor(6, { (value(composer) ?? "").isEmpty }) else { throw Failure("Test: nie udało się wyczyścić szkicu.") }
                return "dry run ok"
            }
            try keys(app, 36)
            if !(await waitFor(4, { (value(composer) ?? "").isEmpty })) {
                _ = press(ax, "Send")
                guard await waitFor(6, { (value(composer) ?? "").isEmpty }) else { throw Failure("Nacisnąłem Wyślij, ale wiadomość została w polu. Sprawdź WhatsAppa.") }
            }
            return "sent"
        }

        var caption: AXUIElement?
        try await paste(app, { $0.writeObjects([URL(fileURLWithPath: file) as NSURL]) }, until: { caption = captionField(ax); return caption != nil })
        guard let caption else { throw Failure("WhatsApp nie pokazał podglądu pliku, nic nie wysłałem.") }
        guard (value(caption) ?? "").isEmpty else {
            _ = press(ax, "Cancel")
            throw Failure("Pole podpisu pod plikiem nie było puste, przerwałem i nic nie wysłałem.")
        }
        if focused(ax, kAXTextAreaRole).map({ !CFEqual($0, caption) }) ?? true { try click(app, caption) }
        try await paste(app, { $0.setString(text, forType: .string) }, until: { same(value(caption) ?? "", text) })
        guard same(value(caption) ?? "", text) else {
            try? await erase(app, text)
            _ = press(ax, "Cancel")
            throw Failure("Podpis nie wkleił się poprawnie, nic nie wysłałem.")
        }
        if dryRun {
            try await erase(app, text)
            _ = press(ax, "Cancel")
            if !(await waitFor(5, { captionField(ax) == nil })) { _ = press(ax, "Cancel") }
            guard await waitFor(5, { captionField(ax) == nil }) else { throw Failure("Test: podgląd pliku się nie zamknął.") }
            guard await waitFor(6, { empty(ax, composer) }) else { throw Failure("Test: po anulowaniu został szkic.") }
            return "dry run ok: \(target) + \((file as NSString).lastPathComponent)"
        }
        guard press(ax, "Send") else { throw Failure("Nie widzę przycisku Wyślij w podglądzie pliku, nic nie wysłałem.") }
        guard await waitFor(10, { captionField(ax) == nil }) else { throw Failure("Nacisnąłem Wyślij, ale podgląd pliku nie zniknął. Sprawdź WhatsAppa.") }
        return "sent"
    }

    private static func launch() async throws -> NSRunningApplication {
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first { return running }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { throw Failure("Na tym Macu nie ma WhatsAppa.") }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        let app = try await NSWorkspace.shared.openApplication(at: url, configuration: config)
        try await pause(3)
        return app
    }

    private static func pause(_ seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
    }

    private static func waitFor(_ seconds: Double, _ check: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if check() { return true }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
        return check()
    }

    private static func frontmost(_ app: NSRunningApplication) -> Bool {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
    }

    private static func front(_ app: NSRunningApplication) {
        AXUIElementSetAttributeValue(AXUIElementCreateApplication(app.processIdentifier), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    }

    private static func keys(_ app: NSRunningApplication, _ code: CGKeyCode, _ flags: CGEventFlags = []) throws {
        guard frontmost(app) else { throw Failure("WhatsApp przestał być na wierzchu, przerwałem i nic nie wysłałem.") }
        let src = CGEventSource(stateID: .hidSystemState)
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) else { continue }
            e.flags = flags
            e.post(tap: .cghidEventTap)
        }
        usleep(20_000)
    }

    private static func type(_ app: NSRunningApplication, _ text: String) async throws {
        let src = CGEventSource(stateID: .hidSystemState)
        for ch in text {
            guard frontmost(app) else { throw Failure("WhatsApp przestał być na wierzchu, przerwałem i nic nie wysłałem.") }
            var units = Array(String(ch).utf16)
            for down in [true, false] {
                guard let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down) else { continue }
                e.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
                e.post(tap: .cghidEventTap)
            }
            try await pause(0.03)
        }
        try await pause(0.4)
    }

    private static func click(_ app: NSRunningApplication, _ el: AXUIElement) throws {
        guard let frame = frame(el), frame.width > 0, frame.height > 0, frontmost(app) else { throw Failure("WhatsApp przestał być na wierzchu, przerwałem i nic nie wysłałem.") }
        let at = CGPoint(x: frame.midX, y: frame.midY)
        let back = CGEvent(source: nil)?.location
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left)?.post(tap: .cghidEventTap)
        }
        if let back { CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: back, mouseButton: .left)?.post(tap: .cghidEventTap) }
    }

    private static func erase(_ app: NSRunningApplication, _ text: String) async throws {
        try keys(app, 125, .maskCommand)
        for i in 0..<(text.count + 10) {
            try keys(app, 51)
            if i % 20 == 19 { try await pause(0.1) }
        }
        try await pause(0.5)
    }

    private static func paste(_ app: NSRunningApplication, _ write: (NSPasteboard) -> Void, until done: () -> Bool) async throws {
        let pb = NSPasteboard.general
        let saved: [NSPasteboardItem] = (pb.pasteboardItems ?? []).map { item in
            let copy = NSPasteboardItem()
            for type in item.types { if let d = item.data(forType: type) { copy.setData(d, forType: type) } }
            return copy
        }
        pb.clearContents()
        write(pb)
        defer {
            pb.clearContents()
            if !saved.isEmpty { pb.writeObjects(saved) }
        }
        try keys(app, 9, .maskCommand)
        _ = await waitFor(8, done)
        try await pause(0.3)
    }

    private static func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
        var v: AnyObject?
        return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
    }

    private static func children(_ el: AXUIElement) -> [AXUIElement] {
        attr(el, kAXChildrenAttribute) as? [AXUIElement] ?? []
    }

    private static func string(_ el: AXUIElement, _ name: String) -> String {
        attr(el, name) as? String ?? ""
    }

    private static func value(_ el: AXUIElement) -> String? {
        attr(el, kAXValueAttribute) as? String
    }

    private static func frame(_ el: AXUIElement) -> CGRect? {
        guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
        var origin = CGPoint.zero, size = CGSize.zero
        AXValueGetValue(p as! AXValue, .cgPoint, &origin)
        AXValueGetValue(s as! AXValue, .cgSize, &size)
        return CGRect(origin: origin, size: size)
    }

    private static func window(_ ax: AXUIElement) -> AXUIElement? {
        (attr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first
    }

    private static func clean(_ s: String) -> String {
        let hidden = CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}")
        return String(String.UnicodeScalarView(s.unicodeScalars.filter { !hidden.contains($0) })).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func label(_ s: String) -> String {
        let c = clean(s).lowercased()
        let digits = c.filter(\.isNumber)
        return digits.count >= 6 && c.allSatisfy({ $0.isNumber || " +,-()".contains($0) }) ? digits : c
    }

    private static func same(_ a: String, _ b: String) -> Bool {
        let norm = { (s: String) in s.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").replacingOccurrences(of: "\u{2028}", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }
        return norm(a) == norm(b)
    }

    private static func menuItem(_ ax: AXUIElement, menu: String, suffix: String) -> AXUIElement? {
        guard let bar = attr(ax, kAXMenuBarAttribute) else { return nil }
        let barEl = bar as! AXUIElement
        guard let top = children(barEl).first(where: { clean(string($0, kAXTitleAttribute)) == menu }), let list = children(top).first else { return nil }
        return children(list).first { clean(string($0, kAXTitleAttribute)).hasSuffix(suffix) }
    }

    private static func find(_ ax: AXUIElement, last: Bool = false, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
        guard let win = window(ax) else { return nil }
        var stack = [win], seen = 0
        let deadline = Date().addingTimeInterval(6)
        while let el = stack.popLast(), seen < 4000, Date() < deadline {
            seen += 1
            if match(el) { return el }
            if string(el, kAXRoleAttribute) == kAXButtonRole { continue }
            stack.append(contentsOf: last ? children(el) : children(el).reversed())
        }
        return nil
    }

    private static func buttonLabels(_ el: AXUIElement) -> [String] {
        [string(el, kAXDescriptionAttribute)] + children(el).prefix(1).map { string($0, kAXDescriptionAttribute) }
    }

    private static func matches(_ raw: String, _ target: String) -> Bool {
        let c = clean(raw).lowercased()
        if c.isEmpty { return false }
        let want = label(target)
        if want.count >= 6, want.allSatisfy(\.isNumber) { return c.filter(\.isNumber) == want }
        return label(raw) == want
    }

    private static func findChat(_ ax: AXUIElement, _ target: String) -> AXUIElement? {
        guard let top = window(ax).flatMap(frame)?.minY else { return nil }
        return find(ax) {
            guard string($0, kAXRoleAttribute) == kAXButtonRole, let f = frame($0), f.minY - top >= 90, f.height >= 50, f.width >= 200 else { return false }
            return buttonLabels($0).contains { matches($0, target) }
        }
    }

    private static func header(_ ax: AXUIElement, _ target: String) -> Bool {
        guard let win = window(ax), let top = frame(win)?.minY else { return false }
        var stack = [win], seen = 0
        while let el = stack.popLast(), seen < 1500 {
            seen += 1
            let f = frame(el)
            if let f, f.minY - top >= 90 { continue }
            if string(el, kAXRoleAttribute) == kAXButtonRole {
                if f != nil, buttonLabels(el).contains(where: { matches($0, target) }) { return true }
                continue
            }
            stack.append(contentsOf: children(el).reversed())
        }
        return false
    }

    private static func note(_ lines: [String]) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("valet-whatsapp.txt")
        try? lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
    }

    private static func dump(_ ax: AXUIElement) -> [String] {
        guard let win = window(ax), let origin = frame(win) else { return ["no window"] }
        var out = ["window \(Int(origin.width))x\(Int(origin.height))"]
        var stack = [win], visited = 0
        while let el = stack.popLast(), visited < 5000, out.count < 70 {
            visited += 1
            let role = string(el, kAXRoleAttribute)
            if role == kAXTextFieldRole || role == kAXTextAreaRole || role == kAXButtonRole || role == "AXSearchField" || role == kAXComboBoxRole, let f = frame(el) {
                let text = ([string(el, kAXDescriptionAttribute), string(el, kAXTitleAttribute)] + children(el).prefix(2).map { string($0, kAXDescriptionAttribute) }).map(clean).filter { !$0.isEmpty }.joined(separator: " / ")
                let val = clean(value(el) ?? "")
                out.append("\(role.replacingOccurrences(of: "AX", with: "")) x\(Int(f.minX - origin.minX)) y\(Int(f.minY - origin.minY)) w\(Int(f.width)) h\(Int(f.height)) [\(text.prefix(46))]\(val.isEmpty ? "" : " value=\(val.prefix(24))")")
            }
            if role == kAXButtonRole { continue }
            stack.append(contentsOf: children(el).reversed())
        }
        return out
    }

    private static func seen(_ ax: AXUIElement) -> [String] {
        guard let win = window(ax), let top = frame(win)?.minY else { return [] }
        var out: [String] = []
        var stack = [win], visited = 0
        while let el = stack.popLast(), visited < 4000, out.count < 30 {
            visited += 1
            let role = string(el, kAXRoleAttribute)
            if let f = frame(el), f.minY - top < 260, role == kAXButtonRole || role == kAXStaticTextRole || role == "AXHeading" {
                let text = ([string(el, kAXDescriptionAttribute), string(el, kAXTitleAttribute), value(el) ?? ""] + children(el).prefix(1).map { string($0, kAXDescriptionAttribute) }).map(clean).filter { !$0.isEmpty }
                if !text.isEmpty { out.append("\(role.replacingOccurrences(of: "AX", with: "")) \(Int(f.minY - top)),\(Int(f.minX)): \(text.joined(separator: " / ").prefix(40))") }
            }
            if role == kAXButtonRole { continue }
            stack.append(contentsOf: children(el).reversed())
        }
        return out
    }

    private static func press(_ ax: AXUIElement, _ name: String) -> Bool {
        guard let b = find(ax, last: true, { string($0, kAXRoleAttribute) == kAXButtonRole && clean(string($0, kAXDescriptionAttribute)) == name }) else { return false }
        return AXUIElementPerformAction(b, kAXPressAction as CFString) == .success
    }

    private static func empty(_ ax: AXUIElement, _ composer: AXUIElement) -> Bool {
        (value(composer) ?? "").isEmpty && find(ax, last: true, { string($0, kAXRoleAttribute) == kAXButtonRole && clean(string($0, kAXDescriptionAttribute)) == "Voice message" }) != nil
    }

    private static func captionField(_ ax: AXUIElement) -> AXUIElement? {
        find(ax, last: true) { string($0, kAXRoleAttribute) == kAXTextAreaRole && clean(string($0, kAXDescriptionAttribute)).hasPrefix("Caption") }
    }

    private static func focused(_ ax: AXUIElement, _ role: String) -> AXUIElement? {
        guard let f = attr(ax, kAXFocusedUIElementAttribute) else { return nil }
        let el = f as! AXUIElement
        return string(el, kAXRoleAttribute) == role ? el : nil
    }
}
