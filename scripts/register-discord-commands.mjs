import { readFileSync, existsSync } from "node:fs";

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

async function discordFetch(path, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${body?.message ?? text}`);
  }

  return body;
}

loadDotEnv();

const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const commands = [
  {
    name: "remind",
    description: "Manage discipline reminders",
    options: [
      {
        type: 1,
        name: "test",
        description: "Check whether the reminder bot can respond"
      },
      {
        type: 1,
        name: "add",
        description: "Create a reminder",
        options: [
          { type: 3, name: "task", description: "Task title", required: true },
          { type: 3, name: "date", description: "Reminder date, for example 2026-05-21", required: true },
          { type: 3, name: "time", description: "Reminder time, for example 21:00", required: true },
          { type: 3, name: "channel_id", description: "Discord channel ID", required: false },
          { type: 4, name: "duration", description: "Duration in minutes", required: false },
          { type: 5, name: "strict_mode", description: "Use firm reminder tone", required: false }
        ]
      },
      {
        type: 1,
        name: "list",
        description: "List pending reminders"
      },
      {
        type: 1,
        name: "done",
        description: "Mark a reminder as done",
        options: [{ type: 3, name: "id", description: "Reminder ID", required: true }]
      },
      {
        type: 1,
        name: "skip",
        description: "Mark a reminder as skipped",
        options: [{ type: 3, name: "id", description: "Reminder ID", required: true }]
      },
      {
        type: 1,
        name: "summary",
        description: "Show today's summary"
      }
    ]
  }
];

const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const path = guildId
  ? `/applications/${appId}/guilds/${guildId}/commands`
  : `/applications/${appId}/commands`;

const registered = await discordFetch(path, {
  method: "PUT",
  body: JSON.stringify(commands)
});

console.log(
  guildId
    ? `Registered ${registered.length} guild command set for guild ${guildId}.`
    : `Registered ${registered.length} global command set. Global commands can take time to appear.`
);
console.log("Try: /remind test");
