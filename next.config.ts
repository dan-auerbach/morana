import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove X-Powered-By header to reduce fingerprinting
  poweredByHeader: false,

  // Allow large audio file uploads (up to 100MB) for STT / recipe execution
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    proxyClientMaxBodySize: "100mb",
  },

  // Security headers for all responses
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        // Prevent MIME-type sniffing
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Prevent clickjacking
        { key: "X-Frame-Options", value: "DENY" },
        // Control referrer information
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Disable unnecessary browser features
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
        },
        // Force HTTPS (once deployed behind TLS)
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        // Basic CSP — blocks inline scripts except Next.js ones, restricts connections
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline/eval in dev
            "style-src 'self' 'unsafe-inline'",                // Tailwind uses inline styles
            "img-src 'self' data: blob: https:",               // Allow data URIs + R2 signed URLs
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self'",                               // API calls only to self
            "media-src 'self' data: blob: https:",               // Audio/video playback + R2 signed URLs
            "frame-ancestors 'none'",                           // No iframe embedding
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    },
  ],
};

export default nextConfig;
