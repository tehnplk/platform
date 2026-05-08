const DEFAULT_BASE_URL = "https://platform.plkhealth.go.th";
const BADGE_REFRESH_ALARM = "refreshUnreadBadge";
const BADGE_REFRESH_MINUTES = 1;

async function getSettings() {
  const data = await chrome.storage.local.get({
    baseUrl: DEFAULT_BASE_URL,
    lastUnread: 0,
    lastCheckedAt: null,
    lastError: null,
  });

  return {
    ...data,
    baseUrl: normalizeBaseUrl(data.baseUrl || DEFAULT_BASE_URL),
  };
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function parsePushData(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

function formatBadgeCount(count) {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

function readAdminUnread(payload) {
  const unread = Number(payload?.unread || 0);
  return Number.isFinite(unread) && unread > 0 ? unread : 0;
}

async function updateBadge(unread, baseUrl) {
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: formatBadgeCount(unread) });
  await chrome.action.setTitle({
    title:
      unread > 0
        ? `PLK Platform Chat: ${unread} unread message${unread === 1 ? "" : "s"}`
        : "PLK Platform Chat: no unread messages",
  });

  await chrome.storage.local.set({
    lastUnread: unread,
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
    baseUrl,
  });
}

async function setErrorBadge(message) {
  await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
  await chrome.action.setBadgeTextColor({ color: "#111827" });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({
    title: `PLK Platform Chat: ${message}`,
  });

  await chrome.storage.local.set({
    lastError: message,
    lastCheckedAt: new Date().toISOString(),
  });
}

async function refreshUnreadBadge() {
  const { baseUrl } = await getSettings();
  const url = `${baseUrl}/api/chat/admin/unread`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    await updateBadge(readAdminUnread(payload), baseUrl);
  } catch (error) {
    await setErrorBadge(error instanceof Error ? error.message : "Update failed");
  }
}

async function scheduleBadgeRefreshAlarm() {
  await chrome.alarms.create(BADGE_REFRESH_ALARM, {
    delayInMinutes: BADGE_REFRESH_MINUTES,
    periodInMinutes: BADGE_REFRESH_MINUTES,
  });
}

async function registerPushSubscription() {
  const { baseUrl } = await getSettings();
  const keyResponse = await fetch(`${baseUrl}/api/chat/push-subscriptions`, {
    cache: "no-store",
  });
  if (!keyResponse.ok) throw new Error(`Push key HTTP ${keyResponse.status}`);

  const { publicKey } = await keyResponse.json();
  if (!publicKey) throw new Error("Push public key is missing");

  const saved = await chrome.storage.local.get({
    subscribedBaseUrl: null,
    subscribedPublicKey: null,
  });
  const existingSubscription = await self.registration.pushManager.getSubscription();
  const shouldResubscribe =
    existingSubscription &&
    (saved.subscribedBaseUrl !== baseUrl || saved.subscribedPublicKey !== publicKey);

  if (shouldResubscribe) {
    await existingSubscription.unsubscribe();
  }

  const currentSubscription = shouldResubscribe
    ? null
    : await self.registration.pushManager.getSubscription();
  const subscription =
    currentSubscription ||
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const saveResponse = await fetch(`${baseUrl}/api/chat/push-subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saveResponse.ok) throw new Error(`Subscribe HTTP ${saveResponse.status}`);

  await chrome.storage.local.set({
    pushRegisteredAt: new Date().toISOString(),
    subscribedBaseUrl: baseUrl,
    subscribedPublicKey: publicKey,
    lastError: null,
  });
}

async function initializePushBadge() {
  try {
    await scheduleBadgeRefreshAlarm();
    await registerPushSubscription();
    await refreshUnreadBadge();
  } catch (error) {
    await setErrorBadge(error instanceof Error ? error.message : "Push setup failed");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializePushBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void initializePushBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BADGE_REFRESH_ALARM) return;
  void refreshUnreadBadge();
});

self.addEventListener("push", (event) => {
  const data = parsePushData(event);
  const notificationUrl = data.url || "/chat/admin";
  const title = data.title || "PLK Platform Chat";
  const options = {
    body: data.body || "มีข้อความใหม่เข้ามา",
    tag: data.tag || "chat-admin",
    data: {
      url: notificationUrl,
    },
  };

  event.waitUntil(
    Promise.all([
      refreshUnreadBadge(),
      self.registration.showNotification(title, options),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    getSettings().then(({ baseUrl }) => {
      const url = new URL(event.notification.data?.url || "/chat/admin", baseUrl);
      return chrome.tabs.create({ url: url.href });
    }),
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "registerPushBadge") {
    initializePushBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Push setup failed",
        }),
      );

    return true;
  }

  if (message?.type !== "refreshUnreadBadge") return false;

  refreshUnreadBadge()
    .then(() => sendResponse({ ok: true }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Refresh failed",
      }),
    );

  return true;
});
