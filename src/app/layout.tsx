import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { StorageSync } from "@/components/StorageSync";

const manrope = Manrope({ subsets: ["cyrillic", "latin"], variable: "--font-manrope" });
const jetbrains = JetBrains_Mono({ subsets: ["cyrillic", "latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Ледовый протокол — хоккейная статистика",
  description: "Локальная статистика хоккейной команды: протоколы, турнирная таблица, игроки, вратари, штрафы.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${jetbrains.variable} bg-paper font-sans text-ink antialiased`}>
        <StorageSync />
        <Nav />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
