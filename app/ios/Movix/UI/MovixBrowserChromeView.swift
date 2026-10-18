import SwiftUI
import UIKit

final class MovixBrowserChromeModel: ObservableObject {
  @Published var canGoBack = false
  @Published var canGoForward = false
  @Published var loading = false
  @Published var domain = MovixBrowserChromeModel.unavailableDomain
  @Published var dnsEnabled = false
  @Published var showURLBar = true
  @Published var showNavBar = true

  var onGoBack: (() -> Void)?
  var onGoForward: (() -> Void)?
  var onReload: (() -> Void)?
  var onHome: (() -> Void)?
  var onSettings: (() -> Void)?

  static let unavailableDomain = "Adresse indisponible"

  static func domain(from currentURL: String) -> String {
    guard currentURL.utf8.count <= 4_096,
      let components = URLComponents(string: currentURL),
      let host = components.host,
      !host.isEmpty
    else {
      return unavailableDomain
    }
    return host.lowercased()
  }
}

private enum MovixLiquidGlass {
  static var isAvailable: Bool {
    if #available(iOS 26.0, *) { return true }
    return false
  }
}

/// Regroupe les éléments en verre pour qu'ils se fondent et se transforment
/// ensemble sur iOS 26 ; simple passe-plat sur les versions antérieures.
private struct MovixGlassGroup<Content: View>: View {
  let spacing: CGFloat
  let content: Content

  init(spacing: CGFloat, @ViewBuilder content: () -> Content) {
    self.spacing = spacing
    self.content = content()
  }

  var body: some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: spacing) { content }
    } else {
      content
    }
  }
}

/// Capsule Liquid Glass sur iOS 26, matériau translucide système avant.
private struct MovixGlassCapsule: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: .capsule)
    } else {
      content.background(.ultraThinMaterial, in: Capsule())
    }
  }
}

/// Fond translucide pour la rangée de boutons, uniquement avant iOS 26 : à
/// partir d'iOS 26 chaque bouton porte déjà son propre verre.
private struct MovixLegacyMaterialCapsule: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
    } else {
      content.background(.ultraThinMaterial, in: Capsule())
    }
  }
}

private struct MovixChromeIconButtonStyle: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .controlSize(.large)
    } else {
      content
        .buttonStyle(.borderless)
        .tint(.primary)
    }
  }
}

struct MovixBrowserChromeContent: View {
  @ObservedObject var model: MovixBrowserChromeModel
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  var body: some View {
    MovixGlassGroup(spacing: 8) {
      if oneRow {
        HStack(spacing: 8) {
          addressBar.frame(minWidth: 220)
          navigationBar
        }
      } else {
        VStack(spacing: 8) {
          if model.showURLBar { addressBar }
          if model.showNavBar { navigationBar }
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .frame(maxWidth: 720)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var oneRow: Bool {
    horizontalSizeClass == .regular && model.showURLBar && model.showNavBar
  }

  private var addressBar: some View {
    HStack(spacing: 8) {
      Image(systemName: "lock.fill")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(model.dnsEnabled ? Color(uiColor: .systemGreen) : Color.secondary)
      if model.loading {
        ProgressView().controlSize(.small)
      }
      Text(model.domain)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, minHeight: 44)
    .modifier(MovixGlassCapsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text("Adresse"))
    .accessibilityValue(Text(model.dnsEnabled ? "\(model.domain), DNS sécurisé activé" : model.domain))
  }

  private var navigationBar: some View {
    HStack(spacing: 6) {
      iconButton("chevron.backward", label: "Page précédente", enabled: model.canGoBack) {
        model.onGoBack?()
      }
      Spacer(minLength: 0)
      iconButton("chevron.forward", label: "Page suivante", enabled: model.canGoForward) {
        model.onGoForward?()
      }
      Spacer(minLength: 0)
      iconButton(
        model.loading ? "xmark" : "arrow.clockwise",
        label: model.loading ? "Arrêter le chargement" : "Recharger"
      ) {
        model.onReload?()
      }
      Spacer(minLength: 0)
      iconButton("house", label: "Accueil") {
        model.onHome?()
      }
      Spacer(minLength: 0)
      iconButton("gearshape", label: "Réglages") {
        model.onSettings?()
      }
    }
    .padding(.horizontal, MovixLiquidGlass.isAvailable ? 0 : 6)
    .modifier(MovixLegacyMaterialCapsule())
  }

  private func iconButton(
    _ symbol: String,
    label: String,
    enabled: Bool = true,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 17, weight: .semibold))
        .frame(width: 24, height: 24)
        .padding(MovixLiquidGlass.isAvailable ? 0 : 10)
        .contentShape(Rectangle())
    }
    .disabled(!enabled)
    .modifier(MovixChromeIconButtonStyle())
    .accessibilityLabel(Text(label))
  }
}

@objc(MovixBrowserChromeView)
final class MovixBrowserChromeView: MovixSwiftUIHostView {
  private let model = MovixBrowserChromeModel()

  @objc dynamic var canGoBack = false { didSet { model.canGoBack = canGoBack } }
  @objc dynamic var canGoForward = false { didSet { model.canGoForward = canGoForward } }
  @objc dynamic var loading = false { didSet { model.loading = loading } }
  @objc dynamic var currentURL = "" {
    didSet { model.domain = MovixBrowserChromeModel.domain(from: currentURL) }
  }
  @objc dynamic var dnsEnabled = false { didSet { model.dnsEnabled = dnsEnabled } }
  @objc dynamic var showURLBar = true { didSet { updateVisibility() } }
  @objc dynamic var showNavBar = true { didSet { updateVisibility() } }

  @objc dynamic var onGoBack: RCTBubblingEventBlock?
  @objc dynamic var onGoForward: RCTBubblingEventBlock?
  @objc dynamic var onReload: RCTBubblingEventBlock?
  @objc dynamic var onHome: RCTBubblingEventBlock?
  @objc dynamic var onSettings: RCTBubblingEventBlock?

  override init(frame: CGRect) {
    super.init(frame: frame)
    configureView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureView()
  }

  private func configureView() {
    model.onGoBack = { [weak self] in self?.onGoBack?([:]) }
    model.onGoForward = { [weak self] in self?.onGoForward?([:]) }
    model.onReload = { [weak self] in self?.onReload?([:]) }
    model.onHome = { [weak self] in self?.onHome?([:]) }
    model.onSettings = { [weak self] in self?.onSettings?([:]) }
    installRootView(MovixBrowserChromeContent(model: model))
    updateVisibility()
  }

  private func updateVisibility() {
    model.showURLBar = showURLBar
    model.showNavBar = showNavBar
    isHidden = !showURLBar && !showNavBar
  }
}
