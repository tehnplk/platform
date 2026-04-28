// Server-side helper to broadcast a message to a chat channel via the
// self-hosted Realtime container. Uses the HTTP /api/broadcast endpoint
// so we do not need a stateful WebSocket on the server.

const REALTIME_HTTP_URL =
  process.env.REALTIME_HTTP_URL ?? "http://localhost:4000";

const REALTIME_API_KEY =
  process.env.REALTIME_API_KEY ??
  // anon JWT signed with the demo JWT_SECRET
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDExNzY4MDAsImV4cCI6MTc5ODk0MzIwMH0.yvNhZ0f679evvPwQ73HYGxNjBONj4MXf1MLBwz_ngDs";

export async function broadcastNewMessage(
  hoscode: string,
  payload: { id: string; client_id: string | null; role: "user" | "admin" },
) {
  try {
    const res = await fetch(`${REALTIME_HTTP_URL}/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: REALTIME_API_KEY,
        Authorization: `Bearer ${REALTIME_API_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `chat:${hoscode}`,
            event: "new-message",
            payload,
            private: false,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("broadcast failed", res.status, await res.text());
    }
  } catch (err) {
    console.warn("broadcast threw", err);
  }
}
