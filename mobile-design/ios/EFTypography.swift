//
//  EFTypography.swift
//  efoodcare design tokens · iOS · iter-120
//
//  Fonts to bundle (Info.plist UIAppFonts):
//      CabinetGrotesk-Medium.otf       (500)
//      CabinetGrotesk-Bold.otf         (700)
//      CabinetGrotesk-ExtraBold.otf    (800)   ← display headings
//      CabinetGrotesk-Black.otf        (900)
//      Manrope-Regular.ttf             (400)
//      Manrope-Medium.ttf              (500)   ← body default
//      Manrope-SemiBold.ttf            (600)
//      Manrope-Bold.ttf                (700)
//      JetBrainsMono-Regular.ttf       (400)
//      JetBrainsMono-Medium.ttf        (500)
//
//  Cabinet Grotesk available at https://www.fontshare.com/fonts/cabinet-grotesk
//  Manrope + JetBrains Mono at https://fonts.google.com
//
//  Usage (SwiftUI):
//      Text("Pick a plan").font(EFType.displayH1)
//      Text("Ghar se achha khana").font(EFType.bodyMD)
//

import SwiftUI

public enum EFType {

    // MARK: - Font families (must match PostScript name in Info.plist)
    enum Family {
        static let displayBold   = "CabinetGrotesk-Bold"
        static let displayExBold = "CabinetGrotesk-Extrabold"
        static let bodyRegular   = "Manrope-Regular"
        static let bodyMedium    = "Manrope-Medium"
        static let bodySemi      = "Manrope-SemiBold"
        static let bodyBold      = "Manrope-Bold"
        static let mono          = "JetBrainsMono-Regular"
    }

    // MARK: - Display (Cabinet Grotesk, tight tracking)
    public static let displayH1 = Font.custom(Family.displayExBold, size: 32)
        // line-height ≈ 38, kern ≈ -0.64 (= -0.02em × 32)
    public static let displayH2 = Font.custom(Family.displayExBold, size: 24)
        // line-height ≈ 30, kern ≈ -0.48
    public static let amountXL  = Font.custom(Family.displayExBold, size: 36)
        // Wallet ₹ amount on dashboard.

    // MARK: - Body (Manrope)
    public static let h3       = Font.custom(Family.bodyBold,    size: 20)
    public static let h4       = Font.custom(Family.bodyBold,    size: 18)
    public static let bodyLG   = Font.custom(Family.bodyMedium,  size: 16)
    public static let bodyMD   = Font.custom(Family.bodyMedium,  size: 14)   // default
    public static let bodySM   = Font.custom(Family.bodyMedium,  size: 13)
    public static let caption  = Font.custom(Family.bodyMedium,  size: 12)

    /// Overline — UPPERCASE, 11sp, +0.2em letter-spacing, green by default.
    /// Use with `.kerning(2.2)` and `.textCase(.uppercase)`.
    public static let overline = Font.custom(Family.bodyBold,    size: 11)

    // MARK: - Mono
    public static let mono     = Font.custom(Family.mono,        size: 13)
}

// MARK: - Convenience text-style modifiers
public extension View {
    func efOverline() -> some View {
        self.font(EFType.overline)
            .kerning(2.2)
            .textCase(.uppercase)
            .foregroundColor(EFColors.secondary)
    }
    func efDisplayH1() -> some View {
        self.font(EFType.displayH1)
            .kerning(-0.64)
            .lineSpacing(38 - 32)
            .foregroundColor(EFColors.onBackground)
    }
    func efDisplayH2() -> some View {
        self.font(EFType.displayH2)
            .kerning(-0.48)
            .lineSpacing(30 - 24)
            .foregroundColor(EFColors.onBackground)
    }
    func efAmountXL() -> some View {
        self.font(EFType.amountXL)
            .kerning(-0.72)
            .foregroundColor(EFColors.onCard)
    }
}
