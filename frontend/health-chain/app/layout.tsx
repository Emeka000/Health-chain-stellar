import type { Metadata } from "next";
import React, { Suspense } from "react";
import { Poppins, Roboto, Manrope, DM_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "../components/providers/ToastProvider";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { I18nProvider } from "../components/providers/I18nProvider";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-poppins",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-roboto",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-manrope",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Health Chain",
  description: "Transparent healthcare donation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${poppins.variable} ${roboto.variable} ${manrope.variable} ${dmSans.variable} antialiased`}
      >
        <Suspense fallback={null}>
          <I18nProvider>
            <ReactQueryProvider>
              <ToastProvider>{children}</ToastProvider>
            </ReactQueryProvider>
          </I18nProvider>
        </Suspense>
      </body>
    </html>
  );
}
