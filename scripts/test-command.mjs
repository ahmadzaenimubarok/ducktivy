import { parseLocalCommand, runReminderCommand } from "../supabase/functions/_shared/reminderCommands.js";

function createMemoryStore() {
  const reminders = [];
  const logs = [];

  return {
    async createReminder(payload) {
      const reminder = {
        id: `test-${String(reminders.length + 1).padStart(3, "0")}`,
        status: "pending",
        created_at: new Date().toISOString(),
        ...payload
      };
      reminders.push(reminder);
      logs.push({ reminder_id: reminder.id, action: "created" });
      return reminder;
    },
    async listReminders(userId) {
      return reminders.filter((reminder) => reminder.discord_user_id === userId && reminder.status !== "cancelled");
    },
    async markReminder(id, status) {
      const reminder = reminders.find((item) => item.id === id);
      if (!reminder) throw new Error(`reminder not found: ${id}`);

      reminder.status = status;
      if (status === "done") reminder.completed_at = new Date().toISOString();
      if (status === "skipped") reminder.skipped_at = new Date().toISOString();
      logs.push({ reminder_id: reminder.id, action: status });
      return reminder;
    },
    async summary(userId) {
      const userReminders = reminders.filter((reminder) => reminder.discord_user_id === userId);
      const done = userReminders.filter((reminder) => reminder.status === "done").length;
      const skipped = userReminders.filter((reminder) => reminder.status === "skipped").length;
      const pending = userReminders.filter((reminder) => reminder.status === "pending" || reminder.status === "sent").length;
      const completed = done + skipped;

      return {
        done,
        skipped,
        pending,
        completionRate: completed === 0 ? 0 : Math.round((done / completed) * 100)
      };
    },
    dump() {
      return { reminders, logs };
    }
  };
}

const input = parseLocalCommand(process.argv.slice(2));
const store = createMemoryStore();

try {
  const output = await runReminderCommand(input, store);
  console.log(output);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
