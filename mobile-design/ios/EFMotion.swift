//
//  EFMotion.swift
//  efoodcare design tokens · iOS · iter-120
//
//  Animation presets matching the web app's motion vocabulary.
//

import SwiftUI

public enum EFMotion {

    /// Quick tap-press feedback. Use on Button + scaleEffect(isPressed ? 0.98 : 1).
    public static let tapPress: Animation = .easeOut(duration: 0.12)

    /// Card hover/touch lift. Translates -1pt on Y.
    public static let cardHover: Animation = .easeInOut(duration: 0.22)

    /// Page fade-in on first paint after data resolves.
    public static let pageFadeIn: Animation = .easeIn(duration: 0.18)

    /// Skeleton-shimmer pulse (use with .opacity(pulsing ? 0.4 : 1) loop).
    public static let skeletonPulse: Animation = .easeInOut(duration: 1.5)
        .repeatForever(autoreverses: true)

    /// Accordion / disclosure expand-collapse.
    public static let accordion: Animation = .easeOut(duration: 0.20)
}

// MARK: - Tap-press helper
/// Adds the iOS-flavoured "press to 0.98" interaction that matches the web app's CTA feedback.
public struct EFPressableStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(EFMotion.tapPress, value: configuration.isPressed)
    }
}
