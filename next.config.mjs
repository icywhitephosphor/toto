/** @type {import('next').NextConfig} */

// Content-security headers owned by the app (apply locally and in prod). HSTS is
// set at the Caddy edge (it is HTTPS-scoped). 'unsafe-inline' is required for
// Next's App Router hydration scripts and next/font's injected <style>; the main
// XSS defense remains the httpOnly session cookie + no user-rendered HTML.
// React dev mode needs eval() for debugging; production never uses it.
const devScript = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "img-src 'self' https://t.me data:",
      `script-src 'self' 'unsafe-inline'${devScript} https://telegram.org`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src https://oauth.telegram.org https://telegram.org",
      "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No X-Frame-Options: the CSP `frame-ancestors` directive above is the modern,
  // more expressive equivalent and already allows only ourselves + Telegram.
  // A legacy `X-Frame-Options: SAMEORIGIN` would contradict it and break the
  // Telegram Mini App, which frames us from *.telegram.org.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig = {
  // Emit a self-contained server bundle so the Docker runtime stage stays minimal.
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
