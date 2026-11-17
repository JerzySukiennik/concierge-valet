// Concierge Valet for macOS: reads WhatsApp Desktop's local database, read only: the chat list, messages with their authors' names and new incoming messages of watched chats.
import AppKit
import SQLite3

enum WhatsAppStore {
    static let bundleID = "net.whatsapp.WhatsApp"
    private static let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Group Containers/group.net.whatsapp.WhatsApp.shared")
    private static let epoch: Double = 978_307_200
    private static let media: [Int64: String] = [1: "[zdjęcie]", 2: "[film]", 3: "[wiadomość głosowa]", 8: "[plik]", 66: "[album zdjęć]"]
    private static let skipped: Set<Int64> = [6, 10, 14, 15]

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    struct Chat {
        let pk: Int64
        let name: String
        let group: Bool
        let last: Double
        let unread: Int64
    }

    enum Match {
        case one(Chat)
        case many([String])
    }

    static var running: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty }

    static var available: Bool { (try? query("SELECT count(*) AS n FROM ZWACHATSESSION")) != nil }

    private static func query(_ sql: String, _ args: [Any] = []) throws -> [[String: Any]] {
        let path = base.appendingPathComponent("ChatStorage.sqlite").path
        guard FileManager.default.fileExists(atPath: path) else { throw Failure("Na tym Macu nie ma danych WhatsAppa.") }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            sqlite3_close(db)
            throw Failure("Mac nie pozwolił odczytać danych WhatsAppa. Zezwól aplikacji Concierge Valet na dostęp do danych innych aplikacji.")
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 1500)
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw Failure("Mac nie pozwolił odczytać danych WhatsAppa albo baza ma inny układ: \(String(cString: sqlite3_errmsg(db)))")
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (i, arg) in args.enumerated() {
            let n = Int32(i + 1)
            switch arg {
            case let v as Int64: sqlite3_bind_int64(statement, n, v)
            case let v as Int: sqlite3_bind_int64(statement, n, Int64(v))
            case let v as Double: sqlite3_bind_double(statement, n, v)
            case let v as String: sqlite3_bind_text(statement, n, v, -1, transient)
            default: sqlite3_bind_null(statement, n)
            }
        }
        var out: [[String: Any]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            var row: [String: Any] = [:]
            for c in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, c))
                switch sqlite3_column_type(statement, c) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, c)
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, c)
                case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(statement, c))
                default: break
                }
            }
            out.append(row)
        }
        return out
    }

    static func clean(_ s: String) -> String {
        let hidden = CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}")
        return String(String.UnicodeScalarView(s.unicodeScalars.filter { !hidden.contains($0) })).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func fold(_ s: String) -> String {
        clean(s).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).replacingOccurrences(of: "ł", with: "l")
    }

    private static func number(_ v: Any?) -> Double {
        (v as? Double) ?? Double((v as? Int64) ?? 0)
    }

    private static func sessions() throws -> [Chat] {
        try query("SELECT Z_PK AS pk, ZPARTNERNAME AS name, ZSESSIONTYPE AS type, ZLASTMESSAGEDATE AS last, ZUNREADCOUNT AS unread FROM ZWACHATSESSION WHERE ZSESSIONTYPE IN (0, 1) AND IFNULL(ZREMOVED, 0) = 0 AND ZPARTNERNAME IS NOT NULL ORDER BY ZLASTMESSAGEDATE DESC").compactMap { row in
            let name = clean(row["name"] as? String ?? "")
            guard !name.isEmpty, let pk = row["pk"] as? Int64 else { return nil }
            return Chat(pk: pk, name: name, group: (row["type"] as? Int64) == 1, last: number(row["last"]), unread: max(0, row["unread"] as? Int64 ?? 0))
        }
    }

    static func chats(query text: String, limit: Int) throws -> [[String: Any]] {
        let q = fold(text)
        return try sessions().filter { q.isEmpty || fold($0.name).contains(q) }.prefix(limit).map {
            ["name": $0.name, "group": $0.group, "last": $0.last > 0 ? ($0.last + epoch) * 1000 : 0, "unread": $0.unread]
        }
    }

    static func find(_ text: String) throws -> Match {
        let q = fold(text)
        guard !q.isEmpty else { return .many([]) }
        let all = try sessions()
        let exact = all.filter { fold($0.name) == q }
        let found = exact.isEmpty ? all.filter { fold($0.name).contains(q) } : exact
        let names = Array(NSOrderedSet(array: found.map(\.name))) as? [String] ?? []
        if found.count == 1 { return .one(found[0]) }
        return .many(Array(names.prefix(8)))
    }

    private static func authors(_ chat: Chat) throws -> [Int64: String] {
        var out: [Int64: String] = [:]
        var unknown = 0
        for row in try query("SELECT gm.Z_PK AS pk, gm.ZCONTACTNAME AS contact, gm.ZFIRSTNAME AS first, p.ZPUSHNAME AS push FROM ZWAGROUPMEMBER gm LEFT JOIN ZWAPROFILEPUSHNAME p ON p.ZJID = gm.ZMEMBERJID WHERE gm.ZCHATSESSION = ? ORDER BY gm.Z_PK", [chat.pk]) {
            guard let pk = row["pk"] as? Int64 else { continue }
            let name = [row["contact"], row["first"], row["push"]].compactMap { clean($0 as? String ?? "") }.first { !$0.isEmpty }
            if let name { out[pk] = name } else { unknown += 1; out[pk] = "osoba \(unknown)" }
        }
        return out
    }

    private static func body(_ row: [String: Any]) -> String? {
        let type = row["type"] as? Int64 ?? 0
        if skipped.contains(type) { return nil }
        let text = clean(row["text"] as? String ?? "")
        var caption = clean(row["caption"] as? String ?? "")
        if caption.range(of: "^(@\\d+\\s*)+$", options: .regularExpression) != nil { caption = "" }
        if let label = media[type] { return [label, text.isEmpty ? caption : text].filter { !$0.isEmpty }.joined(separator: " ") }
        return text.isEmpty ? nil : String(text.prefix(1500))
    }

    static func read(chat text: String, since: Double, limit: Int) throws -> [String: Any] {
        let chat: Chat
        switch try find(text) {
        case .one(let found): chat = found
        case .many(let names): return ["candidates": names]
        }
        let names = chat.group ? try authors(chat) : [:]
        let rows = try query("SELECT m.Z_PK AS id, m.ZMESSAGEDATE AS date, m.ZMESSAGETYPE AS type, m.ZTEXT AS text, m.ZISFROMME AS me, m.ZGROUPMEMBER AS member, mi.ZTITLE AS caption FROM ZWAMESSAGE m LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM WHERE m.ZCHATSESSION = ? AND m.ZMESSAGEDATE >= ? ORDER BY m.ZMESSAGEDATE DESC LIMIT ?", [chat.pk, since / 1000 - epoch, limit])
        var messages: [[String: Any]] = []
        for row in rows.reversed() {
            guard let text = body(row) else { continue }
            let me = (row["me"] as? Int64 ?? 0) == 1
            let from = me ? "Jurek" : chat.group ? names[row["member"] as? Int64 ?? -1] ?? "ktoś" : chat.name
            messages.append(["id": row["id"] as? Int64 ?? 0, "ts": (number(row["date"]) + epoch) * 1000, "from": from, "me": me, "text": text])
        }
        return ["chat": chat.name, "group": chat.group, "messages": messages]
    }

    static func newest() -> Int64 {
        ((try? query("SELECT max(Z_PK) AS pk FROM ZWAMESSAGE"))?.first?["pk"] as? Int64) ?? 0
    }

    static func fresh(after last: Int64, watch: [String], minutes: Double = 30) throws -> [[String: Any]] {
        let wanted = watch.map(fold).filter { !$0.isEmpty }
        guard !wanted.isEmpty else { return [] }
        let watched = try sessions().filter { chat in wanted.contains { fold(chat.name).hasPrefix($0) } }
        var out: [[String: Any]] = []
        let recent = Date().timeIntervalSince1970 - epoch - minutes * 60
        for chat in watched {
            let names = chat.group ? try authors(chat) : [:]
            let rows = try query("SELECT m.Z_PK AS id, m.ZMESSAGEDATE AS date, m.ZMESSAGETYPE AS type, m.ZTEXT AS text, m.ZGROUPMEMBER AS member, mi.ZTITLE AS caption FROM ZWAMESSAGE m LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM WHERE m.ZCHATSESSION = ? AND m.Z_PK > ? AND m.ZISFROMME = 0 AND m.ZMESSAGEDATE >= ? ORDER BY m.Z_PK LIMIT 60", [chat.pk, last, recent])
            for row in rows {
                guard let text = body(row) else { continue }
                out.append(["id": row["id"] as? Int64 ?? 0, "chat": chat.name, "group": chat.group, "ts": (number(row["date"]) + epoch) * 1000, "from": chat.group ? names[row["member"] as? Int64 ?? -1] ?? "ktoś" : chat.name, "text": text])
            }
        }
        return out.sorted { ($0["id"] as? Int64 ?? 0) < ($1["id"] as? Int64 ?? 0) }
    }

    static func launchHidden() {
        guard !running, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        config.hides = true
        config.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: url, configuration: config, completionHandler: nil)
    }
}
