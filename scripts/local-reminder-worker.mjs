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

const required = ["DISCORD_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
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

const pollMs = Number(process.env.REMINDER_WORKER_POLL_MS || 30_000);

console.log(`Reminder worker started. Polling every ${pollMs / 1000}s.`);

await checkDueReminders();
setInterval(() => {
  checkDueReminders().catch((error) => {
    console.error(`Worker check failed: ${error.message}`);
  });
}, pollMs);

async function checkDueReminders() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("reminders")
    .select("id, discord_user_id, discord_channel_id, task, remind_at, duration_minutes, strict_mode")
    .eq("status", "pending")
    .lte("remind_at", now)
    .order("remind_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error(`Failed to fetch due reminders: ${error.message}`);
    return;
  }

  if (!data.length) {
    console.log(`[${new Date().toLocaleTimeString()}] No due reminders.`);
    return;
  }

  for (const reminder of data) {
    await sendReminder(reminder);
  }
}

async function sendReminder(reminder) {
  const sentAt = new Date().toISOString();

  const claimed = await supabase
    .from("reminders")
    .update({
      status: "sent",
      sent_at: sentAt
    })
    .eq("id", reminder.id)
    .eq("status", "pending")
    .select("id")
    .single();

  if (claimed.error || !claimed.data) {
    console.log(`Skipped reminder ${reminder.id}; it was already claimed or updated.`);
    return;
  }

  const response = await discordFetch(`/channels/${reminder.discord_channel_id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: reminderContent(reminder),
      allowed_mentions: {
        users: [reminder.discord_user_id]
      },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Done",
              custom_id: `reminder:done:${reminder.id}`
            },
            {
              type: 2,
              style: 2,
              label: "Skip",
              custom_id: `reminder:skip:${reminder.id}`
            },
            {
              type: 2,
              style: 2,
              label: "+10m",
              custom_id: `reminder:snooze10:${reminder.id}`
            },
            {
              type: 2,
              style: 2,
              label: "+30m",
              custom_id: `reminder:snooze30:${reminder.id}`
            }
          ]
        }
      ]
    })
  });

  if (response.ok) {
    await supabase.from("reminder_logs").insert({
      reminder_id: reminder.id,
      action: "sent",
      message: "Reminder sent by local worker"
    });
    console.log(`Sent reminder ${reminder.id}: ${reminder.task}`);
    return;
  }

  const message = await response.text();
  await supabase.from("reminder_logs").insert({
    reminder_id: reminder.id,
    action: "failed",
    message
  });
  console.error(`Failed to send reminder ${reminder.id}: ${message}`);
}

async function discordFetch(path, options = {}) {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}

function reminderContent(reminder) {
  return [
    `<@${reminder.discord_user_id}>`,
    "",
    `Waktunya mulai: ${reminder.task}`,
    "",
    reminder.strict_mode
      ? "Jangan negosiasi dengan jadwal sendiri.\nMulai dari 5 menit pertama dulu."
      : "Mulai kecil dulu. Yang penting bergerak sekarang.",
    "",
    "Pilih Done kalau selesai.",
    "Pilih Skip hanya kalau benar-benar tidak dikerjakan."
  ]
    .filter(Boolean)
    .join("\n");
}
