import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Files Editor — Edit PDF with the same font",
  description:
    "Edit PDF text directly in the browser while keeping the document's original embedded fonts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
