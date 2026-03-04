import type { Metadata } from "next";
import "./globals.css";
import "./styles/dashboard.css";

export const metadata: Metadata = {
  title: "Crypto Dashboard",
  description: "Real-time cryptocurrency market dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
