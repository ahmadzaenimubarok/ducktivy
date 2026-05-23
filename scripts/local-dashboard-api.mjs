import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

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
    if (request.method === "OPTIONS") {
      send(response, 204);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/overview") {
      await handleOverview(response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reminders") {
      await handleCreateReminder(request, response);
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)\/(done|skip)$/);
    if (request.method === "PATCH" && statusMatch) {
      await handleMarkReminder(response, statusMatch[1], statusMatch[2]);
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

async function handleOverview(response, url) {
  const filter = url.searchParams.get("filter") || "all";
  let query = supabase
    .from("reminders")
    .select("id, discord_user_id, discord_channel_id, task, remind_at, duration_minutes, status, strict_mode, sent_at, completed_at, skipped_at, created_at")
    .order("remind_at", { ascending: true });

  if (filter !== "all") {
    if (filter === "today") {
      const { start, end } = todayRange();
      query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    } else if (filter === "active") {
      query = query.in("status", ["pending", "sent"]);
    } else {
      query = query.eq("status", filter);
    }
  }

  const { data, error } = await query.limit(100);
  if (error) {
    send(response, 500, { error: error.message });
    return;
  }

  const allToday = await loadTodayReminders();
  send(response, 200, {
    reminders: data,
    summary: buildSummary(allToday),
    defaults: {
      channelId: process.env.DISCORD_TEST_CHANNEL_ID || ""
    }
  });
}

async function handleCreateReminder(request, response) {
  const body = await readJson(request);
  const remindAt = new Date(`${body.date}T${body.time}:00`);

  if (!body.task || !body.date || !body.time) {
    send(response, 400, { error: "Task, date, and time are required" });
    return;
  }

  if (Number.isNaN(remindAt.getTime())) {
    send(response, 400, { error: "Invalid reminder date or time" });
    return;
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      discord_user_id: body.discordUserId || "dashboard-user",
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

async function handleMarkReminder(response, id, action) {
  const status = action === "done" ? "done" : "skipped";
  const timestampField = status === "done" ? "completed_at" : "skipped_at";

  const { data, error } = await supabase
    .from("reminders")
    .update({
      status,
      [timestampField]: new Date().toISOString()
    })
    .eq("id", id)
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

async function loadTodayReminders() {
  const { start, end } = todayRange();
  const { data, error } = await supabase
    .from("reminders")
    .select("status")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

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
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
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
    "Access-Control-Allow-Origin": process.env.DASHBOARD_ORIGIN || "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  response.end(body ? JSON.stringify(body) : "");
}
