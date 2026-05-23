import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const apiBase = import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:8787";

function App() {
  const today = new Date().toISOString().slice(0, 10);
  const [filter, setFilter] = useState("all");
  const [reminders, setReminders] = useState([]);
  const [summary, setSummary] = useState(emptySummary());
  const [defaults, setDefaults] = useState({ channelId: "" });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    task: "",
    date: today,
    time: nearestTime(),
    channelId: "",
    discordUserId: "dashboard-user",
    duration: "",
    strictMode: true
  });

  const activeCount = useMemo(() => summary.pending + summary.sent, [summary]);

  useEffect(() => {
    loadDashboard();
  }, [filter]);

  useEffect(() => {
    if (defaults.channelId && !form.channelId) {
      setForm((current) => ({ ...current, channelId: defaults.channelId }));
    }
  }, [defaults.channelId]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const data = await apiGet(`/api/overview?filter=${filter}`);
      setReminders(data.reminders ?? []);
      setSummary(data.summary ?? emptySummary());
      setDefaults(data.defaults ?? { channelId: "" });
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
      await apiPost("/api/reminders", form);
      setMessage("Reminder created.");
      setForm((current) => ({ ...current, task: "", duration: "" }));
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function markReminder(id, action) {
    try {
      await apiPatch(`/api/reminders/${id}/${action}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MVP Dashboard</p>
          <h1>Discord Productivity Automation Bot</h1>
        </div>
        <button className="ghost" type="button" onClick={loadDashboard}>
          Refresh
        </button>
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

          <form onSubmit={createReminder} className="form-grid">
            <label className="wide">
              Task
              <input
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
            <label className="wide">
              Discord Channel ID
              <input
                value={form.channelId}
                onChange={(event) => setFormValue("channelId", event.target.value)}
                placeholder="Channel target reminder"
                required
              />
            </label>
            <label>
              Discord User ID
              <input
                value={form.discordUserId}
                onChange={(event) => setFormValue("discordUserId", event.target.value)}
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
            <FilterTabs value={filter} onChange={setFilter} />
          </div>

          {loading ? (
            <div className="empty">Loading reminders...</div>
          ) : reminders.length === 0 ? (
            <div className="empty">No reminders for this filter.</div>
          ) : (
            <div className="reminder-list">
              {reminders.map((reminder) => (
                <article className="reminder-item" key={reminder.id}>
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
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );

  function setFormValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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

async function apiGet(path) {
  const response = await fetch(`${apiBase}${path}`);
  return parseResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function apiPatch(path) {
  const response = await fetch(`${apiBase}${path}`, { method: "PATCH" });
  return parseResponse(response);
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatDate(value) {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function nearestTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 10);
  return date.toTimeString().slice(0, 5);
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
