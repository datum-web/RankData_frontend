import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "BenchCAD Preference Lab",
  description: "Pairwise expert preference collection over CAD reconstructions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
