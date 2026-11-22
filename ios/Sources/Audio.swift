// Sound in and out: microphone capture as 16 kHz PCM, playback of the 24 kHz speech the voice model sends, the socket to that model, live dictation and the spoken conversation.
import AVFoundation
import Foundation
import SwiftUI

final class AudioLink {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)
    private let speech = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)
    private var converter: AVAudioConverter?
    private var running = false
    private var wired = false
    private var round = 0
    private(set) var queued = 0
    var onDrain: (() -> Void)?

    func start(conversation: Bool, onChunk: @escaping (Data, Float) -> Void) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: conversation ? .voiceChat : .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let input = engine.inputNode
        if conversation { try? input.setVoiceProcessingEnabled(true) }
        if conversation, !wired, let speech {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: speech)
            wired = true
        }
        let format = input.outputFormat(forBus: 0)
        guard let wire, format.sampleRate > 0 else { throw APIError(status: 0) }
        converter = AVAudioConverter(from: format, to: wire)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            guard let self, let chunk = self.convert(buffer) else { return }
            DispatchQueue.main.async { onChunk(chunk.0, chunk.1) }
        }
        engine.prepare()
        try engine.start()
        running = true
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> (Data, Float)? {
        guard let converter, let wire else { return nil }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * wire.sampleRate / buffer.format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: capacity) else { return nil }
        var fed = false
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        let count = Int(out.frameLength)
        guard count > 0, let samples = out.int16ChannelData?[0] else { return nil }
        var power: Float = 0
        for i in 0..<count {
            let v = Float(samples[i]) / 32768
            power += v * v
        }
        return (Data(bytes: samples, count: count * 2), (power / Float(count)).squareRoot())
    }

    func play(_ pcm: Data) {
        guard running, let speech else { return }
        let count = pcm.count / 2
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: speech, frameCapacity: AVAudioFrameCount(count)), let out = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        pcm.withUnsafeBytes { raw in
            let source = raw.bindMemory(to: Int16.self)
            for i in 0..<count { out[i] = Float(Int16(littleEndian: source[i])) / 32768 }
        }
        queued += 1
        let mine = round
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.round == mine else { return }
                self.queued = max(0, self.queued - 1)
                if self.queued == 0 { self.onDrain?() }
            }
        }
        if !player.isPlaying { player.play() }
    }

    func hush() {
        round += 1
        queued = 0
        if running, wired { player.stop() }
    }

    func stop() {
        guard running else { return }
        running = false
        round += 1
        queued = 0
        engine.inputNode.removeTap(onBus: 0)
        if wired { player.stop() }
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

@MainActor
final class Speaker {
    static let shared = Speaker()
    private let voice = AVSpeechSynthesizer()

    func say(_ text: String) {
        if voice.isSpeaking {
            voice.stopSpeaking(at: .immediate)
            return
        }
        let plain = text.replacingOccurrences(of: "[*_`#>]", with: "", options: .regularExpression)
        let line = AVSpeechUtterance(string: plain)
        line.voice = AVSpeechSynthesisVoice(language: "pl-PL")
        voice.speak(line)
    }
}

@MainActor
final class LiveSocket {
    private var task: URLSessionWebSocketTask?
    var onMessage: ((JSON) -> Void)?
    var onClose: (() -> Void)?

    var isOpen: Bool { task != nil }

    func open(_ url: URL, setup: JSON) {
        let fresh = URLSession.shared.webSocketTask(with: url)
        task = fresh
        fresh.resume()
        send(["setup": setup])
        Task {
            while task === fresh {
                guard let message = try? await fresh.receive() else { break }
                guard task === fresh else { return }
                switch message {
                case .string(let text): if let json = JSON.parse(text) { onMessage?(json) }
                case .data(let data): if let json = JSON.parse(data) { onMessage?(json) }
                @unknown default: break
                }
            }
            if task === fresh {
                task = nil
                onClose?()
            }
        }
    }

    func send(_ json: JSON) {
        guard let task, let text = String(data: json.data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    func audio(_ pcm: Data) {
        send(["realtimeInput": ["audio": ["data": .string(pcm.base64EncodedString()), "mimeType": "audio/pcm;rate=16000"]]])
    }

    func close() {
        let old = task
        task = nil
        old?.cancel(with: .normalClosure, reason: nil)
    }
}

@MainActor @Observable
final class Dictation {
    var active = false
    var levels: [CGFloat] = []
    @ObservationIgnored private let mic = AudioLink()
    @ObservationIgnored private let socket = LiveSocket()
    @ObservationIgnored private var queue: [Data] = []
    @ObservationIgnored private var live = false
    @ObservationIgnored private var over = false
    @ObservationIgnored private var done = false
    @ObservationIgnored private var final = ""
    @ObservationIgnored private var interim = ""
    @ObservationIgnored private var touched = Date()
    @ObservationIgnored private var startedAt = Date()

    func start(_ model: AppModel) async -> Bool {
        guard !active else { return true }
        guard await AVAudioApplication.requestRecordPermission() else {
            Journal.shared.note("dictation: microphone not allowed")
            return false
        }
        startedAt = Date()
        queue = []
        live = false
        over = false
        done = false
        final = ""
        interim = ""
        levels = []
        do {
            try mic.start(conversation: false) { [weak self] data, level in self?.heard(data, level) }
        } catch {
            Journal.shared.note("dictation: microphone failed", error.brief)
            return false
        }
        active = true
        socket.onMessage = { [weak self] message in self?.handle(message) }
        socket.onClose = { [weak self] in self?.done = true }
        Task {
            guard let ticket = try? await model.call("/api/voice/token", ["mode": "dictate"]), let url = URL(string: ticket["url"].text), active else {
                if active { Journal.shared.note("dictation: no token from the server") }
                done = true
                return
            }
            socket.open(url, setup: ticket["setup"])
        }
        return true
    }

    private func heard(_ data: Data, _ level: Float) {
        guard !over else { return }
        levels.append(CGFloat(level))
        if levels.count > 72 { levels.removeFirst(levels.count - 72) }
        if live { socket.audio(data) } else if queue.count < 900 { queue.append(data) }
    }

    private func handle(_ message: JSON) {
        if !message["setupComplete"].isNull {
            live = true
            for chunk in queue { socket.audio(chunk) }
            queue = []
            return
        }
        let content = message["serverContent"]
        if let text = content["inputTranscription"]["text"].string {
            final += text
            interim = ""
            touched = Date()
        }
        if let text = content["interimInputTranscription"]["text"].string {
            interim = text
            touched = Date()
        }
        if over, content["generationComplete"].bool == true || content["turnComplete"].bool == true { done = true }
    }

    func stop() async -> String {
        guard active, !over else { return "" }
        over = true
        mic.stop()
        let began = Date()
        while !live, !done, Date().timeIntervalSince(began) < 3 { try? await Task.sleep(for: .milliseconds(40)) }
        if live {
            socket.send(["realtimeInput": ["audioStreamEnd": true]])
            let asked = Date()
            touched = asked
            while !done, Date().timeIntervalSince(asked) < 2.6, !(Date().timeIntervalSince(asked) > 0.3 && Date().timeIntervalSince(touched) > 0.65) {
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
        socket.close()
        active = false
        let text = tidy("\(final) \(interim)")
        Journal.shared.note("dictation done", "\(text.count) chars, recorded \(Int(began.timeIntervalSince(startedAt))) s, text after \(Journal.since(began)), transcriber \(live ? "connected" : "never connected")")
        return text
    }

    func cancel() {
        guard active else { return }
        over = true
        mic.stop()
        socket.close()
        active = false
    }
}

@MainActor @Observable
final class VoiceCenter {
    var running = false
    var presented = false
    var state = "connecting"
    var level: CGFloat = 0
    var muted = false
    var ended = ""

    @ObservationIgnored private let link = AudioLink()
    @ObservationIgnored private var socket = LiveSocket()
    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private var live = false
    @ObservationIgnored private var busy = 0
    @ObservationIgnored private var drop = false
    @ObservationIgnored private var queue: [Data] = []
    @ObservationIgnored private var tape: [Data] = []
    @ObservationIgnored private var cut = 0
    @ObservationIgnored private var voiceModel = ""
    @ObservationIgnored private var swaps = 0
    @ObservationIgnored private var replay = false
    @ObservationIgnored private var startedAt: Date?
    @ObservationIgnored private var loudAt = Date()
    @ObservationIgnored private var floor: Float = 0.01
    @ObservationIgnored private var began = Date()
    @ObservationIgnored private var turns = 0

    private static let silence = Data(count: 1600)

    var label: String { ["connecting": "Łączę", "listening": "Słucha", "thinking": "Sprawdza", "speaking": "Mówi"][state] ?? "" }
    var mood: String { ["connecting": "idle", "listening": "listening", "thinking": "thinking", "speaking": "speaking"][state] ?? "idle" }

    func start(_ model: AppModel) async {
        guard !running else {
            presented = true
            return
        }
        guard await AVAudioApplication.requestRecordPermission() else {
            Journal.shared.note("voice: microphone not allowed")
            model.say("Włącz mikrofon dla Valeta w Ustawieniach iPhone'a")
            return
        }
        self.model = model
        began = Date()
        turns = 0
        live = false
        busy = 0
        drop = false
        muted = false
        swaps = 0
        replay = false
        startedAt = nil
        ended = ""
        tape = []
        cut = 0
        queue = Array(repeating: VoiceCenter.silence, count: 6)
        state = "connecting"
        link.onDrain = { [weak self] in
            guard let self, self.running, self.busy == 0 else { return }
            self.state = "listening"
        }
        do {
            try link.start(conversation: true) { [weak self] data, level in self?.heard(data, level) }
        } catch {
            Journal.shared.note("voice: microphone failed", error.brief)
            model.say("Nie udało się włączyć mikrofonu")
            return
        }
        Journal.shared.note("voice start")
        running = true
        presented = true
        UIApplication.shared.isIdleTimerDisabled = true
        await connect(slow: "")
    }

    private func connect(slow: String) async {
        guard let model else { return }
        guard let ticket = try? await model.call("/api/voice/token", slow.isEmpty ? [:] : ["slow": .string(slow)]), let url = URL(string: ticket["url"].text) else {
            Journal.shared.note("voice: no token from the server")
            end("Nie udało się połączyć z głosem.")
            return
        }
        guard running else { return }
        voiceModel = ticket["model"].text
        let fresh = LiveSocket()
        socket = fresh
        fresh.onMessage = { [weak self, weak fresh] message in
            guard let self, let fresh, self.socket === fresh else { return }
            self.handle(message)
        }
        fresh.onClose = { [weak self, weak fresh] in
            guard let self, let fresh, self.socket === fresh else { return }
            self.end(self.live ? "" : "Nie udało się połączyć z głosem.")
        }
        fresh.open(url, setup: ticket["setup"])
    }

    private func push(_ chunk: Data) {
        socket.audio(chunk)
        tape.append(chunk)
        if tape.count > 600 {
            tape.removeFirst()
            cut += 1
        }
    }

    private func heard(_ data: Data, _ loudness: Float) {
        guard running else { return }
        if !live {
            level = muted ? 0 : CGFloat(loudness)
            if !muted, queue.count < 600 { queue.append(data) }
            return
        }
        let open = !muted && busy == 0
        level = open ? CGFloat(loudness) : 0
        guard open else { return }
        push(data)
        let now = Date()
        floor = min(loudness, floor * 1.01 + 0.0001)
        if loudness > max(0.012, floor * 3) { loudAt = now }
        if let began = startedAt, now.timeIntervalSince(began) > 2.2, now.timeIntervalSince(loudAt) > 1.9 { swap() }
    }

    private func swap() {
        startedAt = nil
        if swaps >= 2 {
            end("Głos teraz nie odpowiada. Spróbuj za chwilę.")
            return
        }
        swaps += 1
        Journal.shared.note("voice stalled, switching model", voiceModel)
        let old = socket, slow = voiceModel
        live = false
        replay = true
        queue = Array(repeating: VoiceCenter.silence, count: 6) + tape
        socket = LiveSocket()
        old.close()
        state = "thinking"
        Task { await connect(slow: slow) }
    }

    private func handle(_ message: JSON) {
        if !message["setupComplete"].isNull {
            live = true
            tape = []
            cut = 0
            let waiting = queue
            queue = []
            for chunk in waiting { push(chunk) }
            loudAt = Date()
            Journal.shared.note("voice ready", "\(voiceModel), \(Journal.since(began)) after start\(replay ? ", replaying \(waiting.count) chunks" : "")")
            Haptic.done()
            if !replay {
                state = "listening"
            } else {
                Task {
                    try? await Task.sleep(for: .seconds(7))
                    if replay {
                        replay = false
                        if state == "thinking", busy == 0 { state = "listening" }
                    }
                }
            }
            return
        }
        let activity = message["voiceActivity"]
        if activity["type"].text == "ACTIVITY_START" {
            startedAt = Date()
            let offset = Double(activity["audioOffset"].text.replacingOccurrences(of: "s", with: "")) ?? 0
            let spare = max(0, min(tape.count, Int(offset * 20) - 10 - cut))
            tape.removeFirst(spare)
            cut += spare
        }
        if activity["type"].text == "ACTIVITY_END" { startedAt = nil }
        let content = message["serverContent"]
        if !message["toolCall"].isNull || !content["modelTurn"].isNull {
            startedAt = nil
            replay = false
            cut += tape.count
            tape = []
        }
        if !message["toolCall"].isNull {
            ask(message["toolCall"]["functionCalls"].array)
            return
        }
        if !message["goAway"].isNull {
            end("Rozmowa trwała długo, więc ją zakończyłem. Możesz zacząć nową.")
            return
        }
        for part in content["modelTurn"]["parts"].array {
            if let encoded = part["inlineData"]["data"].string, !drop, let pcm = Data(base64Encoded: encoded) {
                link.play(pcm)
                state = "speaking"
            }
        }
        if content["interrupted"].bool == true { link.hush() }
        if content["turnComplete"].bool == true {
            drop = false
            if link.queued == 0, busy == 0 { state = "listening" }
        }
    }

    private func ask(_ calls: [JSON]) {
        guard let model else { return }
        busy += 1
        turns += 1
        state = "thinking"
        let line = socket, asked = Date()
        Task {
            var answers: [JSON] = []
            for call in calls {
                var result = "Nie udało się połączyć z Valetem."
                if let reply = try? await model.call("/api/voice/ask", ["text": .string(call["args"]["request"].text)], timeout: 90), let said = reply["reply"].string, !said.isEmpty { result = said }
                answers.append(["id": call["id"], "name": call["name"], "response": ["result": .string(result)]])
            }
            busy = max(0, busy - 1)
            Journal.shared.note("voice question answered", "\(calls.count) call, \(Journal.since(asked))")
            guard running, socket === line else { return }
            line.send(["toolResponse": ["functionResponses": .array(answers)]])
        }
    }

    func interrupt() {
        guard link.queued > 0 else { return }
        Haptic.tap()
        drop = true
        link.hush()
        state = "listening"
    }

    func toggleMute() {
        muted.toggle()
        Haptic.tap()
    }

    func end(_ message: String = "") {
        guard running else { return }
        Journal.shared.note("voice end", "\(message.isEmpty ? "by the owner or the server" : message), lasted \(Int(Date().timeIntervalSince(began))) s, \(turns) questions, connected \(live)")
        running = false
        presented = false
        live = false
        level = 0
        link.hush()
        link.stop()
        let old = socket
        socket = LiveSocket()
        old.close()
        UIApplication.shared.isIdleTimerDisabled = false
        if !message.isEmpty { model?.say(message) }
    }
}
