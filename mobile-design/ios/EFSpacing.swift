//
//  EFSpacing.swift
//  efoodcare design tokens · iOS · iter-120
//
//  All values in points (CGFloat). 4-pt-base scale (matches Tailwind's 4px).
//

import SwiftUI

public enum EFSpace {
    public static let s0:  CGFloat = 0
    public static let s1:  CGFloat = 4
    public static let s2:  CGFloat = 8
    public static let s3:  CGFloat = 12
    public static let s4:  CGFloat = 16    // page horizontal default
    public static let s5:  CGFloat = 20
    public static let s6:  CGFloat = 24    // section gap default
    public static let s8:  CGFloat = 32
    public static let s10: CGFloat = 40
    public static let s12: CGFloat = 48
    public static let s16: CGFloat = 64
    public static let s20: CGFloat = 80

    // Semantic
    public static let pageHorizontal: CGFloat = 16
    public static let sectionGap:     CGFloat = 24
    public static let cardInner:      CGFloat = 16
    public static let rowGap:         CGFloat = 12
    public static let iconTextGap:    CGFloat = 8
    public static let appBarHeight:   CGFloat = 56
    public static let bottomBarHeight:CGFloat = 64
}

public enum EFRadius {
    public static let sm:   CGFloat = 8
    public static let md:   CGFloat = 12     // default --radius
    public static let lg:   CGFloat = 16
    public static let card: CGFloat = 20     // rounded-2xl
    public static let pill: CGFloat = 999    // rounded-full
}

public enum EFTouch {
    public static let minSize:      CGFloat = 44   // Apple HIG floor
    public static let buttonHeight: CGFloat = 48
    public static let iconButton:   CGFloat = 40
    public static let chipHeight:   CGFloat = 36
}

public enum EFIcon {
    public static let sm: CGFloat = 16
    public static let md: CGFloat = 20    // lucide default
    public static let lg: CGFloat = 24
    public static let xl: CGFloat = 32
    public static let defaultStroke: CGFloat = 1.75
}

// MARK: - Shadow presets (drop-in via .shadow modifier)
public struct EFShadow {
    public let color: Color
    public let radius: CGFloat
    public let x: CGFloat
    public let y: CGFloat

    public static let cardFlat = EFShadow(
        color: .black.opacity(0.06), radius: 4, x: 0, y: 1
    )
    public static let card3D = EFShadow(
        color: .black.opacity(0.18), radius: 14, x: 0, y: 8
    )
    public static let fab = EFShadow(
        color: .black.opacity(0.22), radius: 18, x: 0, y: 6
    )
    public static let modal = EFShadow(
        color: .black.opacity(0.24), radius: 24, x: 0, y: 12
    )
}

public extension View {
    func efShadow(_ s: EFShadow) -> some View {
        self.shadow(color: s.color, radius: s.radius, x: s.x, y: s.y)
    }
}
