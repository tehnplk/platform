import webpush, { type PushSubscription } from "web-push";
import { db } from "@/lib/db";

let schemaReady = false;
let webPushReady = false;

export type AdminPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export function getWebPushPublicKey() {
  return process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
}

function configureWebPush() {
  if (webPushReady) return true;

  const publicKey = getWebPushPublicKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY ?? "";
  const subject =
    process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@platform.plkhealth.go.th";

  if (!publicKey || !privateKey) {
    console.warn("web push skipped: VAPID keys are not configured");
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  webPushReady = true;
  return true;
}

export async function ensurePushSubscriptionSchema() {
  if (schemaReady) return;
  await db.query(`
    create table if not exists push_subscriptions (
      endpoint       text primary key,
      role           text not null check (role in ('admin')),
      subscription   jsonb not null,
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    );
    create index if not exists push_subscriptions_role_idx
      on push_subscriptions (role);
  `);
  schemaReady = true;
}

export async function saveAdminPushSubscription(subscription: PushSubscription) {
  await ensurePushSubscriptionSchema();
  await db.query(
    `insert into push_subscriptions (endpoint, role, subscription, updated_at)
     values ($1, 'admin', $2::jsonb, now())
     on conflict (endpoint) do update
       set subscription = excluded.subscription,
           updated_at = now()`,
    [subscription.endpoint, JSON.stringify(subscription)],
  );
}

export async function sendAdminPushNotifications(payload: AdminPushPayload) {
  if (!configureWebPush()) return;
  await ensurePushSubscriptionSchema();

  const result = await db.query<{ endpoint: string; subscription: PushSubscription }>(
    `select endpoint, subscription
       from push_subscriptions
      where role = 'admin'`,
  );

  await Promise.all(
    result.rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify(payload),
          {
            TTL: 60 * 60,
            urgency: "high",
            topic: payload.tag.slice(0, 32),
          },
        );
      } catch (err) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number(err.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db.query("delete from push_subscriptions where endpoint = $1", [
            row.endpoint,
          ]);
          return;
        }
        console.warn("web push failed", err);
      }
    }),
  );
}
