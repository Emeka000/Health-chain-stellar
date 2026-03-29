import type { Metadata } from "next";
import React, { Suspense } from "react";
import { Poppins, Roboto, Manrope, DM_Sans } from "next/font/google";
import "../globals.css";
import { ToastProvider } from "../../components/providers/ToastProvider";
import { ReactQueryProvider } from "../../components/providers/ReactQueryProvider";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next-intl/navigation';
import { routing } from '../../i18n/routing';

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

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }
 
  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${poppins.variable} ${roboto.variable} ${manrope.variable} ${dmSans.variable} antialiased`}
      >
        <a 
          href="#main-content" 
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-red-600 focus:border-2 focus:border-red-600 focus:rounded-md focus:shadow-lg focus:outline-none"
        >
          Skip to content
        </a>
        <Suspense fallback={null}>
          <NextIntlClientProvider messages={messages}>
            <ReactQueryProvider>
              <ToastProvider>{children}</ToastProvider>
            </NextIntlClientProvider>
          </NextIntlClientProvider>
        </Suspense>
      </body>
    </html>
  );
}
