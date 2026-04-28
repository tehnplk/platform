# chat-supabase

Minimal Supabase stack for the chat feature: Postgres + Realtime only.

## Containers

| Service | Image | Host port |
|---|---|---|
| `chat-supabase-db` | `public.ecr.aws/supabase/postgres:17.6.1.095` | `5434` |
| `chat-supabase-realtime` | `public.ecr.aws/supabase/realtime:v2.78.10` | `4000` |

## Start

```bash
cd docker/chat-supabase
cp .env.example .env   # adjust if needed
docker compose up -d
docker compose logs -f
```

The schema in `init/01-schema.sql` is applied automatically on **first** start
(empty volume). To re-apply after changes, drop the volume:

```bash
docker compose down -v && docker compose up -d
```

## Next.js env

Add to `.env.local`:

```
DATABASE_URL=postgres://supabase_admin:postgres@localhost:5434/postgres
NEXT_PUBLIC_REALTIME_URL=ws://localhost:4000/socket
NEXT_PUBLIC_REALTIME_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDExNzY4MDAsImV4cCI6MTc5ODk0MzIwMH0.yvNhZ0f679evvPwQ73HYGxNjBONj4MXf1MLBwz_ngDs
```

The anon JWT is the standard Supabase demo key signed with the JWT secret in
`.env.example`. Safe for the mockup because there is no auth or RLS.
