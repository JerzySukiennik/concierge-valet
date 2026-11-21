// Look of the app: the "Papier" palette in light and dark, type, shared control styles and haptics.
import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    init(hex: UInt32) { self.init(UIColor(hex: hex)) }

    init?(css: String?) {
        guard let css, css.hasPrefix("#"), css.count == 7, let value = UInt32(css.dropFirst(), radix: 16) else { return nil }
        self.init(hex: value)
    }
}

enum Paper {
    static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    static let bg = pair(0xF6F3EC, 0x1B1A17)
    static let fg = pair(0x201E1A, 0xECE7DC)
    static let muted = pair(0x857F74, 0x8F897D)
    static let faint = pair(0xB5AE9F, 0x5D584F)
    static let soft = pair(0xECE7DC, 0x2A2824)
    static let card = pair(0xFFFDF9, 0x23211D)
    static let line = pair(0xE6E0D3, 0x33302A)
    static let sep = pair(0xEEE9DE, 0x302D28)
    static let accent = pair(0x1F5A46, 0x63B895)
    static let onAccent = pair(0xFFFFFF, 0x0F1F18)
    static let tint = pair(0xE2EBE3, 0x1F2E27)
    static let tintFg = pair(0x1B4F3D, 0x8ED3B4)
    static let me = pair(0xE9E3D6, 0x34312B)
    static let field = pair(0xFFFDF9, 0x24221E)
    static let ink = pair(0x201E1A, 0xECE7DC)
    static let onInk = pair(0xF6F3EC, 0x1B1A17)
    static let err = pair(0xA5382A, 0xE2735F)
    static let orange = pair(0xD9822B, 0xE09A4F)
    static let scrim = pair(0x1E180C, 0x000000)
    static let live = Color(hex: 0x2FA46F)
}

enum Face {
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .serif) }
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func round(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func press() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func done() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func fail() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func pick() { UISelectionFeedbackGenerator().selectionChanged() }
}

enum Motion {
    static let snap = Animation.spring(response: 0.3, dampingFraction: 1)
    static let move = Animation.spring(response: 0.4, dampingFraction: 1)
    static let lively = Animation.spring(response: 0.38, dampingFraction: 0.8)
}

struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct PillStyle: ButtonStyle {
    var solid = false
    var height: CGFloat = 42
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Face.sans(15, .semibold))
            .lineLimit(1)
            .padding(.horizontal, 16)
            .frame(height: height)
            .frame(minWidth: 64)
            .foregroundStyle(solid ? Paper.onAccent : Paper.fg)
            .background(solid ? Paper.accent : Paper.soft, in: Capsule())
            .opacity(enabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct CardShell<Content: View>: View {
    var radius: CGFloat = 22
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Paper.card)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Paper.line, lineWidth: 1))
    }
}

struct CardHead: View {
    let symbol: String
    let title: String
    var detail = ""

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
            Text(title).font(Face.sans(12.5, .semibold))
            if !detail.isEmpty { Text(detail).font(Face.sans(12.5)).lineLimit(1).truncationMode(.tail) }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Paper.muted)
        .padding(.horizontal, 14)
        .padding(.top, 12)
    }
}

struct CardFoot<Actions: View>: View {
    let state: String
    var failed = false
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 8) {
            Text(state).font(Face.sans(13)).foregroundStyle(failed ? Paper.err : Paper.muted).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

extension View {
    func hairline(_ edge: VerticalEdge = .top) -> some View {
        overlay(alignment: edge == .top ? .top : .bottom) { Rectangle().fill(Paper.sep).frame(height: 1) }
    }
}

enum When {
    static let warsaw = TimeZone(identifier: "Europe/Warsaw") ?? .current
    static let locale = Locale(identifier: "pl_PL")

    static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = warsaw
        f.dateFormat = format
        return f
    }

    static let clock = formatter("H:mm")
    static let dayLong = formatter("EEEE, d MMMM")
    static let dayShort = formatter("d MMM")
    static let weekdayShort = formatter("EEE")
    static let dayNumber = formatter("d")
    static let key = formatter("yyyy-MM-dd")
    static let stamp = formatter("d MMM, H:mm")

    static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
    static func time(_ ms: Double) -> String { clock.string(from: date(ms)) }

    static func dayTitle(_ ms: Double) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = warsaw
        let day = date(ms)
        if cal.isDateInToday(day) { return "Dzisiaj" }
        if cal.isDateInYesterday(day) { return "Wczoraj" }
        return dayLong.string(from: day)
    }

    static func near(_ ms: Double) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = warsaw
        let day = date(ms)
        if cal.isDateInToday(day) { return "dziś \(time(ms))" }
        if cal.isDateInTomorrow(day) { return "jutro \(time(ms))" }
        return "\(weekdayShort.string(from: day)) \(time(ms))"
    }
}
