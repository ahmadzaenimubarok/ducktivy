import { readFileSync, existsSync } from "node:fs";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import {
  appDayRange,
  formatAppDateTime,
  parseAppDateTime
} from "../supabase/functions/_shared/dateTime.js";

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

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  process.env.SUPABASE_URL && supabaseKey
    ? createClient(process.env.SUPABASE_URL, supabaseKey, {
        realtime: {
          transport: ws
        }
      })
    : null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Local Discord bot is online as ${readyClient.user.tag}`);
  console.log(`Supabase: ${supabase ? "configured" : "missing env"}`);
  console.log("Try command: /remind test or /remind add");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await handleReminderButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== "remind") {
    await interaction.reply({ content: "Command belum didukung.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === "test") {
    await interaction.reply({
      content: "Bot aktif. Sistem reminder siap dipakai.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "add") {
    await handleAddReminder(interaction);
    return;
  }

  if (subcommand === "list") {
    await handleListReminders(interaction);
    return;
  }

  if (subcommand === "done") {
    await handleDoneReminder(interaction);
    return;
  }

  if (subcommand === "skip") {
    await handleSkipReminder(interaction);
    return;
  }

  if (subcommand === "snooze") {
    await handleSnoozeReminder(interaction);
    return;
  }

  if (subcommand === "reschedule") {
    await handleRescheduleReminder(interaction);
    return;
  }

  if (subcommand === "summary") {
    await handleSummary(interaction);
    return;
  }

  await interaction.reply({
    content: "Command ini sudah terdaftar, tapi handler lokal MVP baru mendukung /remind test, /remind add, /remind list, /remind done, /remind skip, /remind snooze, /remind reschedule, dan /remind summary.",
    ephemeral: true
  });
});

client.login(process.env.DISCORD_BOT_TOKEN);

async function handleAddReminder(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const task = interaction.options.getString("task", true);
  const date = interaction.options.getString("date", true);
  const time = interaction.options.getString("time", true);
  const channelId = interaction.options.getString("channel_id") || interaction.channelId;
  const duration = interaction.options.getInteger("duration");
  const strictMode = interaction.options.getBoolean("strict_mode") ?? true;
  const remindAt = parseReminderDateTime(date, time);

  if (!remindAt) {
    await interaction.reply({
      content: "Format tanggal atau jam belum valid. Contoh: date `2026-05-21`, time `21:00`.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      discord_user_id: interaction.user.id,
      discord_channel_id: channelId,
      task,
      remind_at: remindAt.toISOString(),
      duration_minutes: duration,
      strict_mode: strictMode
    })
    .select("id, task, remind_at")
    .single();

  if (error) {
    await interaction.editReply(`Gagal membuat reminder: ${error.message}`);
    return;
  }

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action: "created",
    message: "Created from local Discord bot"
  });

  await interaction.editReply({
    content: [
      "Reminder dibuat.",
      "",
      `Task: ${data.task}`,
      `Waktu: ${formatTime(data.remind_at)}`,
      `ID: ${data.id}`,
      "",
      "Shortcut:"
    ].join("\n"),
    components: [reminderActionRow(data.id)]
  });
}

function reminderActionRow(reminderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reminder:done:${reminderId}`)
      .setLabel("Done")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reminder:skip:${reminderId}`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reminder:snooze10:${reminderId}`)
      .setLabel("+10m")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reminder:snooze30:${reminderId}`)
      .setLabel("+30m")
      .setStyle(ButtonStyle.Secondary)
  );
}

function reminderSelectRows(reminders) {
  const rows = [];

  for (let index = 0; index < reminders.length; index += 5) {
    const row = new ActionRowBuilder();
    reminders.slice(index, index + 5).forEach((reminder, offset) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`reminder:select:${reminder.id}`)
          .setLabel(String(index + offset + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }

  return rows;
}

function parseReminderDateTime(date, time) {
  return parseAppDateTime(date, time);
}

function formatTime(value) {
  return formatAppDateTime(value);
}

async function handleListReminders(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await supabase
    .from("reminders")
    .select("id, task, remind_at, status")
    .eq("discord_user_id", interaction.user.id)
    .in("status", ["pending", "sent"])
    .order("remind_at", { ascending: true })
    .limit(10);

  if (error) {
    await interaction.editReply(`Gagal mengambil reminder: ${error.message}`);
    return;
  }

  if (!data.length) {
    await interaction.editReply("Tidak ada reminder pending.");
    return;
  }

  const lines = data.map((reminder, index) => {
    return `${index + 1}. ${reminder.task} - ${formatTime(reminder.remind_at)} (${reminder.status})\nID: ${reminder.id}`;
  });

  await interaction.editReply({
    content: ["Pending reminders:", ...lines, "", "Pilih nomor reminder untuk melihat detail:"].join("\n\n"),
    components: reminderSelectRows(data)
  });
}

async function handleDoneReminder(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const id = interaction.options.getString("id", true);

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await markReminderStatus(id, "done", interaction.user.id);

  if (error || !data) {
    await interaction.editReply(notFoundMessage());
    return;
  }

  await interaction.editReply(
    [
      "Selesai dicatat.",
      "",
      "Bagus. Kamu menepati jadwal yang kamu buat sendiri.",
      "",
      `Task: ${data.task}`
    ].join("\n")
  );
}

async function handleSkipReminder(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const id = interaction.options.getString("id", true);

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await markReminderStatus(id, "skipped", interaction.user.id);

  if (error || !data) {
    await interaction.editReply(notFoundMessage());
    return;
  }

  await interaction.editReply(
    [
      "Skip dicatat.",
      "",
      "Kalau alasannya valid, tidak masalah.",
      "Kalau cuma malas atau menunda, jangan jadikan pola.",
      "",
      `Task: ${data.task}`
    ].join("\n")
  );
}

async function handleReminderButton(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const [scope, action, id] = interaction.customId.split(":");

  if (scope !== "reminder" || !["select", "done", "skip", "snooze10", "snooze30"].includes(action) || !id) {
    await interaction.reply({ content: "Button reminder tidak valid.", ephemeral: true });
    return;
  }

  if (action === "select") {
    await handleReminderSelect(interaction, id);
    return;
  }

  if (action === "snooze10" || action === "snooze30") {
    const minutes = action === "snooze10" ? 10 : 30;
    const { data, error } = await updateReminderSchedule({
      id,
      userId: interaction.user.id,
      remindAt: new Date(Date.now() + minutes * 60_000),
      action: "snoozed",
      message: `Snoozed from Discord button for ${minutes} minutes`
    });

    if (error || !data) {
      await interaction.update({
        content: notFoundMessage(),
        components: []
      });
      return;
    }

    await interaction.update({
      content: `Reminder ditunda ${minutes} menit.\n\nJadwal baru: ${formatTime(data.remind_at)}\nJangan ditunda lagi kalau tidak perlu.`,
      components: []
    });
    return;
  }

  const status = action === "done" ? "done" : "skipped";
  const { data, error } = await markReminderStatus(id, status, interaction.user.id);

  if (error || !data) {
    await interaction.update({
      content: notFoundMessage(),
      components: []
    });
    return;
  }

  if (status === "done") {
    await interaction.update({
      content: [
        "Selesai dicatat.",
        "",
        "Bagus. Kamu menepati jadwal yang kamu buat sendiri.",
        "",
        `Task: ${data.task}`
      ].join("\n"),
      components: []
    });
    return;
  }

  await interaction.update({
    content: [
      "Skip dicatat.",
      "",
      "Kalau alasannya valid, tidak masalah.",
      "Kalau cuma malas atau menunda, jangan jadikan pola.",
      "",
      `Task: ${data.task}`
    ].join("\n"),
    components: []
  });
}

async function handleReminderSelect(interaction, id) {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, task, remind_at, duration_minutes, status, strict_mode")
    .eq("id", id)
    .eq("discord_user_id", interaction.user.id)
    .in("status", ["pending", "sent"])
    .single();

  if (error || !data) {
    await interaction.update({
      content: notFoundMessage(),
      components: []
    });
    return;
  }

  await interaction.update({
    content: reminderDetailContent(data),
    components: [reminderActionRow(data.id)]
  });
}

function reminderDetailContent(reminder) {
  return [
    "Reminder detail:",
    "",
    `Task: ${reminder.task}`,
    `Time: ${formatTime(reminder.remind_at)}`,
    `Status: ${reminder.status}`,
    `Duration: ${reminder.duration_minutes ? `${reminder.duration_minutes} minutes` : "-"}`,
    `Strict mode: ${reminder.strict_mode ? "on" : "off"}`,
    "",
    "Pilih aksi:"
  ].join("\n");
}

async function markReminderStatus(id, status, userId) {
  const timestampField = status === "done" ? "completed_at" : "skipped_at";
  const logAction = status === "done" ? "done" : "skipped";

  const { data, error } = await supabase
    .from("reminders")
    .update({
      status,
      [timestampField]: new Date().toISOString()
    })
    .eq("id", id)
    .eq("discord_user_id", userId)
    .in("status", ["pending", "sent"])
    .select("id, task")
    .single();

  if (error || !data) return { data, error };

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action: logAction,
    message: `Marked ${status} from local Discord bot`
  });

  return { data, error: null };
}

async function handleSnoozeReminder(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const id = interaction.options.getString("id", true);
  const minutes = interaction.options.getInteger("minutes", true);

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await updateReminderSchedule({
    id,
    userId: interaction.user.id,
    remindAt: new Date(Date.now() + minutes * 60_000),
    action: "snoozed",
    message: `Snoozed from Discord command for ${minutes} minutes`
  });

  if (error || !data) {
    await interaction.editReply(notFoundMessage());
    return;
  }

  await interaction.editReply(`Reminder ditunda ${minutes} menit.\n\nJadwal baru: ${formatTime(data.remind_at)}\nJangan ditunda lagi kalau tidak perlu.`);
}

async function handleRescheduleReminder(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  const id = interaction.options.getString("id", true);
  const date = interaction.options.getString("date", true);
  const time = interaction.options.getString("time", true);
  const remindAt = parseReminderDateTime(date, time);

  if (!remindAt) {
    await interaction.reply({
      content: "Format tanggal atau jam belum valid. Contoh: date `2026-05-24`, time `21:00`.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await updateReminderSchedule({
    id,
    userId: interaction.user.id,
    remindAt,
    action: "rescheduled",
    message: `Rescheduled from Discord command to ${remindAt.toISOString()}`
  });

  if (error || !data) {
    await interaction.editReply(notFoundMessage());
    return;
  }

  await interaction.editReply(`Reminder dijadwalkan ulang.\n\nJadwal baru: ${formatTime(data.remind_at)}\nPastikan ini penyesuaian, bukan pelarian.`);
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

async function handleSummary(interaction) {
  if (!supabase) {
    await interaction.reply({
      content: "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const { start, end } = todayRange();
  const { data, error } = await supabase
    .from("reminders")
    .select("status")
    .eq("discord_user_id", interaction.user.id)
    .gte("remind_at", start.toISOString())
    .lt("remind_at", end.toISOString());

  if (error) {
    await interaction.editReply(`Gagal mengambil summary: ${error.message}`);
    return;
  }

  const done = data.filter((reminder) => reminder.status === "done").length;
  const skipped = data.filter((reminder) => reminder.status === "skipped").length;
  const pending = data.filter((reminder) => reminder.status === "pending" || reminder.status === "sent").length;
  const completed = done + skipped;
  const completionRate = completed === 0 ? 0 : Math.round((done / completed) * 100);

  await interaction.editReply(
    [
      "Daily Discipline Summary",
      "",
      `Done: ${done}`,
      `Skipped: ${skipped}`,
      `Pending: ${pending}`,
      "",
      `Completion rate: ${completionRate}%`
    ].join("\n")
  );
}

function todayRange() {
  return appDayRange();
}

function notFoundMessage() {
  return "Reminder tidak ditemukan.\n\nKemungkinan sudah selesai, sudah di-skip, bukan milik kamu, atau ID-nya salah.";
}
