// The agents' avatars drawn from the same settings as the web app: orbita, buzka and piksel, each reacting to the agent's state.
import SwiftUI

struct AvatarView: View {
    let avatar: JSON
    var state = "idle"
    var size: CGFloat = 28
    var animated = true

    private var puck: Color { Color(css: avatar["cfg"]["pk"].string) ?? .white }
    private var ink: Color { Color(css: avatar["cfg"]["ink"].string) ?? Color(hex: 0x1D1C19) }
    private var accent: Color { Color(css: avatar["cfg"]["acc"].string) ?? Color(hex: 0x1F5A46) }

    var body: some View {
        Group {
            if animated {
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: state == "sleeping")) { timeline in
                    canvas(timeline.date.timeIntervalSinceReferenceDate)
                }
            } else {
                canvas(0)
            }
        }
        .frame(width: size, height: size)
        .background(puck, in: Circle())
        .overlay(Circle().strokeBorder(Color.primary.opacity(0.09), lineWidth: 1))
        .shadow(color: .black.opacity(size > 40 ? 0.18 : 0.1), radius: size > 40 ? 14 : 5, y: size > 40 ? 10 : 3)
        .opacity(state == "sleeping" ? 0.72 : 1)
        .accessibilityHidden(true)
    }

    private func canvas(_ t: Double) -> some View {
        Canvas { context, box in
            context.scaleBy(x: box.width / 100, y: box.height / 100)
            switch avatar["type"].text {
            case "buzka": face(&context, t)
            case "piksel": pixels(&context, t)
            default: orbit(&context, t)
            }
        }
    }

    private func orbit(_ context: inout GraphicsContext, _ t: Double) {
        let cfg = avatar["cfg"], tilt = (cfg["tilt"].double ?? -24) * .pi / 180, count = max(0, min(3, cfg["sats"].int ?? 1))
        var ring = Path()
        for step in 0...28 {
            let a = Double.pi + Double.pi * Double(step) / 28
            let p = CGPoint(x: 50 + 34 * cos(a), y: 50 + 13 * sin(a))
            if step == 0 { ring.move(to: p) } else { ring.addLine(to: p) }
        }
        let turn = CGAffineTransform(translationX: 50, y: 50).rotated(by: tilt).translatedBy(x: -50, y: -50)
        context.stroke(ring.applying(turn), with: .color(ink), style: StrokeStyle(lineWidth: 4.5, lineCap: .round))

        let scale: Double
        switch state {
        case "thinking": scale = 1 + 0.12 * sin(t * 2 * .pi / 1.6)
        case "listening": scale = 1.25
        case "speaking": scale = 1 + 0.1 * abs(sin(t * 8))
        case "sleeping": scale = 0.85
        case "happy": scale = 1.18
        default: scale = 1
        }
        let drift = state == "sleeping" ? 0 : sin(t * 2 * .pi / 5.2) * 1.6
        let r = 12 * scale
        if state == "speaking" {
            for k in 0..<2 {
                let phase = (t / 1.3 + Double(k) * 0.5).truncatingRemainder(dividingBy: 1)
                let wave = 13 + phase * 22
                context.stroke(Path(ellipseIn: CGRect(x: 50 - wave, y: 50 - wave, width: wave * 2, height: wave * 2)), with: .color(accent.opacity(0.7 * (1 - phase))), lineWidth: 1.6)
            }
        }
        context.fill(Path(ellipseIn: CGRect(x: 50 - r, y: 50 - r + drift, width: r * 2, height: r * 2)), with: .color(accent))
        guard count > 0 else { return }
        let period = ["thinking", "working"].contains(state) ? 1.5 : 3.6
        for i in 0..<count {
            let a = (t / period + Double(i) / Double(count)) * 2 * .pi
            let x = 50 + 34 * sin(a), y = 50 - 34 * cos(a)
            context.fill(Path(ellipseIn: CGRect(x: x - 4, y: y - 10.5, width: 8, height: 21)), with: .color(ink))
        }
    }

    private func face(_ context: inout GraphicsContext, _ t: Double) {
        let cfg = avatar["cfg"], kind = cfg["eye"].string ?? "pill", mouth = cfg["mouth"].string ?? "none"
        let big = kind == "round" || kind == "square"
        let w: Double = big ? 12 : 9, h: Double = big ? 12 : 18, corner: Double = kind == "square" ? 2.5 : 6, gap = cfg["gap"].double ?? 13
        let level = mouth == "none" ? 50.0 : 43.0
        let blink = t.truncatingRemainder(dividingBy: 4.6) > 4.46 ? 0.12 : 1.0
        let bob = state == "speaking" ? sin(t * 9) * 1.6 : 0
        for side in [-1.0, 1.0] {
            var squash = blink, lift = 0.0, lean = 0.0
            switch state {
            case "thinking": squash = side > 0 ? 0.5 : 1
            case "working": squash = 0.78
            case "happy": squash = 0.28; lift = -4
            case "sleeping": squash = 0.1
            case "error": squash = 0.3; lean = side < 0 ? 28 : -28
            default: break
            }
            let cx = 50 + side * gap, cy = level + lift + bob
            var eye = Path(roundedRect: CGRect(x: -w / 2, y: -h / 2 * squash, width: w, height: h * squash), cornerRadius: min(corner, h * squash / 2))
            eye = eye.applying(CGAffineTransform(translationX: cx, y: cy).rotated(by: lean * .pi / 180))
            context.fill(eye, with: .color(ink))
        }
        let open = state == "speaking" ? 1 + 0.25 * abs(sin(t * 9)) : state == "happy" ? 1.35 : 1
        switch mouth {
        case "smile":
            var path = Path()
            path.move(to: CGPoint(x: 39, y: 66))
            path.addQuadCurve(to: CGPoint(x: 61, y: 66), control: CGPoint(x: 50, y: 66 + 10 * open))
            context.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
        case "line":
            var path = Path()
            path.move(to: CGPoint(x: 42, y: 68))
            path.addLine(to: CGPoint(x: 58, y: 68))
            context.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
        case "o":
            context.fill(Path(ellipseIn: CGRect(x: 45, y: 68 - 4.5 * open, width: 10, height: 9 * open)), with: .color(ink))
        default: break
        }
    }

    private func pixels(_ context: inout GraphicsContext, _ t: Double) {
        let fallback = ["..1111..", ".114411.", "11111111", ".22..22.", ".22..22.", "........", ".3....3.", "..3333.."]
        let stored = avatar["cfg"]["px"].array.compactMap(\.string)
        let rows = stored.count == 8 ? stored : fallback
        let blink = state == "sleeping" || t.truncatingRemainder(dividingBy: 4) > 3.85
        let talk = state == "speaking" && Int(t / 0.15) % 2 == 0
        for (y, row) in rows.enumerated() {
            for (x, cell) in row.prefix(8).enumerated() where "1234".contains(cell) {
                var rect = CGRect(x: 18 + Double(x) * 8, y: 18 + Double(y) * 8, width: 8.3, height: 8.3)
                if cell == "2", blink { rect = CGRect(x: rect.minX, y: rect.minY + 4.2, width: rect.width, height: 4.1) }
                if cell == "3", talk { rect = rect.offsetBy(dx: 0, dy: 2) }
                context.fill(Path(rect), with: .color(cell == "1" || cell == "2" ? ink : accent))
            }
        }
        guard ["thinking", "working"].contains(state) else { return }
        for i in 0..<6 {
            let on = Int(t / 0.18) % 6 == i
            context.fill(Path(CGRect(x: 26 + Double(i) * 8.4, y: 87, width: 5, height: 5)), with: .color(accent.opacity(on ? 1 : 0.3)))
        }
    }
}
