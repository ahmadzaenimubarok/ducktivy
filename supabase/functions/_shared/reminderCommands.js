import { formatAppTime, parseAppDateTimeToIso } from "./dateTime.js";

export function parseLocalCommand(argv) {
  const [command = "demo", ...tokens] = argv;
  const flags = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = tokens[index + 1];
    flags[key] = next && !next.startsWith("--") ? next : true;
    if (flags[key] !== true) index += 1;
  }

  return { command, flags };
}

export function parseReminderTime(date, time, now = new Date()) {
  if (!time) throw new Error("time is required");

  const day = date || now.toISOString().slice(0, 10);
  const remindAt = parseAppDateTimeToIso(day, time);

  if (!remindAt) {
    throw new Error("invalid date or time");
  }

  return remindAt;
}

export async function runReminderCommand(input, store, now = new Date()) {
  switch (input.command) {
    case "add": {
      const task = input.flags.task;
      const time = input.flags.time;
      const channel = input.flags.channel || "test-channel";
      const user = input.flags.user || "test-user";

      if (!task) throw new Error("--task is required");
      if (!time) throw new Error("--time is required");

      const reminder = await store.createReminder({
        discord_user_id: user,
        discord_channel_id: channel,
        task,
        remind_at: parseReminderTime(input.flags.date, time, now),
        duration_minutes: input.flags.duration ? Number(input.flags.duration) : null,
        strict_mode: input.flags.strict !== "false"
      });

      return `Reminder dibuat.\n\nTask: ${reminder.task}\nWaktu: ${time}\nID: ${reminder.id}`;
    }
    case "list": {
      const reminders = await store.listReminders(input.flags.user || "test-user");
      if (reminders.length === 0) return "Tidak ada reminder pending.";

      return [
        "Pending reminders:",
        ...reminders.map((reminder, index) => {
          const time = formatAppTime(reminder.remind_at);
          return `${index + 1}. ${reminder.task} - ${time} (${reminder.status}) [${reminder.id}]`;
        })
      ].join("\n");
    }
    case "done": {
      const id = input.flags.id;
      if (!id) throw new Error("--id is required");
      await store.markReminder(id, "done");
      return "Selesai dicatat.\n\nBagus. Kamu menepati jadwal yang kamu buat sendiri.";
    }
    case "skip": {
      const id = input.flags.id;
      if (!id) throw new Error("--id is required");
      await store.markReminder(id, "skipped");
      return "Skip dicatat.\n\nKalau alasannya valid, tidak masalah.\nKalau cuma malas atau menunda, jangan jadikan pola.";
    }
    case "summary": {
      const summary = await store.summary(input.flags.user || "test-user");
      return [
        "Daily Discipline Summary",
        "",
        `Done: ${summary.done}`,
        `Skipped: ${summary.skipped}`,
        `Pending: ${summary.pending}`,
        "",
        `Completion rate: ${summary.completionRate}%`
      ].join("\n");
    }
    default:
      return runDemo(store, now);
  }
}

async function runDemo(store, now) {
  const created = await store.createReminder({
    discord_user_id: "test-user",
    discord_channel_id: "test-channel",
    task: "Belajar Laravel 30 menit",
    remind_at: parseReminderTime(now.toISOString().slice(0, 10), "21:00", now),
    duration_minutes: 30,
    strict_mode: true
  });

  await store.markReminder(created.id, "done");
  const summary = await store.summary("test-user");

  return [
    "Demo command flow OK",
    `Created reminder: ${created.id}`,
    `Marked as: ${created.status}`,
    `Summary done=${summary.done}, skipped=${summary.skipped}, pending=${summary.pending}, completionRate=${summary.completionRate}%`
  ].join("\n");
}
