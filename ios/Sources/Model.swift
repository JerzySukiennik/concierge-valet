// Data the server speaks: a loose JSON value and thin typed views over it, so a field the server adds never breaks decoding.
import Foundation

struct APIError: Error { let status: Int }

extension Error {
    var brief: String {
        if let refused = self as? APIError { return refused.status == 0 ? "no answer from the server" : "HTTP \(refused.status)" }
        if let network = self as? URLError { return "network \(network.code.rawValue)" }
        let plain = self as NSError
        return "\(plain.domain) \(plain.code)"
    }
}

enum JSON: Hashable, ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(any value: Any) {
        switch value {
        case let text as String: self = .string(text)
        case let number as NSNumber: self = CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
        case let list as [Any]: self = .array(list.map(JSON.init(any:)))
        case let map as [String: Any]: self = .object(map.mapValues(JSON.init(any:)))
        default: self = .null
        }
    }

    var any: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let v): return v
        case .number(let v): return v == v.rounded() && abs(v) < 1e15 ? NSNumber(value: Int64(v)) : NSNumber(value: v)
        case .string(let v): return v
        case .array(let v): return v.map(\.any)
        case .object(let v): return v.mapValues(\.any)
        }
    }

    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(floatLiteral value: Double) { self = .number(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(arrayLiteral elements: JSON...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, JSON)...) { self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last })) }
    init(nilLiteral: ()) { self = .null }

    static func parse(_ data: Data) -> JSON? { (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])).map(JSON.init(any:)) }
    static func parse(_ text: String) -> JSON? { parse(Data(text.utf8)) }
    var data: Data { (try? JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed])) ?? Data("null".utf8) }

    subscript(key: String) -> JSON {
        get { if case .object(let o) = self { return o[key] ?? .null }; return .null }
        set {
            var o: [String: JSON] = [:]
            if case .object(let old) = self { o = old }
            o[key] = newValue
            self = .object(o)
        }
    }

    subscript(index: Int) -> JSON {
        if case .array(let a) = self, a.indices.contains(index) { return a[index] }
        return .null
    }

    var string: String? { if case .string(let v) = self { return v }; return nil }
    var double: Double? {
        switch self {
        case .number(let v): return v
        case .string(let v): return Double(v)
        default: return nil
        }
    }
    var int: Int? { double.flatMap { $0.isFinite ? Int($0) : nil } }
    var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
    var array: [JSON] { if case .array(let v) = self { return v }; return [] }
    var object: [String: JSON] { if case .object(let v) = self { return v }; return [:] }
    var isNull: Bool { self == .null }
    var text: String { string ?? "" }
}

struct Message: Identifiable, Hashable {
    var raw: JSON

    var id: Int { raw["id"].int ?? 0 }
    var ts: Double { raw["ts"].double ?? 0 }
    var who: String { raw["who"].string ?? "agent" }
    var agent: String { raw["agent"].string ?? "valet" }
    var kind: String { let k = raw["kind"].text; return k.isEmpty ? "text" : k }
    var text: String { raw["text"].text }
    var replyTo: Int? { raw["reply_to"].int }
    var mine: Bool { who == "me" }
    var data: JSON {
        let d = raw["data"]
        if case .string(let s) = d, let parsed = JSON.parse(s) { return parsed }
        return d
    }
    var files: [FileItem] { data["files"].array.map(FileItem.init) }

    static let cards: Set<String> = ["videos", "title", "titles", "image", "agenda", "event", "wa", "code", "ask", "recipe", "skill"]
    static let known: Set<String> = cards.union(["text", "remind", "error", "task", "sky", "brief"])

    var isBubble: Bool { who != "sys" && !Message.cards.contains(kind) && !["task", "sky", "brief"].contains(kind) }

    var waits: Bool {
        switch kind {
        case "wa": return ["draft", "failed"].contains(data["wa"]["state"].text)
        case "ask": return data["ask"]["state"].text == "open"
        case "event": return data["event"]["op"].text == "ask_delete" && data["event"]["done"].isNull
        case "skill": return ["draft", "failed"].contains(data["skill"]["state"].text)
        default: return false
        }
    }
}

struct FileItem: Identifiable, Hashable {
    var raw: JSON
    var id: String { raw["id"].text }
    var name: String { raw["name"].text }
    var mime: String { raw["mime"].text }
    var size: Int { raw["size"].int ?? 0 }
    var ts: Double { raw["ts"].double ?? 0 }
    var width: Double { raw["w"].double ?? 0 }
    var height: Double { raw["h"].double ?? 0 }
    var isImage: Bool { mime.hasPrefix("image/") }
    var ratio: Double { width > 0 && height > 0 ? width / height : 4 / 3 }
    var ext: String { name.lowercased().hasSuffix(".shortcut") ? "SKR" : String((name.split(separator: ".").last ?? "").prefix(4)).uppercased() }

    var label: String {
        if isImage { return "Obrazek" }
        let kinds = ["SKR": "Skrót na iPhone", "PDF": "Dokument PDF", "DOC": "Dokument Word", "DOCX": "Dokument Word", "XLS": "Arkusz", "XLSX": "Arkusz", "CSV": "Arkusz", "PPT": "Prezentacja", "PPTX": "Prezentacja", "HTML": "Strona", "HTM": "Strona", "MD": "Tekst", "TXT": "Tekst", "ZIP": "Archiwum"]
        return kinds[ext] ?? "Plik"
    }

    var sizeText: String {
        size >= 1_048_576 ? String(format: "%.1f MB", Double(size) / 1_048_576).replacingOccurrences(of: ".", with: ",") : "\(max(1, size / 1024)) KB"
    }
}

struct TaskItem: Identifiable, Hashable {
    var raw: JSON
    var id: Int { raw["id"].int ?? 0 }
    var title: String { raw["title"].text }
    var status: String { raw["status"].text }
    var step: String { raw["step"].text }
    var agent: String { raw["agent"].string ?? "valet" }
    var usd: Double { raw["usd"].double ?? 0 }
    var updated: Double { raw["updated"].double ?? raw["ts"].double ?? 0 }
    var running: Bool { status == "running" }

    var line: String {
        if running { return step.isEmpty ? "Pracuje" : step }
        switch status {
        case "done": return "Gotowe"
        case "cancelled": return "Przerwane"
        default: return "Nie udało się"
        }
    }
}

struct Outgoing: Identifiable, Hashable {
    let id = UUID()
    var text: String
    var picks: [Pick]
    var ts = Date().timeIntervalSince1970 * 1000
    var failed = false
}

struct Pick: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var mime: String
    var data: Data
    var width = 0
    var height = 0
    var isImage: Bool { mime.hasPrefix("image/") }
}

func money(_ value: Double) -> String { String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",") }

func tidy(_ text: String) -> String {
    var out = text
    let kept: Set<String> = ["nie", "tak", "no", "ha", "he", "oj", "aj", "hej"]
    if let filler = try? NSRegularExpression(pattern: "(^|[\\s,])(?:e{2,}m?|y{2,}m?|m{3,}|hm{2,})(?=[\\s,.!?]|$),?", options: [.caseInsensitive]) {
        out = filler.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "$1")
    }
    if let twice = try? NSRegularExpression(pattern: "(^|[^\\p{L}])(\\p{L}{1,4})(?:\\s+\\2)+(?=[^\\p{L}]|$)", options: [.caseInsensitive]) {
        let source = out as NSString, result = NSMutableString(string: out)
        for match in twice.matches(in: out, range: NSRange(location: 0, length: source.length)).reversed() {
            let word = source.substring(with: match.range(at: 2))
            if kept.contains(word.lowercased()) { continue }
            result.replaceCharacters(in: match.range, with: source.substring(with: match.range(at: 1)) + word)
        }
        out = result as String
    }
    out = out.replacingOccurrences(of: "\\s+([,.!?])", with: "$1", options: .regularExpression)
    out = out.replacingOccurrences(of: ",\\s*,", with: ",", options: .regularExpression)
    out = out.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    if let first = out.first, first.isLowercase { out = first.uppercased() + out.dropFirst() }
    return out
}
