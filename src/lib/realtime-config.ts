// Public config for the Realtime WebSocket, readable from the browser.
// The anon JWT is signed with JWT_SECRET (default Supabase demo secret).
// Safe to expose because there is no auth/RLS in this mockup.

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeRealtimeUrl(configuredUrl: string) {
  if (typeof window === "undefined") return configuredUrl;

  try {
    const url = new URL(configuredUrl);
    if (isLocalHostname(url.hostname) && !isLocalHostname(window.location.hostname)) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}/socket`;
    }
  } catch {
    return configuredUrl;
  }

  return configuredUrl;
}

export const REALTIME_URL = normalizeRealtimeUrl(
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:4000/socket",
);

export const REALTIME_ANON_KEY =
  process.env.NEXT_PUBLIC_REALTIME_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiI" +
    "sImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDExNzY4MDAsImV4cCI6MTc5ODk0MzIwMH0" +
    ".yvNhZ0f679evvPwQ73HYGxNjBONj4MXf1MLBwz_ngDs";
