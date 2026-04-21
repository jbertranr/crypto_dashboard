/**
 * Servidor públic de només-lectura per a public/www/
 * Exposa la interfície web mòbil sense cap ruta d'acció.
 *
 * Ús: node server-public.mjs
 * Env: PUBLIC_PORT (default 3001), NEXT_ORIGIN (default http://localhost:3000)
 */

import http from "http";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PUBLIC_PORT = parseInt(process.env.PUBLIC_PORT ?? "3001");
const NEXT_ORIGIN = process.env.NEXT_ORIGIN ?? "http://localhost:3000";

// Llista blanca opt-in: ÚNICAMENT aquestes rutes es proxegen a Next.js
const ALLOWED_API = new Set([
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/status",
  "GET /api/pnl",
  "GET /api/orders",
  "GET /api/orders/trailing",
  "GET /api/balance",
  "GET /api/market",
  "GET /api/errors",
  "GET /api/activity",
  "GET /api/cost-basis",
  "GET /api/portfolio-snapshot",
  "GET /api/klines-range",
]);

const WWW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "www");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".json": "application/json",
};

function serveStatic(req, res) {
  let urlPath = new URL(req.url, "http://x").pathname;
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.resolve(path.join(WWW_DIR, urlPath));
  if (!filePath.startsWith(WWW_DIR + path.sep) && filePath !== WWW_DIR) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  });
}

function proxyToNext(req, res, timeoutMs = 60_000) {
  const target    = new URL(NEXT_ORIGIN);
  const proxyReq  = http.request(
    {
      hostname: target.hostname,
      port:     parseInt(target.port) || 80,
      path:     req.url,
      method:   req.method,
      headers:  { ...req.headers, host: target.host },
      timeout:  timeoutMs,
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("timeout", () => { proxyReq.destroy(); res.writeHead(504); res.end(); });
  proxyReq.on("error", () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
  req.pipe(proxyReq);
}

http.createServer((req, res) => {
  const urlPath = new URL(req.url, "http://x").pathname;

  if (urlPath.startsWith("/api/")) {
    const key = `${req.method} ${urlPath}`;
    if (ALLOWED_API.has(key)) return proxyToNext(req, res);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  serveStatic(req, res);
}).listen(PUBLIC_PORT, () => {
  console.log(`Public server  →  http://localhost:${PUBLIC_PORT}`);
  console.log(`Proxy API cap  →  ${NEXT_ORIGIN}`);
  console.log(`Rutes permeses →  ${ALLOWED_API.size} endpoints de consulta`);
});
