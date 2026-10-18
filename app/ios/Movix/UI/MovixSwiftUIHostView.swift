import SwiftUI
import UIKit

/// Couleur d'accent de Movix (#8b5cf6), partagée par les vues SwiftUI natives.
enum MovixGlassPalette {
  static let accent = Color(red: 0x8B / 255, green: 0x5C / 255, blue: 0xF6 / 255)
}

/// Vue UIKit qui héberge une hiérarchie SwiftUI pour React Native.
///
/// React Native fixe le cadre de la vue ; la vue SwiftUI le remplit. Le
/// contrôleur d'hébergement est rattaché au contrôleur parent le plus proche
/// pour que SwiftUI reçoive le cycle de vie et les traits (taille, contraste).
/// L'interface de Movix est sombre : le schéma de couleurs est forcé en sombre
/// pour que le verre et les libellés restent lisibles sur le fond #0a0a0a.
class MovixSwiftUIHostView: UIView {
  private var hostingController: UIHostingController<AnyView>?

  func installRootView<Content: View>(_ content: Content) {
    let controller = UIHostingController(
      rootView: AnyView(
        content
          .environment(\.colorScheme, .dark)
          .ignoresSafeArea()
      )
    )
    controller.view.backgroundColor = .clear
    if #available(iOS 16.4, *) {
      controller.safeAreaRegions = []
    }
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(controller.view)
    hostingController = controller
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let controller = hostingController else { return }

    if window == nil {
      if controller.parent != nil {
        controller.willMove(toParent: nil)
        controller.removeFromParent()
      }
      return
    }

    guard controller.parent == nil, let parent = nearestViewController() else { return }
    parent.addChild(controller)
    controller.didMove(toParent: parent)
  }

  private func nearestViewController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if let viewController = current as? UIViewController {
        return viewController
      }
      responder = current.next
    }
    return nil
  }
}
