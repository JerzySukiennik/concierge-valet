// A small diagnostic journal: what the app tried and where it failed (launches, lost connections, voice, dictation, sending), without any message content. Entries wait on the phone and are posted to the owner's server in batches.
import Foundation
import UIKit

@MainActor
final class Journal {
    static let shared = Journal()
    static let started: Date = {
        guard ProcessInfo.processInfo.environment["ActivePrewarm"] != "1" else { return Date() }
        var info = kinfo_proc(), size = MemoryLayout<kinfo_proc>.stride
        var name = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, 4, &info, &size, nil, 0) == 0 else { return Date() }
        let at = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: Double(at.tv_sec) + Double(at.tv_usec) / 1_000_000)
    }()

    var post: (([JSON]) async -> Bool)?
    private var queue: [[String: Any]] = UserDefaults.standard.array(forKey: "journal") as? [[String: Any]] ?? []
    private var flushing: Task<Void, Never>?
    private var sending = false

    func note(_ what: String, _ detail: String = "") {
        queue.append(["ts": (Date().timeIntervalSince1970 * 1000).rounded(), "what": String(what.prefix(80)), "detail": String(detail.prefix(400))])
        if queue.count > 300 { queue.removeFirst(queue.count - 300) }
        UserDefaults.standard.set(queue, forKey: "journal")
        flushing?.cancel()
        flushing = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await flush()
        }
    }

    func flush() async {
        guard !queue.isEmpty, !sending, let post else { return }
        sending = true
        defer { sending = false }
        let count = queue.count
        guard await post(queue.map(JSON.init(any:))) else { return }
        queue.removeFirst(min(count, queue.count))
        UserDefaults.standard.set(queue, forKey: "journal")
    }

    static var build: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?")), iOS \(UIDevice.current.systemVersion)"
    }

    static func since(_ moment: Date) -> String { "\(Int(Date().timeIntervalSince(moment) * 1000)) ms" }
}
