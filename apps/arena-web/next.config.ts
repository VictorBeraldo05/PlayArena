import type { NextConfig } from 'next';

function cspOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const supabaseOrigin = cspOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const apiOrigin = cspOrigin(process.env.NEXT_PUBLIC_API_URL);
const connectSources = ["'self'", supabaseOrigin, apiOrigin, ...(!isProduction && !apiOrigin ? ['http://localhost:8000', 'ws://localhost:3000'] : [])].filter(Boolean).join(' ');
const imageSources = ["'self'", 'data:', 'blob:', supabaseOrigin, 'https://lh3.googleusercontent.com'].filter(Boolean).join(' ');
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src ${imageSources}`,
  `connect-src ${connectSources}`,
  "frame-src 'none'",
  "worker-src 'self' blob:",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    }, {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
      ],
    }];
  },
};

export default nextConfig;
