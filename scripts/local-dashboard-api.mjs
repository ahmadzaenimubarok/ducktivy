import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { appDayRange, appTimeZone, parseAppDateTime } from "../supabase/functions/_shared/dateTime.js";

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: {
    transport: ws
  }
});

const port = Number(process.env.DASHBOARD_API_PORT || 8787);

const server = createServer(async (request, response) => {
  try {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      send(response, 204);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/me") {
      await handleMe(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/overview") {
      await handleOverview(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reminders") {
      await handleCreateReminder(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reminders/parse") {
      await handleParseReminder(request, response);
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)\/(done|skip)$/);
    if (request.method === "PATCH" && statusMatch) {
      await handleMarkReminder(request, response, statusMatch[1], statusMatch[2]);
      return;
    }

    const snoozeMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)\/snooze$/);
    if (request.method === "PATCH" && snoozeMatch) {
      await handleSnoozeReminder(request, response, snoozeMatch[1]);
      return;
    }

    const rescheduleMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)\/reschedule$/);
    if (request.method === "PATCH" && rescheduleMatch) {
      await handleRescheduleReminder(request, response, rescheduleMatch[1]);
      return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      await handleDeleteReminder(request, response, deleteMatch[1]);
      return;
    }

    send(response, 404, { error: "Not found" });
  } catch (error) {
    send(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Dashboard API ready at http://localhost:${port}`);
});

async function handleMe(request, response) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  send(response, 200, { user });
}

async function handleOverview(request, response, url) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const filter = url.searchParams.get("filter") || "active";
  const pageSize = 10;
  const requestedPage = Number(url.searchParams.get("page") || 1);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = supabase
    .from("reminders")
    .select("id, discord_user_id, discord_channel_id, task, remind_at, duration_minutes, status, strict_mode, sent_at, completed_at, skipped_at, created_at", { count: "exact" })
    .eq("discord_user_id", user.discordUserId)
    .order("remind_at", { ascending: true });

  if (filter !== "all") {
    if (filter === "today") {
      const { start, end } = todayRange();
      query = query.gte("remind_at", start.toISOString()).lt("remind_at", end.toISOString());
    } else if (filter === "active") {
      query = query.in("status", ["pending", "sent"]);
    } else {
      query = query.eq("status", filter);
    }
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    send(response, 500, { error: error.message });
    return;
  }

  const allToday = await loadTodayReminders(user.discordUserId);
  send(response, 200, {
    reminders: data,
    summary: buildSummary(allToday),
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize))
    },
    user,
    defaults: {
      channelId: process.env.DISCORD_TEST_CHANNEL_ID || ""
    }
  });
}

async function handleCreateReminder(request, response) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const body = await readJson(request);
  const remindAt = parseAppDateTime(body.date, body.time);

  if (!body.task || !body.date || !body.time) {
    send(response, 400, { error: "Task, date, and time are required" });
    return;
  }

  if (!remindAt) {
    send(response, 400, { error: "Invalid reminder date or time" });
    return;
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      discord_user_id: user.discordUserId,
      discord_channel_id: body.channelId || process.env.DISCORD_TEST_CHANNEL_ID,
      task: body.task,
      remind_at: remindAt.toISOString(),
      duration_minutes: body.duration ? Number(body.duration) : null,
      strict_mode: body.strictMode ?? true
    })
    .select("id")
    .single();

  if (error) {
    send(response, 500, { error: error.message });
    return;
  }

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action: "created",
    message: "Created from local dashboard"
  });

  send(response, 201, { id: data.id });
}

async function handleParseReminder(request, response) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const body = await readJson(request);
  const text = String(body.text || "").trim();

  if (!text) {
    send(response, 400, { error: "Isi chat reminder dulu." });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    send(response, 500, { error: "GROQ_API_KEY belum diset di server." });
    return;
  }

  const parsed = await parseReminderWithGroq(text);
  const reminder = normalizeParsedReminder(parsed);

  send(response, 200, {
    reminder,
    missingFields: missingReminderFields(reminder),
    raw: parsed
  });
}

async function handleMarkReminder(request, response, id, action) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const status = action === "done" ? "done" : "skipped";
  const timestampField = status === "done" ? "completed_at" : "skipped_at";

  const { data, error } = await supabase
    .from("reminders")
    .update({
      status,
      [timestampField]: new Date().toISOString()
    })
    .eq("id", id)
    .eq("discord_user_id", user.discordUserId)
    .in("status", ["pending", "sent"])
    .select("id")
    .single();

  if (error || !data) {
    send(response, 404, { error: "Reminder not found or already closed" });
    return;
  }

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action: status === "done" ? "done" : "skipped",
    message: "Marked from local dashboard"
  });

  send(response, 200, { id: data.id, status });
}

async function handleSnoozeReminder(request, response, id) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const body = await readJson(request);
  const minutes = Number(body.minutes || 10);

  if (![10, 30, 60].includes(minutes)) {
    send(response, 400, { error: "Snooze minutes must be 10, 30, or 60." });
    return;
  }

  const remindAt = new Date(Date.now() + minutes * 60_000);
  const { data, error } = await updateReminderSchedule({
    id,
    userId: user.discordUserId,
    remindAt,
    action: "snoozed",
    message: `Snoozed from dashboard for ${minutes} minutes`
  });

  if (error || !data) {
    send(response, 404, { error: "Reminder not found or already closed" });
    return;
  }

  send(response, 200, { id: data.id, remindAt: data.remind_at, status: data.status });
}

async function handleRescheduleReminder(request, response, id) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const body = await readJson(request);
  const remindAt = parseAppDateTime(body.date, body.time);

  if (!body.date || !body.time || !remindAt) {
    send(response, 400, { error: "Valid date and time are required." });
    return;
  }

  const { data, error } = await updateReminderSchedule({
    id,
    userId: user.discordUserId,
    remindAt,
    action: "rescheduled",
    message: `Rescheduled from dashboard to ${remindAt.toISOString()}`
  });

  if (error || !data) {
    send(response, 404, { error: "Reminder not found or already closed" });
    return;
  }

  send(response, 200, { id: data.id, remindAt: data.remind_at, status: data.status });
}

async function updateReminderSchedule({ id, userId, remindAt, action, message }) {
  const { data, error } = await supabase
    .from("reminders")
    .update({
      remind_at: remindAt.toISOString(),
      status: "pending",
      sent_at: null
    })
    .eq("id", id)
    .eq("discord_user_id", userId)
    .in("status", ["pending", "sent"])
    .select("id, remind_at, status")
    .single();

  if (error || !data) return { data, error };

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action,
    message
  });

  return { data, error: null };
}

async function handleDeleteReminder(request, response, id) {
  const user = await requireDashboardUser(request, response);
  if (!user) return;

  const { data, error } = await supabase
    .from("reminders")
    .delete()
    .eq("id", id)
    .eq("discord_user_id", user.discordUserId)
    .select("id")
    .single();

  if (error || !data) {
    send(response, 404, { error: "Reminder not found." });
    return;
  }

  send(response, 200, { id: data.id });
}

async function parseReminderWithGroq(text) {
  const context = appNowContext();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract reminder data from Indonesian or English user text. Return only valid JSON with keys: task, date, time, durationMinutes, strictMode, confidence, notes. date must be YYYY-MM-DD in the app timezone. time must be HH:mm 24-hour format. durationMinutes is a number or null. strictMode defaults to true unless the user asks for a soft/casual reminder. If a field is not present and cannot be inferred, use null. Do not invent task details."
          },
          {
            role: "user",
            content: [
              `App timezone: ${context.timeZone}`,
              `Current app date: ${context.date}`,
              `Current app time: ${context.time}`,
              `Reminder text: ${text}`
            ].join("\n")
          }
        ]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || "Groq request failed.");
    }

    const content = data.choices?.[0]?.message?.content;
    return parseJsonObject(content);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Groq terlalu lama merespons. Coba lagi.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeParsedReminder(parsed) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || "")) ? parsed.date : "";
  const time = /^\d{2}:\d{2}$/.test(String(parsed.time || "")) ? parsed.time : "";
  const duration = Number(parsed.durationMinutes);

  return {
    task: typeof parsed.task === "string" ? parsed.task.trim() : "",
    date,
    time,
    duration: Number.isFinite(duration) && duration > 0 ? duration : "",
    strictMode: parsed.strictMode !== false,
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
    notes: typeof parsed.notes === "string" ? parsed.notes.trim() : ""
  };
}

function missingReminderFields(reminder) {
  return ["task", "date", "time"].filter((field) => !reminder[field]);
}

function parseJsonObject(content) {
  if (!content) throw new Error("Groq tidak mengembalikan hasil parsing.");

  try {
    return JSON.parse(content);
  } catch (_error) {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Format respons Groq tidak valid.");
    return JSON.parse(match[0]);
  }
}

function appNowContext() {
  const timeZone = appTimeZone();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    timeZone,
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

async function loadTodayReminders(discordUserId) {
  const { start, end } = todayRange();
  const { data, error } = await supabase
    .from("reminders")
    .select("status")
    .eq("discord_user_id", discordUserId)
    .gte("remind_at", start.toISOString())
    .lt("remind_at", end.toISOString());

  if (error) return [];
  return data;
}

function buildSummary(reminders) {
  const done = reminders.filter((reminder) => reminder.status === "done").length;
  const skipped = reminders.filter((reminder) => reminder.status === "skipped").length;
  const pending = reminders.filter((reminder) => reminder.status === "pending").length;
  const sent = reminders.filter((reminder) => reminder.status === "sent").length;
  const total = reminders.length;
  const completed = done + skipped;

  return {
    total,
    done,
    skipped,
    pending,
    sent,
    completionRate: completed === 0 ? 0 : Math.round((done / completed) * 100)
  };
}

function todayRange() {
  return appDayRange();
}

async function requireDashboardUser(request, response) {
  const token = bearerToken(request);

  if (!token) {
    send(response, 401, { error: "Login with Discord first." });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    send(response, 401, { error: "Invalid or expired session." });
    return null;
  }

  const discordUserId = extractDiscordUserId(data.user);
  if (!discordUserId) {
    send(response, 403, { error: "Discord identity was not found on this Supabase user." });
    return null;
  }

  return {
    id: data.user.id,
    discordUserId,
    username:
      data.user.user_metadata?.full_name ||
      data.user.user_metadata?.name ||
      data.user.user_metadata?.preferred_username ||
      data.user.user_metadata?.user_name ||
      "Discord user",
    avatarUrl: data.user.user_metadata?.avatar_url || null
  };
}

function bearerToken(request) {
  const header = request.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : null;
}

function extractDiscordUserId(user) {
  const discordIdentity = user.identities?.find((identity) => identity.provider === "discord");
  const identityData = discordIdentity?.identity_data || {};

  return (
    user.user_metadata?.provider_id ||
    user.user_metadata?.sub ||
    user.user_metadata?.discord_id ||
    identityData.provider_id ||
    identityData.sub ||
    identityData.id ||
    discordIdentity?.id ||
    null
  );
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body = null) {
  response.writeHead(status, {
    "Content-Type": "application/json"
  });
  response.end(body ? JSON.stringify(body) : "");
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  const allowedOrigins = allowedDashboardOrigins();
  const allowOrigin =
    origin && (allowedOrigins.includes(origin) || isLocalOrigin(origin))
      ? origin
      : allowedOrigins[0];
  const requestedHeaders = request.headers["access-control-request-headers"];

  response.setHeader("Access-Control-Allow-Origin", allowOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", requestedHeaders || "Content-Type, Authorization");
  response.setHeader("Access-Control-Max-Age", "86400");
  response.setHeader("Vary", "Origin, Access-Control-Request-Headers");
}

function allowedDashboardOrigins() {
  const configured = String(process.env.DASHBOARD_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...configured, "http://localhost:5173", "http://127.0.0.1:5173"])];
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch (_error) {
    return false;
  }
}
