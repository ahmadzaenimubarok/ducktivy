import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const apiBase = import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:8787";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      })
    : null;

function App() {
  const today = localDateInputValue();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [filter, setFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [reminders, setReminders] = useState([]);
  const [summary, setSummary] = useState(emptySummary());
  const [defaults, setDefaults] = useState({ channelId: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatParsing, setChatParsing] = useState(false);
  const [chatResult, setChatResult] = useState(null);
  const [rescheduleId, setRescheduleId] = useState("");
  const [snoozeId, setSnoozeId] = useState("");
  const [rescheduleForm, setRescheduleForm] = useState({
    date: today,
    time: nearestTime()
  });
  const [form, setForm] = useState({
    task: "",
    date: today,
    time: nearestTime(),
    duration: "",
    channelId: "",
    strictMode: true
  });
  const taskInputRef = useRef(null);

  const activeCount = useMemo(() => summary.pending + summary.sent, [summary]);
  const accessToken = session?.access_token || "";

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      setMessage("Environment Supabase auth belum diset.");
      return undefined;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setUser(null);
        setReminders([]);
        setSummary(emptySummary());
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) {
      loadDashboard();
    }
  }, [filter, page, session?.access_token]);

  useEffect(() => {
    if (defaults.channelId && !form.channelId) {
      setForm((current) => ({ ...current, channelId: defaults.channelId }));
    }
  }, [defaults.channelId]);

  async function loadDashboard() {
    if (!accessToken) return;

    setLoading(true);
    try {
      const data = await apiGet(`/api/overview?filter=${filter}&page=${page}`, accessToken);
      setReminders(data.reminders ?? []);
      setPagination(data.pagination ?? { page, pageSize: 10, total: 0, totalPages: 1 });
      setSummary(data.summary ?? emptySummary());
      setDefaults(data.defaults ?? { channelId: "" });
      setUser(data.user ?? null);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createReminder(event) {
    event.preventDefault();
    try {
      await apiPost("/api/reminders", form, accessToken);
      setMessage("Reminder berhasil dibuat.");
      setForm((current) => ({ ...current, task: "" }));
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function parseChatReminder(event) {
    event.preventDefault();
    setChatParsing(true);
    setChatResult(null);

    try {
      const data = await apiPost("/api/reminders/parse", { text: chatPrompt }, accessToken);
      const reminder = data.reminder || {};
      setForm((current) => ({
        ...current,
        task: reminder.task || current.task,
        date: reminder.date || current.date,
        time: reminder.time || current.time,
        duration: reminder.duration || "",
        strictMode: reminder.strictMode ?? current.strictMode
      }));
      setChatResult(data);

      if (data.missingFields?.length) {
        setMessage(`AI masih butuh data: ${data.missingFields.join(", ")}.`);
      } else {
        setMessage("Draft reminder berhasil dibuat dari chat.");
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setChatParsing(false);
    }
  }

  function clearChatDraft() {
    setChatPrompt("");
    setChatResult(null);
    setMessage("");
    setForm((current) => ({
      ...current,
      task: "",
      date: today,
      time: nearestTime(),
      duration: "",
      strictMode: true
    }));
  }

  function editChatDraft() {
    taskInputRef.current?.focus();
  }

  async function markReminder(id, action) {
    try {
      await apiPatch(`/api/reminders/${id}/${action}`, accessToken);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteReminder(id) {
    const confirmed = window.confirm("Hapus reminder ini?");
    if (!confirmed) return;

    try {
      await apiDelete(`/api/reminders/${id}`, accessToken);
      setMessage("Reminder berhasil dihapus.");
      setSnoozeId("");
      setRescheduleId("");

      if (reminders.length === 1 && page > 1) {
        setPage((current) => current - 1);
        return;
      }

      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function snoozeReminder(id, minutes) {
    try {
      await apiPatchJson(`/api/reminders/${id}/snooze`, { minutes }, accessToken);
      setMessage(`Reminder ditunda ${minutes} menit.`);
      setSnoozeId("");
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function rescheduleReminder(event, id) {
    event.preventDefault();
    try {
      await apiPatchJson(`/api/reminders/${id}/reschedule`, rescheduleForm, accessToken);
      setMessage("Reminder berhasil dijadwalkan ulang.");
      setRescheduleId("");
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openReschedule(reminder) {
    const date = new Date(reminder.remind_at);
    setSnoozeId("");
    setRescheduleId(reminder.id);
    setRescheduleForm({
      date: localDateInputValue(date),
      time: localTimeInputValue(date)
    });
  }

  async function loginWithDiscord() {
    if (!supabase) {
      setMessage("Environment Supabase auth belum diset.");
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: window.location.origin
      }
    });
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (authLoading) {
    return (
      <main className="shell">
        <div className="empty auth-empty">Loading session...</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Personal Dashboard</p>
          <h1>Discord Productivity Automation Bot</h1>
          <button className="primary login-button" type="button" onClick={loginWithDiscord}>
            Login with Discord
          </button>
          {message ? <p className="status">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MVP Dashboard</p>
          <h1>Discord Productivity Automation Bot</h1>
        </div>
        <div className="account">
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : null}
          <div>
            <strong>{user?.username || "Discord user"}</strong>
            <span>{user?.discordUserId || "Loading..."}</span>
          </div>
          <button className="ghost" type="button" onClick={loadDashboard}>
            Refresh
          </button>
          <button className="muted" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <section className="metrics" aria-label="Daily summary">
        <Metric label="Today" value={summary.total} />
        <Metric label="Active" value={activeCount} />
        <Metric label="Done" value={summary.done} />
        <Metric label="Skipped" value={summary.skipped} />
        <Metric label="Rate" value={`${summary.completionRate}%`} />
      </section>

      <section className="workspace">
        <section className="panel create-panel">
          <div className="panel-head">
            <h2>Create Reminder</h2>
            <span>{form.strictMode ? "Strict" : "Soft"}</span>
          </div>

          <form onSubmit={parseChatReminder} className="chat-compose">
            <label>
              Chat AI
              <textarea
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                placeholder="Besok jam 8 malam ingatkan aku belajar Laravel 30 menit"
                rows={4}
              />
            </label>
            <button className="primary" type="submit" disabled={chatParsing || !chatPrompt.trim()}>
              {chatParsing ? "Parsing..." : "Parse with Groq"}
            </button>
            {chatResult ? (
              <div className="chat-result">
                <div>
                  <strong>Draft AI</strong>
                  <span>
                    {chatResult.reminder?.task || "Task belum jelas"} · {chatResult.reminder?.date || "Tanggal ?"}{" "}
                    {chatResult.reminder?.time || "Jam ?"}
                  </span>
                </div>
                <div className="draft-actions">
                  <button className="muted" type="button" onClick={editChatDraft}>
                    Edit
                  </button>
                  <button className="danger-muted" type="button" onClick={clearChatDraft}>
                    Clear
                  </button>
                </div>
              </div>
            ) : null}
          </form>

          <form onSubmit={createReminder} className="form-grid">
            <label className="wide">
              Task
              <input
                ref={taskInputRef}
                value={form.task}
                onChange={(event) => setFormValue("task", event.target.value)}
                placeholder="Belajar Laravel 30 menit"
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={form.date}
                onChange={(event) => setFormValue("date", event.target.value)}
                required
              />
            </label>
            <label>
              Time
              <input
                type="time"
                value={form.time}
                onChange={(event) => setFormValue("time", event.target.value)}
                required
              />
            </label>
            <label>
              Duration
              <input
                type="number"
                min="1"
                value={form.duration}
                onChange={(event) => setFormValue("duration", event.target.value)}
                placeholder="30"
              />
            </label>
            <label className="wide">
              Discord Channel ID
              <input
                value={form.channelId}
                onChange={(event) => setFormValue("channelId", event.target.value)}
                placeholder="Channel target reminder"
                required
              />
            </label>
            <label className="check wide">
              <input
                type="checkbox"
                checked={form.strictMode}
                onChange={(event) => setFormValue("strictMode", event.target.checked)}
              />
              Strict reminder tone
            </label>
            <button className="primary wide" type="submit">
              Create Reminder
            </button>
          </form>
          {message ? <p className="status">{message}</p> : null}
        </section>

        <section className="panel list-panel">
          <div className="panel-head">
            <h2>Reminders</h2>
            <FilterTabs value={filter} onChange={changeFilter} />
          </div>

          {loading ? (
            <div className="empty">Loading reminders...</div>
          ) : reminders.length === 0 ? (
            <div className="empty">No reminders for this filter.</div>
          ) : (
            <div className="reminder-list">
              {reminders.map((reminder) => (
                <article className="reminder-item" key={reminder.id}>
                  <button
                    className="delete-button"
                    type="button"
                    aria-label="Delete reminder"
                    title="Delete reminder"
                    onClick={() => deleteReminder(reminder.id)}
                  >
                    ×
                  </button>
                  <div className="reminder-main">
                    <span className={`pill ${reminder.status}`}>{reminder.status}</span>
                    <h3>{reminder.task}</h3>
                    <p>{formatDate(reminder.remind_at)}</p>
                    <small>{reminder.id}</small>
                  </div>
                  <div className="reminder-side">
                    <span>{reminder.duration_minutes ? `${reminder.duration_minutes} min` : "No duration"}</span>
                    {["pending", "sent"].includes(reminder.status) ? (
                      <div className="actions">
                        <button type="button" onClick={() => markReminder(reminder.id, "done")}>
                          Done
                        </button>
                        <button className="muted" type="button" onClick={() => markReminder(reminder.id, "skip")}>
                          Skip
                        </button>
                        <div className="menu-wrap">
                          <button
                            className="muted"
                            type="button"
                            onClick={() => {
                              setRescheduleId("");
                              setSnoozeId((current) => (current === reminder.id ? "" : reminder.id));
                            }}
                          >
                            Snooze
                          </button>
                          {snoozeId === reminder.id ? (
                            <div className="snooze-menu">
                              <button type="button" onClick={() => snoozeReminder(reminder.id, 10)}>
                                10m
                              </button>
                              <button type="button" onClick={() => snoozeReminder(reminder.id, 30)}>
                                30m
                              </button>
                              <button type="button" onClick={() => snoozeReminder(reminder.id, 60)}>
                                1h
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <button className="muted reschedule-button" type="button" onClick={() => openReschedule(reminder)}>
                          Reschedule
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {rescheduleId === reminder.id ? (
                    <form className="reschedule-form" onSubmit={(event) => rescheduleReminder(event, reminder.id)}>
                      <input
                        type="date"
                        value={rescheduleForm.date}
                        onChange={(event) => setRescheduleValue("date", event.target.value)}
                        required
                      />
                      <input
                        type="time"
                        value={rescheduleForm.time}
                        onChange={(event) => setRescheduleValue("time", event.target.value)}
                        required
                      />
                      <button type="submit">Save</button>
                      <button className="muted" type="button" onClick={() => setRescheduleId("")}>
                        Cancel
                      </button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            pageSize={pagination.pageSize}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
          />
        </section>
      </section>
    </main>
  );

  function setFormValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setRescheduleValue(key, value) {
    setRescheduleForm((current) => ({ ...current, [key]: value }));
  }

  function changeFilter(nextFilter) {
    setFilter(nextFilter);
    setPage(1);
    setSnoozeId("");
    setRescheduleId("");
  }
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterTabs({ value, onChange }) {
  const filters = [
    ["all", "All"],
    ["today", "Today"],
    ["active", "Active"],
    ["done", "Done"],
    ["skipped", "Skipped"]
  ];

  return (
    <div className="tabs">
      {filters.map(([id, label]) => (
        <button className={value === id ? "active" : ""} type="button" key={id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Pagination({ page, totalPages, total, pageSize, onPrev, onNext }) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="pagination">
      <span>
        {start}-{end} of {total}
      </span>
      <div>
        <button className="muted" type="button" onClick={onPrev} disabled={page <= 1}>
          Prev
        </button>
        <strong>
          {page} / {totalPages}
        </strong>
        <button className="muted" type="button" onClick={onNext} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}

async function apiGet(path, token) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(token)
  });
  return parseResponse(response);
}

async function apiPost(path, body, token) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function apiPatch(path, token) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "PATCH",
    headers: authHeaders(token)
  });
  return parseResponse(response);
}

async function apiPatchJson(path, body, token) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function apiDelete(path, token) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
  return parseResponse(response);
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatDate(value) {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta"
  });
}

function nearestTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 10);
  return date.toTimeString().slice(0, 5);
}

function localDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function emptySummary() {
  return {
    total: 0,
    done: 0,
    skipped: 0,
    pending: 0,
    sent: 0,
    completionRate: 0
  };
}

createRoot(document.getElementById("root")).render(<App />);
