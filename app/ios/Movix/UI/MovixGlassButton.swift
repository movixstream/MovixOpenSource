import SwiftUI
import UIKit

enum MovixGlassButtonVariant: String {
  case primary
  case secondary
  case destructive
}

final class MovixGlassButtonModel: ObservableObject {
  @Published var title = ""
  @Published var systemImage = ""
  @Published var variant: MovixGlassButtonVariant = .secondary
  @Published var enabled = true
  @Published var compact = false
  @Published var accessibilityLabel = ""
  var onPress: (() -> Void)?
}

/// Applique le style Liquid Glass natif sur iOS 26, et les styles bordés
/// système sur les versions antérieures.
struct MovixGlassButtonStyleModifier: ViewModifier {
  let variant: MovixGlassButtonVariant

  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      switch variant {
      case .primary:
        content.buttonStyle(.glassProminent).tint(MovixGlassPalette.accent)
      case .destructive:
        content.buttonStyle(.glassProminent).tint(.red)
      case .secondary:
        content.buttonStyle(.glass)
      }
    } else {
      switch variant {
      case .primary:
        content.buttonStyle(.borderedProminent).tint(MovixGlassPalette.accent)
      case .destructive:
        content.buttonStyle(.borderedProminent).tint(.red)
      case .secondary:
        content.buttonStyle(.bordered).tint(MovixGlassPalette.accent)
      }
    }
  }
}

struct MovixGlassButtonContent: View {
  @ObservedObject var model: MovixGlassButtonModel

  var body: some View {
    Button(role: model.variant == .destructive ? ButtonRole.destructive : nil) {
      model.onPress?()
    } label: {
      label.frame(maxWidth: .infinity)
    }
    .disabled(!model.enabled)
    .modifier(MovixGlassButtonStyleModifier(variant: model.variant))
    .buttonBorderShape(.capsule)
    .controlSize(model.compact ? .regular : .large)
    .accessibilityLabel(Text(model.accessibilityLabel.isEmpty ? model.title : model.accessibilityLabel))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private var label: some View {
    if model.systemImage.isEmpty {
      Text(model.title)
        .font(.body.weight(.semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    } else {
      Label(model.title, systemImage: model.systemImage)
        .font(.body.weight(.semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
  }
}

@objc(MovixGlassButton)
final class MovixGlassButton: MovixSwiftUIHostView {
  private let model = MovixGlassButtonModel()

  @objc dynamic var title = "" { didSet { model.title = title } }
  @objc dynamic var systemImage = "" { didSet { model.systemImage = systemImage } }
  @objc dynamic var variant = "secondary" {
    didSet { model.variant = MovixGlassButtonVariant(rawValue: variant) ?? .secondary }
  }
  @objc dynamic var enabled = true { didSet { model.enabled = enabled } }
  @objc dynamic var compact = false { didSet { model.compact = compact } }
  @objc dynamic var label = "" { didSet { model.accessibilityLabel = label } }
  @objc dynamic var onButtonPress: RCTBubblingEventBlock?

  override init(frame: CGRect) {
    super.init(frame: frame)
    configureView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureView()
  }

  private func configureView() {
    model.onPress = { [weak self] in
      self?.onButtonPress?([:])
    }
    installRootView(MovixGlassButtonContent(model: model))
  }
}
