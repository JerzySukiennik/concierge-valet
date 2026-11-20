// Concierge Valet for macOS: the bridge between this Mac and the cloud agent. Keeps one WebSocket open, answers the agent's calls (WhatsApp chats, messages, sending an approved message) and reports new messages from watched chats.
import AppKit
import ApplicationServices

@MainActor
final class Bridge {
    private let session = URLSession(configuration: .default)
    private var socket: URLSessionWebSocketTask?
    private var retry: Double = 2
    private var watch: [String] = []
    private var every: Double = 60
    private var watcher: Timer?
    private var pinger: Timer?
    private var generation = 0

    func start() {
        guard !Config.token.isEmpty else { return }
        connect()
    }

    private func connect() {
        generation += 1
        let current = generation
        guard let url = URL(string: Config.api + "/api/ticket") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(Config.token)", forHTTPHeaderField: "authorization")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Data("{}".utf8)
        session.dataTask(with: request) { data, _, _ in
            let ticket = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["ticket"] as? String
            Task { @MainActor in
                guard current == self.generation else { return }
                guard let ticket, let ws = URL(string: Config.api.replacingOccurrences(of: "http", with: "ws", options: .anchored) + "/api/bridge?k=" + ticket) else { self.later(current); return }
                let task = self.session.webSocketTask(with: ws)
                self.socket = task
                task.resume()
                self.hello()
                self.listen(task, current)
                self.pinger?.invalidate()
                self.pinger = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { _ in Task { @MainActor in self.socket?.send(.string("ping")) { _ in } } }
            }
        }.resume()
    }

    private func later(_ current: Int) {
        guard current == generation else { return }
        socket = nil
        pinger?.invalidate()
        let wait = retry
        retry = min(60, retry * 2)
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self, current == self.generation else { return }
            self.connect()
        }
    }

    private func listen(_ task: URLSessionWebSocketTask, _ current: Int) {
        task.receive { result in
            Task { @MainActor in
                guard current == self.generation else { return }
                switch result {
                case .failure:
                    self.later(current)
                case .success(let message):
                    self.retry = 2
                    if case .string(let text) = message, text != "pong", let body = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] { self.handle(body) }
                    self.listen(task, current)
                }
            }
        }
    }

    private func send(_ body: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: body), let text = String(data: data, encoding: .utf8) else { return }
        socket?.send(.string(text)) { _ in }
    }

    func hello() {
        send(["t": "hello", "host": Host.current().localizedName ?? "Mac", "ax": AXIsProcessTrusted(), "wa": WhatsAppStore.available])
    }

    private func handle(_ body: [String: Any]) {
        switch body["t"] as? String {
        case "config":
            watch = body["watch"] as? [String] ?? []
            every = max(20, body["every"] as? Double ?? 60)
            watcher?.invalidate()
            watcher = watch.isEmpty ? nil : Timer.scheduledTimer(withTimeInterval: every, repeats: true) { _ in Task { @MainActor in self.poll() } }
            if !watch.isEmpty { WhatsAppStore.launchHidden() }
        case "call":
            guard let id = body["id"] as? String, let tool = body["tool"] as? String else { return }
            let input = body["input"] as? [String: Any] ?? [:]
            Task { @MainActor in
                do {
                    self.send(["t": "result", "id": id, "ok": true, "data": try await self.run(tool, input)])
                } catch {
                    self.send(["t": "result", "id": id, "ok": false, "error": error.localizedDescription])
                }
            }
        default:
            break
        }
    }

    private func awake() async -> Bool {
        if WhatsAppStore.running { return false }
        WhatsAppStore.launchHidden()
        try? await Task.sleep(nanoseconds: 7_000_000_000)
        return true
    }

    private func run(_ tool: String, _ input: [String: Any]) async throws -> [String: Any] {
        switch tool {
        case "status":
            return ["host": Host.current().localizedName ?? "Mac", "ax": AXIsProcessTrusted(), "wa": WhatsAppStore.available, "running": WhatsAppStore.running]
        case "wa.chats":
            let stale = await awake()
            return ["chats": try WhatsAppStore.chats(query: input["query"] as? String ?? "", limit: input["limit"] as? Int ?? 40), "stale": stale]
        case "wa.read":
            let stale = await awake()
            var out = try WhatsAppStore.read(chat: input["chat"] as? String ?? "", since: input["since"] as? Double ?? 0, limit: min(400, input["limit"] as? Int ?? 200))
            out["stale"] = stale
            return out
        case "wa.confirm":
            let at = try WhatsAppStore.sent(chat: input["chat"] as? String ?? "", body: input["text"] as? String ?? "", since: input["since"] as? Double ?? 0)
            return ["sent": at != nil, "at": at ?? 0]
        case "wa.fresh":
            _ = await awake()
            return ["messages": try WhatsAppStore.fresh(after: 0, watch: watch, minutes: min(1440, max(1, input["minutes"] as? Double ?? 60)))]
        case "wa.find":
            switch try WhatsAppStore.find(input["chat"] as? String ?? "") {
            case .one(let chat): return ["chat": chat.name, "group": chat.group]
            case .many(let names): return ["candidates": names]
            }
        case "wa.send":
            guard case .one(let chat) = try WhatsAppStore.find(input["chat"] as? String ?? "") else { throw WhatsAppStore.Failure("Nie mam w WhatsAppie jednego czatu o tej nazwie.") }
            if !AXIsProcessTrusted() {
                AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
                hello()
            }
            defer { hello() }
            let result = try await WhatsAppSender.send(query: chat.name, target: chat.uiName, text: input["text"] as? String ?? "", dryRun: input["dry"] as? Bool ?? false)
            return ["result": result, "chat": chat.name]
        default:
            throw WhatsAppStore.Failure("Ten Mac nie zna polecenia \(tool).")
        }
    }

    private func poll() {
        guard !watch.isEmpty, socket != nil else { return }
        WhatsAppStore.launchHidden()
        let defaults = UserDefaults.standard
        let last = Int64(defaults.integer(forKey: "waLast"))
        let top = WhatsAppStore.newest()
        guard top > 0 else { return }
        if last == 0 || last > top { defaults.set(Int(top), forKey: "waLast"); return }
        guard top > last, let list = try? WhatsAppStore.fresh(after: last, watch: watch) else { return }
        defaults.set(Int(top), forKey: "waLast")
        if !list.isEmpty { send(["t": "event", "kind": "wa", "messages": list]) }
    }
}
