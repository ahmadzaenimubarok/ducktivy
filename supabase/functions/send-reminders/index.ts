import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { reminderMessage } from "../_shared/reminderMessages.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const discordBotToken = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async () => {
  if (!supabaseUrl || !serviceRoleKey || !discordBotToken) {
    return json({ error: "Missing required environment variables" }, 500);
  }

  const now = new Date().toISOString();
  const { data: dueReminders, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("status", "pending")
    .lte("remind_at", now)
    .order("remind_at", { ascending: true })
    .limit(20);

  if (error) return json({ error: error.message }, 500);

  const results = [];

  for (const reminder of dueReminders ?? []) {
    const claimed = await supabase
      .from("reminders")
      .update({ status: "sent", sent_at: now })
      .eq("id", reminder.id)
      .eq("status", "pending")
      .select("id")
      .single();

    if (claimed.error || !claimed.data) {
      results.push({ id: reminder.id, status: "skipped_claim" });
      continue;
    }

    const discordResponse = await fetch(
      `https://discord.com/api/v10/channels/${reminder.discord_channel_id}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bot ${discordBotToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: reminderMessage(reminder.task),
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 3, label: "Done", custom_id: `reminder_done:${reminder.id}` },
                { type: 2, style: 2, label: "Skip", custom_id: `reminder_skip:${reminder.id}` }
              ]
            }
          ]
        })
      }
    );

    if (discordResponse.ok) {
      await supabase.from("reminder_logs").insert({
        reminder_id: reminder.id,
        action: "sent",
        message: "Reminder sent to Discord"
      });
      results.push({ id: reminder.id, status: "sent" });
    } else {
      const message = await discordResponse.text();
      await supabase.from("reminder_logs").insert({
        reminder_id: reminder.id,
        action: "failed",
        message
      });
      results.push({ id: reminder.id, status: "failed" });
    }
  }

  return json({ checked_at: now, count: results.length, results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
