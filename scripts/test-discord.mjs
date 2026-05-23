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
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw body for Discord errors that are not JSON.
  }

  if (!response.ok) {
    const message = typeof body === "object" && body?.message ? body.message : text;
    throw new Error(`Discord API ${response.status}: ${message}`);
  }

  return body;
}

loadDotEnv();

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

const bot = await discordFetch("/users/@me");

console.log(`Discord bot token OK: ${bot.username}#${bot.discriminator ?? "0000"} (${bot.id})`);

if (!process.env.DISCORD_TEST_CHANNEL_ID) {
  console.log("Set DISCORD_TEST_CHANNEL_ID in .env to send a real test message.");
  process.exit(0);
}

const message = await discordFetch(`/channels/${process.env.DISCORD_TEST_CHANNEL_ID}/messages`, {
  method: "POST",
  body: JSON.stringify({
    content: [
      "Test reminder from Discord Productivity Automation Bot.",
      "",
      "Waktunya mulai: testing awal.",
      "Mulai 5 menit pertama dulu."
    ].join("\n")
  })
});

console.log(`Test message sent: ${message.id}`);
