import type { Metadata } from "next";
import "./globals.css";
import "./styles/dashboard.css";
import ServerEventsProvider from "./components/ServerEventsProvider";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Aplica el tema abans del primer render per evitar flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();` }} />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body suppressHydrationWarning>
        <ServerEventsProvider>{children}</ServerEventsProvider>
      </body>
    </html>
  );
}
