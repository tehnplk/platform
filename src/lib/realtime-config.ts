// Public config for the Realtime WebSocket — readable from the browser.
// The anon JWT is signed with JWT_SECRET (default supabase demo secret).
// Safe to expose because there is no auth/RLS in this mockup.

export const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:4000/socket";

export const REALTIME_ANON_KEY =
  process.env.NEXT_PUBLIC_REALTIME_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDExNzY4MDAsImV4cCI6MTc5ODk0MzIwMH0.yvNhZ0f679evvPwQ73HYGxNjBONj4MXf1MLBwz_ngDs";
