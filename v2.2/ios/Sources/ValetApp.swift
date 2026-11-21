// Concierge Valet for iPhone: the app's entry point, which keeps the state alive and reconnects when the app comes back to the front.
import SwiftUI

@main
struct ValetApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Paper.accent)
                .task { model.start() }
                .onChange(of: phase) { _, now in
                    if now == .active { model.resume() } else if now == .background { model.close() }
                }
        }
    }
}
