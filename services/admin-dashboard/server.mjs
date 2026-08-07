import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, sep } from "node:path";

/**
 * Tiny static file server for the admin dashboard. The dashboard is a single
 * HTML page that talks to the values-api in the browser; this server only
 * serves the static asset.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/**
 * Security headers for every response. The dashboard is a single self-contained
 * page with inline script/style, so those are allowed, but everything else is
 * locked down. `connect-src` is left open because the operator points the page
 * at an arbitrary values-api host they control.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src *",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  // Prevent path traversal by keeping the resolved path inside root.
  const filePath = normalize(join(root, rel));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403, SECURITY_HEADERS).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      ...SECURITY_HEADERS,
    });
    res.end(data);
  } catch {
    res.writeHead(404, SECURITY_HEADERS).end("Not found");
  }
}).listen(PORT, () => {
  console.log(`TradeLens admin dashboard on http://localhost:${PORT}`);
});
