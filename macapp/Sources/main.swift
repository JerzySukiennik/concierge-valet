// Concierge Valet for macOS: an opaque native window around the bundled desktop interface, with a loopback file server, system notifications, a Dock badge and the bridge that lets the cloud agent reach this Mac.
import AppKit
import ApplicationServices
import Network
import UserNotifications
import WebKit

enum Config {
    static let env = ProcessInfo.processInfo.environment
    static let api = env["VALET_API"] ?? "https://concierge-valet-api.kalakasanyt.workers.dev"
    static let devURL = env["VALET_URL"]
    static let port: UInt16 = 21420
    static let stripHeight: CGFloat = 52
    static var token: String { env["VALET_TOKEN"] ?? UserDefaults.standard.string(forKey: "token") ?? "" }
    static let background = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.090, green: 0.086, blue: 0.078, alpha: 1)
            : NSColor(srgbRed: 0.973, green: 0.965, blue: 0.945, alpha: 1)
    }
}

final class FileServer {
    private static let types = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "png": "image/png", "svg": "image/svg+xml", "json": "application/json", "webmanifest": "application/manifest+json",
    ]
    private let root: URL
    private let queue = DispatchQueue(label: "fun.gzowo.valet.server")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    init(root: URL) { self.root = root.standardizedFileURL }

    func start() -> Bool {
        for candidate in Config.port..<(Config.port + 8) {
            guard let endpointPort = NWEndpoint.Port(rawValue: candidate) else { continue }
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: endpointPort)
            guard let made = try? NWListener(using: params) else { continue }
            let ready = DispatchSemaphore(value: 0)
            var ok = false
            made.stateUpdateHandler = { state in
                switch state {
                case .ready: ok = true; ready.signal()
                case .failed, .cancelled: ready.signal()
                default: break
                }
            }
            made.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            made.start(queue: queue)
            _ = ready.wait(timeout: .now() + 2)
            if ok {
                listener = made
                port = candidate
                return true
            }
            made.cancel()
        }
        return false
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32768) { [weak self] data, _, _, _ in
            guard let self, let data, let head = String(data: data, encoding: .utf8), let line = head.components(separatedBy: "\r\n").first else { connection.cancel(); return }
            let parts = line.split(separator: " ")
            guard parts.count >= 2, parts[0] == "GET" else { self.reply(connection, "405 Method Not Allowed", "text/plain", Data()); return }
            var path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? "/"
            if path.hasSuffix("/") { path += "index.html" }
            let file = self.root.appendingPathComponent(path).standardizedFileURL
            guard file.path.hasPrefix(self.root.path + "/"), let body = try? Data(contentsOf: file) else {
                self.reply(connection, "404 Not Found", "text/plain", Data("not found".utf8))
                return
            }
            self.reply(connection, "200 OK", Self.types[file.pathExtension] ?? "application/octet-stream", body)
        }
    }

    private func reply(_ connection: NWConnection, _ status: String, _ type: String, _ body: Data) {
        var out = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".utf8)
        out.append(body)
        connection.send(content: out, completion: .contentProcessed { _ in connection.cancel() })
    }
}

final class DragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: event) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var server: FileServer?
    private var home: URL?
    private var bridge: Bridge?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        UNUserNotificationCenter.current().delegate = self

        if let dev = Config.devURL, let url = URL(string: dev) {
            home = url
        } else if let resources = Bundle.main.resourceURL {
            let made = FileServer(root: resources.appendingPathComponent("web"))
            if made.start() {
                server = made
                home = URL(string: "http://127.0.0.1:\(made.port)/mac/")
            }
        }

        let controller = WKUserContentController()
        let boot: [String: String] = ["shell": "mac", "api": Config.api, "token": Config.token]
        if let json = try? JSONSerialization.data(withJSONObject: boot), let text = String(data: json, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: "window.VALET = \(text);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        controller.add(self, name: "valet")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1180, height: 760), configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.underPageBackgroundColor = Config.background
        web.autoresizingMask = [.width, .height]
        web.allowsMagnification = false
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Concierge Valet"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.toolbar = NSToolbar(identifier: "main")
        window.toolbarStyle = .unified
        window.isOpaque = true
        window.backgroundColor = Config.background
        window.minSize = NSSize(width: 860, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 1180, height: 760))
        web.frame = root.bounds
        root.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 0, y: root.bounds.height - Config.stripHeight, width: root.bounds.width, height: Config.stripHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        root.addSubview(strip)
        window.contentView = root
        window.center()
        window.setFrameAutosaveName("ValetMain")

        if let home {
            web.load(URLRequest(url: home))
        } else {
            web.loadHTMLString("<body style=\"font: 15px -apple-system; padding: 80px 40px; background: #f8f6f1; color: #1d1c19\">Nie udało się uruchomić interfejsu. Zamknij aplikację i otwórz ją ponownie.</body>", baseURL: nil)
        }
        if Config.env["VALET_QUIET"] == nil { show() }
        bridge = Bridge()
        bridge?.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        show()
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        NSApp.dockTile.badgeLabel = nil
    }

    @objc func show() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func reload() {
        if let home { web.load(URLRequest(url: home)) }
    }

    @objc func openSettings() {
        show()
        web.evaluateJavaScript("document.getElementById('settings-btn')?.click()", completionHandler: nil)
    }

    private func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem()
            let menu = NSMenu(title: title)
            items.forEach { menu.addItem($0) }
            item.submenu = menu
            main.addItem(item)
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let made = NSMenuItem(title: title, action: action, keyEquivalent: key)
            made.keyEquivalentModifierMask = mods
            made.target = target
            return made
        }
        add("Concierge Valet", [
            item("O Concierge Valet", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Ustawienia…", #selector(openSettings), ",", target: self),
            .separator(),
            item("Ukryj Concierge Valet", #selector(NSApplication.hide(_:)), "h"),
            item("Ukryj pozostałe", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("Zakończ Concierge Valet", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("Edycja", [
            item("Cofnij", Selector(("undo:")), "z"),
            item("Ponów", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Wytnij", #selector(NSText.cut(_:)), "x"),
            item("Kopiuj", #selector(NSText.copy(_:)), "c"),
            item("Wklej", #selector(NSText.paste(_:)), "v"),
            item("Zaznacz wszystko", #selector(NSText.selectAll(_:)), "a"),
        ])
        add("Widok", [
            item("Przeładuj", #selector(reload), "r", target: self),
            item("Pełny ekran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        add("Okno", [
            item("Zminimalizuj", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zamknij", #selector(NSWindow.performClose(_:)), "w"),
            .separator(),
            item("Concierge Valet", #selector(show), "0", target: self),
        ])
        NSApp.mainMenu = main
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "notify":
            notify(title: body["title"] as? String ?? "Valet", text: body["body"] as? String ?? "", force: body["force"] as? Bool ?? false)
        case "badge":
            let count = body["count"] as? Int ?? 0
            NSApp.dockTile.badgeLabel = count > 0 && !NSApp.isActive ? String(count) : nil
        case "open":
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        case "ax":
            AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.bridge?.hello() }
        case "copy":
            if let text = body["text"] as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        default:
            break
        }
    }

    private func notify(title: String, text: String, force: Bool) {
        guard force || !NSApp.isActive else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = text
            content.sound = .default
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.show() }
        completionHandler()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let own = url.scheme == "about" || (home != nil && url.host == home?.host && url.port == home?.port)
        if own && navigationAction.targetFrame != nil { decisionHandler(.allow); return }
        if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        return nil
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
