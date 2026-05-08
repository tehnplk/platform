const DEFAULT_BASE_URL = "https://platform.plkhealth.go.th";

const baseUrlInput = document.querySelector("#baseUrl");
const countEl = document.querySelector("#count");
const statusEl = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh");
const openAdminButton = document.querySelector("#openAdmin");

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function formatTime(iso) {
  if (!iso) return "ยังไม่เคยอัปเดต";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

async function readState() {
  return chrome.storage.local.get({
    baseUrl: DEFAULT_BASE_URL,
    lastUnread: 0,
    lastCheckedAt: null,
    lastError: null,
    pushRegisteredAt: null,
  });
}

async function render() {
  const state = await readState();
  const unread = Number(state.lastUnread || 0);

  baseUrlInput.value = normalizeBaseUrl(state.baseUrl);
  countEl.textContent = unread > 99 ? "99+" : String(unread);
  countEl.style.background = unread > 0 ? "#dc2626" : "#16a34a";
  statusEl.textContent = state.lastError
    ? `อัปเดตไม่ได้: ${state.lastError}`
    : `Push พร้อมใช้งาน ${formatTime(state.pushRegisteredAt)} · badge ${formatTime(state.lastCheckedAt)}`;
}

async function registerPushAndRefresh() {
  refreshButton.disabled = true;
  statusEl.textContent = "กำลังลงทะเบียน push...";

  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  await chrome.storage.local.set({ baseUrl });

  const response = await chrome.runtime.sendMessage({ type: "registerPushBadge" });

  if (!response?.ok && response?.error) {
    statusEl.textContent = `อัปเดตไม่ได้: ${response.error}`;
  }

  await render();
  refreshButton.disabled = false;
}

baseUrlInput.addEventListener("change", registerPushAndRefresh);
refreshButton.addEventListener("click", registerPushAndRefresh);
openAdminButton.addEventListener("click", async () => {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  await chrome.storage.local.set({ baseUrl });
  await chrome.tabs.create({ url: `${baseUrl}/chat/admin` });
  window.close();
});

void render();
