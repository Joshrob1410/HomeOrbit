import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import ThemeCSSBridge from 'app/(app)/_components/ThemeCSSBridge';
import { Geist, Geist_Mono } from "next/font/google";

// Fonts
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Only use metadataBase if NEXT_PUBLIC_SITE_URL starts with http/https.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const hasValidSiteUrl = !!siteUrl && /^https?:\/\//i.test(siteUrl || "");
const safeBase = hasValidSiteUrl ? new URL(siteUrl as string) : null;

export const metadata: Metadata = safeBase
  ? {
      title: { default: "HomeOrbit", template: "%s · HomeOrbitb" },
      description: "HomeOrbit – home management.",
      metadataBase: safeBase,
    }
  : {
      title: { default: "HomeOrbit", template: "%s · HomeOrbitb" },
      description: "HomeOrbit – home management.",
    };

export default async function RootLayout({ children }: { children: ReactNode }) {
    // ✅ Await the promise, then read the cookie safely
    const cookieStore = await cookies();
    const isOrbit = (cookieStore.get('orbit')?.value ?? '0') === '1';

    return (
        <html lang="en" data-orbit={isOrbit ? '1' : '0'}>
            <body style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
                <ThemeCSSBridge initialOrbit={isOrbit} />
                {children}
            </body>
        </html>
    );
}
