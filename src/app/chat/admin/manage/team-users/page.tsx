"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type TeamUser = {
  id: string;
  username: string;
  fullname: string | null;
  department: string | null;
  role: "admin" | "team";
  is_active: boolean;
  last_login: string | null;
  created_at: string;
};

type SortKey = keyof Pick<
  TeamUser,
  "username" | "fullname" | "department" | "role" | "last_login" | "created_at"
>;
type SortDirection = "asc" | "desc";
type UserFormState = {
  username: string;
  password: string;
  fullname: string;
  department: string;
  role: TeamUser["role"];
  is_active: boolean;
};
type ModalState =
  | { mode: "add"; user: null; form: UserFormState }
  | { mode: "edit"; user: TeamUser; form: UserFormState };

function emptyForm(): UserFormState {
  return {
    username: "",
    password: "",
    fullname: "",
    department: "",
    role: "team",
    is_active: true,
  };
}

function formFromUser(user: TeamUser): UserFormState {
  return {
    username: user.username,
    password: "",
    fullname: user.fullname ?? "",
    department: user.department ?? "",
    role: user.role,
    is_active: user.is_active,
  };
}

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "th-TH", { numeric: true, sensitivity: "base" });
}

function compareDate(a: string | null, b: string | null) {
  const at = a ? new Date(a).getTime() : 0;
  const bt = b ? new Date(b).getTime() : 0;
  return at - bt;
}

function roleLabel(role: TeamUser["role"]) {
  return role === "admin" ? "Admin" : "Team";
}

export default function TeamUsersManagePage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("username");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/chat/team-users", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { users: TeamUser[] };
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.requestAnimationFrame(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visibleUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = users.filter((user) => {
      if (!query) return true;
      return [
        user.username,
        user.fullname ?? "",
        user.department ?? "",
        roleLabel(user.role),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    const factor = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let result = 0;
      if (sortKey === "last_login" || sortKey === "created_at") {
        result = compareDate(a[sortKey], b[sortKey]);
      } else {
        result = compareText(String(a[sortKey] ?? ""), String(b[sortKey] ?? ""));
      }
      return result === 0
        ? compareText(a.username, b.username)
        : result * factor;
    });
  }, [filter, sortDirection, sortKey, users]);

  function changeSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "last_login" || key === "created_at" ? "desc" : "asc");
  }

  function sortLabel(key: SortKey) {
    if (sortKey !== key) return "not sorted";
    return sortDirection === "asc" ? "sorted ascending" : "sorted descending";
  }

  function updateForm(patch: Partial<UserFormState>) {
    setModal((current) =>
      current ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        modal.mode === "add"
          ? "/api/chat/team-users"
          : `/api/chat/team-users/${encodeURIComponent(modal.user.id)}`,
        {
          method: modal.mode === "add" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(modal.form),
        },
      );
      const data = (await response.json()) as {
        user?: TeamUser;
        error?: string;
      };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      const savedUser = data.user;

      setUsers((current) =>
        modal.mode === "add"
          ? [...current, savedUser]
          : current.map((user) => (user.id === savedUser.id ? savedUser : user)),
      );
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: TeamUser) {
    const confirmed = window.confirm(`Delete user "${user.username}"?`);
    if (!confirmed) return;

    setDeletingId(user.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/chat/team-users/${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-6">
      <section className="mx-auto flex w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--inset)]/50 px-6 py-4">
          <div>
            <h1 className="text-[20px] font-bold">Team users</h1>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              รายการบัญชีเจ้าหน้าที่ที่เข้าใช้งานระบบแชท
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setModal({ mode: "add", user: null, form: emptyForm() })}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-3 py-2 text-[13px] font-bold text-white shadow-sm transition-transform active:scale-[0.98]"
            >
              <PlusIcon />
              Add user
            </button>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)]"
            >
              <RefreshIcon />
              รีเฟรช
            </button>
            <Link
              href="/chat/admin/manage/conversations"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <MessagesIcon />
              Conversations
            </Link>
            <Link
              href="/chat/team"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <ArrowLeftIcon />
              กลับหน้าแชท
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[12px] font-semibold text-[var(--muted)]">
            ค้นหา team user
            <input
              type="text"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="username, fullname, department..."
              className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
            />
          </label>
          <div className="text-[13px] text-[var(--muted)]">
            แสดง {visibleUsers.length.toLocaleString("th-TH")} /{" "}
            {users.length.toLocaleString("th-TH")} รายการ
          </div>
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-[var(--inset)]/70 text-[12px] text-[var(--muted)]">
              <tr>
                {[
                  ["username", "Username"],
                  ["fullname", "Full name"],
                  ["department", "Department"],
                  ["role", "Role"],
                  ["last_login", "Last login"],
                  ["created_at", "Created"],
                ].map(([key, label]) => (
                  <th key={key} className="px-6 py-3 font-semibold">
                    <button
                      type="button"
                      onClick={() => changeSort(key as SortKey)}
                      aria-label={`Sort by ${label}, ${sortLabel(key as SortKey)}`}
                      className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--text)]"
                    >
                      <span>{label}</span>
                      <SortIcon
                        active={sortKey === key}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                ))}
                <th className="px-6 py-3 text-right font-semibold">Status</th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-[14px] text-[var(--muted)]"
                  >
                    กำลังโหลด...
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-[14px] text-[var(--muted)]"
                  >
                    ไม่พบ team user
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-[var(--border)]/70 transition-colors hover:bg-[var(--inset)]/45"
                  >
                    <td className="px-6 py-4 text-[14px] font-semibold">
                      {user.username}
                    </td>
                    <td className="px-6 py-4 text-[14px]">
                      {user.fullname?.trim() || "-"}
                    </td>
                    <td className="px-6 py-4 text-[14px]">
                      {user.department?.trim() || "-"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-[var(--accent)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--accent)]">
                        {roleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[13px]">
                      {formatDateTime(user.last_login)}
                    </td>
                    <td className="px-6 py-4 text-[13px]">
                      {formatDateTime(user.created_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          user.is_active
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-slate-500/15 text-slate-500"
                        }`}
                      >
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--inset)] p-1">
                        <button
                          type="button"
                          title={`Edit ${user.username}`}
                          aria-label={`Edit ${user.username}`}
                          onClick={() =>
                            setModal({
                              mode: "edit",
                              user,
                              form: formFromUser(user),
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          title={`Delete ${user.username}`}
                          aria-label={`Delete ${user.username}`}
                          disabled={deletingId === user.id}
                          onClick={() => void deleteUser(user)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:cursor-wait disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-red-300/45"
                        >
                          {deletingId === user.id ? <SpinnerIcon /> : <TrashIcon />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={modal.mode === "add" ? "Add team user" : "Edit team user"}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setModal(null);
          }}
        >
          <form
            onSubmit={saveUser}
            className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.32)]"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-bold">
                  {modal.mode === "add" ? "Add team user" : "Edit team user"}
                </h2>
                <p className="mt-1 text-[13px] text-[var(--muted)]">
                  {modal.mode === "add"
                    ? "Create a login account for chat staff."
                    : `Update profile and access for ${modal.user.username}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={saving}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--inset)] text-[var(--muted)] transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                aria-label="Close"
              >
                <XIcon />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--muted)]">
                Username
                <input
                  value={modal.form.username}
                  onChange={(event) => updateForm({ username: event.target.value })}
                  disabled={modal.mode === "edit" || saving}
                  required
                  minLength={3}
                  className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none disabled:opacity-60 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                />
              </label>
              {modal.mode === "add" && (
                <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--muted)]">
                  Password
                  <input
                    type="password"
                    value={modal.form.password}
                    onChange={(event) =>
                      updateForm({ password: event.target.value })
                    }
                    required
                    minLength={6}
                    disabled={saving}
                    className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none disabled:opacity-60 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--muted)]">
                Full name
                <input
                  value={modal.form.fullname}
                  onChange={(event) => updateForm({ fullname: event.target.value })}
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none disabled:opacity-60 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--muted)]">
                Department
                <input
                  value={modal.form.department}
                  onChange={(event) =>
                    updateForm({ department: event.target.value })
                  }
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none disabled:opacity-60 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--muted)]">
                Role
                <select
                  value={modal.form.role}
                  onChange={(event) =>
                    updateForm({ role: event.target.value as TeamUser["role"] })
                  }
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none disabled:opacity-60 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                >
                  <option value="team">Team</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[13px] font-semibold text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={modal.form.is_active}
                  onChange={(event) =>
                    updateForm({ is_active: event.target.checked })
                  }
                  disabled={saving}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Active account
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
              >
                <XIcon />
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-2 text-[13px] font-bold text-white shadow-sm disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? <SpinnerIcon /> : <CheckIcon />}
                {saving ? "Saving..." : modal.mode === "add" ? "Add user" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12A9 9 0 0 1 18.5 5.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 opacity-40"
        aria-hidden
      >
        <path d="m8 7 4-4 4 4" />
        <path d="M12 3v18" />
        <path d="m16 17-4 4-4-4" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 text-[var(--accent)]"
      aria-hidden
    >
      {direction === "asc" ? (
        <>
          <path d="m7 11 5-5 5 5" />
          <path d="M12 18V6" />
        </>
      ) : (
        <>
          <path d="m7 13 5 5 5-5" />
          <path d="M12 6v12" />
        </>
      )}
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 animate-spin"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.25}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
