//
//  EFColors.swift
//  efoodcare design tokens · iOS · iter-120
//
//  Source of truth: /app/mobile-design/common/design_tokens.json
//  Web reference  : /app/frontend/src/index.css  +  GET /api/theme
//
//  Usage (SwiftUI):
//      Text("Hello").foregroundColor(EFColors.onBackground)
//      Rectangle().fill(EFColors.primary)
//
//  Usage (UIKit):
//      view.backgroundColor = EFColors.primary.uiColor
//

import SwiftUI

#if canImport(UIKit)
import UIKit
typealias EFNativeColor = UIColor
#elseif canImport(AppKit)
import AppKit
typealias EFNativeColor = NSColor
#endif

public enum EFColors {

    // MARK: - Brand
    public static let primary         = Color(hex: 0xD02424)   // hsl(0 70% 48%)
    public static let primaryPressed  = Color(hex: 0xA01717)   // 90% darken
    public static let onPrimary       = Color.white

    public static let secondary       = Color(hex: 0x2C854D)   // hsl(142 50% 35%)
    public static let onSecondary     = Color.white

    public static let accent          = Color(hex: 0xF9EFEF)   // light pink wash
    public static let onAccent        = Color(hex: 0xD02424)

    // MARK: - Neutral
    public static let background      = Color.white
    public static let onBackground    = Color(hex: 0x1F2937)   // body text

    public static let card            = Color.white
    public static let onCard          = Color(hex: 0x192D56)   // navy-tinted card text

    public static let muted           = Color(hex: 0xF6F2F2)
    public static let onMuted         = Color(hex: 0x64748B)   // helper text

    public static let border          = Color(hex: 0xEDDDDD)
    public static let inputBorder     = Color(hex: 0xE0E3EA)
    public static let ring            = Color(hex: 0xD02424)   // focus ring

    // MARK: - Semantic
    public static let destructive     = Color(hex: 0xB71414)   // delete / cancel subscription
    public static let danger          = Color(hex: 0xDF1F1F)   // error banner
    public static let warning         = Color(hex: 0xDF7A05)   // expiring soon
    public static let success         = Color(hex: 0x2C854D)   // topped up

    // MARK: - Amber Card (partial-month carry-forward / monetary tip card)
    public enum AmberCard {
        public static let bg     = Color(hex: 0xFFF7E0)
        public static let border = Color(hex: 0xFBC94B)
        public static let fg     = Color(hex: 0x9C5A00)
    }

    // MARK: - Overlays
    public static let scrim60 = Color.black.opacity(0.60)
    public static let scrim40 = Color.black.opacity(0.40)
}

// MARK: - Color hex initialiser
public extension Color {
    /// Initialise from a 24-bit hex literal (e.g. `0xD02424`).
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }

    /// Bridge to platform-native (`UIColor` on iOS, `NSColor` on macOS) when needed.
    var uiColor: EFNativeColor {
        #if canImport(UIKit)
        return UIColor(self)
        #else
        return NSColor(self)
        #endif
    }
}
