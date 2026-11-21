// The app's state and its line to the server: boot and live socket, a disk cache for an instant start, sending, card actions and file links.
import Foundation
import SwiftUI

struct APIError: Error { let status: Int }

@MainActor @Observable
final class AppModel {
    static let base = URL(string: ProcessInfo.processInfo.environment["VALET_API"] ?? "https://concierge-valet-api.kalakasanyt.workers.dev")!

    var token = ""
    var booted = false
    var online = true
    var active = true
    var messages: [Message] = []
    var hasMore = false
    var loadingOlder = false
    var outgoing: [Outgoing] = []
    var tasks: [TaskItem] = []
    var files: [FileItem] = []
    var sched: [JSON] = []
    var facts: [JSON] = []
    var spend: JSON = .null
    var calendar: JSON = .null
    var mac: JSON = .null
    var status: JSON = .null
    var settings: JSON = .null
    var notice = ""
    var arrived = 0

    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var retry: Double = 1
    @ObservationIgnored private var pinger: Task<Void, Never>?
    @ObservationIgnored private var saver: Task<Void, Never>?
    @ObservationIgnored private var calm: Task<Void, Never>?
    @ObservationIgnored private var offline: Task<Void, Never>?
    @ObservationIgnored private var links: [String: (url: URL, until: Date)] = [:]

    init() {
        token = ProcessInfo.processInfo.environment["VALET_TOKEN"] ?? UserDefaults.standard.string(forKey: "token") ?? ""
        if token.isEmpty, let url = Bundle.main.url(forResource: "Pairing", withExtension: "plist"), let found = NSDictionary(contentsOf: url)?["token"] as? String, !found.isEmpty {
            token = found
            UserDefaults.standard.set(found, forKey: "token")
        }
        if let data = try? Data(contentsOf: cacheURL), let boot = JSON.parse(data), !token.isEmpty { apply(boot, fresh: false) }
    }

    var paired: Bool { !token.isEmpty }
    var pending: [Message] { messages.filter(\.waits) }
    var working: Bool { status["turn"].bool == true || (status["turn"].double ?? 0) > 0 }
    var state: String { online ? (status["state"].string ?? "idle") : "sleeping" }
    var statusText: String { online ? status["text"].text : "Łączenie" }
    var owner: String { settings["owner"].string ?? "Jurek" }

    func agent(_ key: String) -> JSON {
        let found = settings["agents"][key]
        return found.isNull ? settings["agents"]["valet"] : found
    }

    func pair(_ value: String) {
        token = value.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(token, forKey: "token")
        start()
    }

    func unpair() {
        token = ""
        UserDefaults.standard.removeObject(forKey: "token")
        close()
        messages = []
        outgoing = []
        booted = false
        try? FileManager.default.removeItem(at: cacheURL)
    }

    func start() {
        guard paired else { return }
        Task {
            await sync()
            connect()
        }
    }

    func resume() {
        active = true
        guard paired, socket == nil else { return }
        start()
    }

    func call(_ path: String, _ body: JSON? = nil, timeout: TimeInterval = 30) async throws -> JSON {
        guard let url = URL(string: path, relativeTo: AppModel.base) else { throw APIError(status: 0) }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body.data
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { unpair() }
        guard (200..<300).contains(code) else { throw APIError(status: code) }
        return JSON.parse(data) ?? .null
    }

    func sync() async {
        guard paired else { return }
        do {
            apply(try await call("/api/boot"), fresh: true)
            setOnline(true)
            persist()
        } catch {
            setOnline(false)
        }
    }

    private func apply(_ boot: JSON, fresh: Bool) {
        let incoming = boot["msgs"].array.map(Message.init)
        let top = messages.last?.id ?? 0
        if messages.isEmpty || !fresh || (incoming.first?.id ?? 0) > top + 1 {
            messages = incoming
        } else {
            var known = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            for m in incoming { known[m.id] = m }
            messages = known.values.sorted { $0.id < $1.id }
            if (incoming.last?.id ?? 0) > top { arrived += 1 }
        }
        hasMore = (messages.first?.id ?? 0) > 1
        tasks = boot["tasks"].array.map(TaskItem.init)
        files = boot["files"].array.map(FileItem.init)
        sched = boot["sched"].array
        facts = boot["facts"].array
        spend = boot["spend"]
        calendar = boot["calendar"]
        mac = boot["mac"]
        status = fresh ? boot["status"] : .null
        settings = boot["settings"]
        booted = true
        let texts = Set(messages.suffix(12).filter(\.mine).map(\.text))
        if fresh { outgoing.removeAll { !$0.failed && texts.contains($0.text) && Date().timeIntervalSince1970 * 1000 - $0.ts > 4000 } }
    }

    private var cacheURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("thread.json")
    }

    private func persist() {
        saver?.cancel()
        saver = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard let self, !Task.isCancelled, self.paired else { return }
            let snapshot: JSON = ["msgs": .array(self.messages.suffix(160).map(\.raw)), "tasks": .array(self.tasks.map(\.raw)), "files": .array(self.files.map(\.raw)), "sched": .array(self.sched), "facts": .array(self.facts), "spend": self.spend, "calendar": self.calendar, "mac": self.mac, "settings": self.settings]
            let url = self.cacheURL, data = snapshot.data
            Task.detached(priority: .utility) {
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: url, options: .atomic)
            }
        }
    }

    private func setOnline(_ value: Bool) {
        offline?.cancel()
        if value {
            online = true
            return
        }
        offline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            self?.online = false
        }
    }

    func connect() {
        guard paired, socket == nil else { return }
        Task {
            do {
                let ticket = try await call("/api/ticket", [:])["ticket"].text
                guard socket == nil, var parts = URLComponents(url: AppModel.base.appendingPathComponent("api/ws"), resolvingAgainstBaseURL: false) else { return }
                parts.scheme = AppModel.base.scheme == "http" ? "ws" : "wss"
                parts.queryItems = [URLQueryItem(name: "k", value: ticket)]
                guard let url = parts.url else { return }
                let task = URLSession.shared.webSocketTask(with: url)
                socket = task
                task.resume()
                setOnline(true)
                pinger?.cancel()
                pinger = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(25))
                        try? await task.send(.string("ping"))
                    }
                }
                await listen(task)
            } catch {
                setOnline(false)
                again()
            }
        }
    }

    private func listen(_ task: URLSessionWebSocketTask) async {
        var heard = false
        while socket === task {
            guard let message = try? await task.receive() else { break }
            if !heard {
                heard = true
                retry = 1
            }
            switch message {
            case .string(let text): if text != "pong", let event = JSON.parse(text) { handle(event) }
            case .data(let data): if let event = JSON.parse(data) { handle(event) }
            @unknown default: break
            }
        }
        guard socket === task else { return }
        socket = nil
        pinger?.cancel()
        setOnline(false)
        again()
    }

    private func again() {
        let wait = retry
        retry = min(15, retry * 2)
        Task {
            try? await Task.sleep(for: .seconds(wait))
            guard paired, socket == nil, active else { return }
            await sync()
            connect()
        }
    }

    func close() {
        active = false
        pinger?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    private func handle(_ event: JSON) {
        switch event["t"].text {
        case "msg": upsert(Message(raw: event["m"]), fresh: true)
        case "edit": upsert(Message(raw: event["m"]), fresh: false)
        case "mac": mac = event["mac"]
        case "status": setStatus(event)
        case "task":
            let task = TaskItem(raw: event["task"])
            if let i = tasks.firstIndex(where: { $0.id == task.id }) { tasks[i] = task } else { tasks.insert(task, at: 0) }
        case "files": files = event["files"].array.map(FileItem.init)
        case "sched": sched = event["sched"].array
        case "facts": facts = event["facts"].array
        case "spend": spend = event["spend"]
        case "settings":
            settings = event["settings"]
            if !event["sched"].isNull { sched = event["sched"].array }
        default: break
        }
        persist()
    }

    private func setStatus(_ next: JSON) {
        status = next
        calm?.cancel()
        guard ["happy", "error"].contains(next["state"].text) else { return }
        calm = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.8))
            guard !Task.isCancelled, let self else { return }
            self.status = ["state": "idle", "text": ""]
        }
    }

    private func upsert(_ message: Message, fresh: Bool) {
        if let i = messages.firstIndex(where: { $0.id == message.id }) {
            messages[i] = message
            return
        }
        guard fresh else { return }
        messages.append(message)
        if message.mine, let i = outgoing.firstIndex(where: { $0.text == message.text && !$0.failed }) { outgoing.remove(at: i) }
        arrived += 1
    }

    func send(_ text: String, picks: [Pick]) {
        let item = Outgoing(text: text, picks: picks)
        outgoing.append(item)
        arrived += 1
        Task { await deliver(item) }
    }

    func resend(_ item: Outgoing) {
        guard let i = outgoing.firstIndex(where: { $0.id == item.id }) else { return }
        outgoing[i].failed = false
        Task { await deliver(outgoing[i]) }
    }

    func discard(_ item: Outgoing) { outgoing.removeAll { $0.id == item.id } }

    private func deliver(_ item: Outgoing) async {
        do {
            var sent: [JSON] = []
            for pick in item.picks {
                let reply = try await call("/api/upload", ["name": .string(pick.name), "mime": .string(pick.mime), "data": .string(pick.data.base64EncodedString()), "w": .number(Double(pick.width)), "h": .number(Double(pick.height))], timeout: 120)
                var file = reply["file"]
                file["w"] = .number(Double(pick.width))
                file["h"] = .number(Double(pick.height))
                sent.append(file)
            }
            _ = try await call("/api/message", ["text": .string(item.text), "files": .array(sent)])
            try? await Task.sleep(for: .seconds(socket == nil ? 0.1 : 2.5))
            guard outgoing.contains(where: { $0.id == item.id }) else { return }
            await sync()
            outgoing.removeAll { $0.id == item.id }
        } catch {
            if let i = outgoing.firstIndex(where: { $0.id == item.id }) { outgoing[i].failed = true }
            Haptic.fail()
        }
    }

    func loadOlder() async {
        guard hasMore, !loadingOlder, let first = messages.first else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        guard let reply = try? await call("/api/thread?before=\(first.id)") else { return }
        let older = reply["msgs"].array.map(Message.init).filter { $0.id < first.id }
        if older.isEmpty {
            hasMore = false
            return
        }
        messages.insert(contentsOf: older, at: 0)
        hasMore = (older.first?.id ?? 0) > 1
    }

    @discardableResult
    func act(_ path: String, on message: Message, _ body: JSON, key: String) async -> Bool {
        var payload = body
        payload["msg"] = .number(Double(message.id))
        guard let reply = try? await call(path, payload, timeout: 60) else { return false }
        if !reply[key].isNull, let i = messages.firstIndex(where: { $0.id == message.id }) {
            var raw = messages[i].raw, data = messages[i].data
            data[key] = reply[key]
            raw["data"] = data
            if key == "wa", let text = reply[key]["text"].string { raw["text"] = .string(text) }
            messages[i] = Message(raw: raw)
        }
        persist()
        return true
    }

    func link(_ id: String) async -> URL? {
        if let hit = links[id], hit.until > Date() { return hit.url }
        guard let reply = try? await call("/api/file/link", ["id": .string(id), "hold": true]), let url = URL(string: reply["url"].text, relativeTo: AppModel.base)?.absoluteURL else { return nil }
        links[id] = (url, Date().addingTimeInterval(5 * 3600))
        return url
    }

    func cancel(task id: Int) {
        Task { _ = try? await call("/api/task/cancel", ["id": .number(Double(id))]) }
    }

    func forget(fact id: Int) {
        facts.removeAll { $0["id"].int == id }
        Task { _ = try? await call("/api/fact/delete", ["id": .number(Double(id))]) }
    }

    func drop(sched id: Int) {
        sched.removeAll { $0["id"].int == id }
        Task { _ = try? await call("/api/sched/delete", ["id": .number(Double(id))]) }
    }

    func save(_ change: JSON) {
        Task {
            if let reply = try? await call("/api/settings", change), !reply["settings"].isNull { settings = reply["settings"] } else { say("Nie udało się zapisać ustawień") }
        }
    }

    func say(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(2.4))
            if notice == text { notice = "" }
        }
    }
}
