import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { appDayRange, formatAppTime, parseAppDateTimeToIso } from "../_shared/dateTime.js";
import { doneMessage, skippedMessage } from "../_shared/reminderMessages.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const discordPublicKey = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await request.text();

  if (!verifyDiscordRequest(request, rawBody)) {
    return json({ error: "Invalid request signature" }, 401);
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === 1) {
    return json({ type: 1 });
  }

  if (interaction.type === 3) {
    return handleButton(interaction);
  }

  if (interaction.type === 2) {
    return handleCommand(interaction);
  }

  return interactionResponse("Unsupported interaction.");
});

async function handleButton(interaction: any) {
  const customId = interaction.data?.custom_id ?? "";
  const [action, reminderId] = customId.split(":");

  if (action === "reminder_done") {
    await markReminder(reminderId, "done", interaction.member?.user?.id ?? interaction.user?.id);
    return interactionResponse(doneMessage());
  }

  if (action === "reminder_skip") {
    await markReminder(reminderId, "skipped", interaction.member?.user?.id ?? interaction.user?.id);
    return interactionResponse(skippedMessage());
  }

  if (action === "reminder_snooze10" || action === "reminder_snooze30") {
    const minutes = action === "reminder_snooze10" ? 10 : 30;
    const updated = await updateReminderSchedule({
      id: reminderId,
      userId: interaction.member?.user?.id ?? interaction.user?.id,
      remindAt: new Date(Date.now() + minutes * 60_000),
      action: "snoozed",
      message: `Snoozed from Discord button for ${minutes} minutes`
    });

    if (!updated) return interactionResponse(notFoundMessage());
    return interactionResponse(`Reminder ditunda ${minutes} menit.\n\nJadwal baru: ${formatAppTime(updated.remind_at)}\nJangan ditunda lagi kalau tidak perlu.`);
  }

  return interactionResponse("Unknown reminder action.");
}

async function handleCommand(interaction: any) {
  const commandName = interaction.data?.name;
  const subcommand = interaction.data?.options?.[0];
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";

  if (commandName !== "remind" || !subcommand) {
    return interactionResponse("Use /remind add, list, done, skip, or summary.");
  }

  if (subcommand.name === "test") {
    return interactionResponse("Bot aktif. Sistem reminder siap dipakai.");
  }

  const options = Object.fromEntries(
    (subcommand.options ?? []).map((option: any) => [option.name, option.value])
  );

  if (subcommand.name === "add") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const remindAt = parseAppDateTimeToIso(options.date, options.time);
    if (!remindAt) return interactionResponse("Format tanggal atau jam belum valid. Contoh: date `2026-05-23`, time `21:00`.");

    const { data, error } = await supabase
      .from("reminders")
      .insert({
        discord_user_id: userId,
        discord_channel_id: String(options.channel_id ?? interaction.channel_id),
        task: String(options.task),
        remind_at: remindAt,
        duration_minutes: options.duration ? Number(options.duration) : null,
        strict_mode: options.strict_mode ?? true
      })
      .select("id, task")
      .single();

    if (error) return interactionResponse(`Failed to create reminder: ${error.message}`);

    await supabase.from("reminder_logs").insert({
      reminder_id: data.id,
      action: "created",
      message: "Created from Discord slash command"
    });

    return interactionResponse(`Reminder dibuat.\n\nTask: ${data.task}\nWaktu: ${options.time}\nID: ${data.id}`);
  }

  if (subcommand.name === "list") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const { data, error } = await supabase
      .from("reminders")
      .select("id, task, remind_at, status")
      .eq("discord_user_id", userId)
      .in("status", ["pending", "sent"])
      .order("remind_at", { ascending: true })
      .limit(10);

    if (error) return interactionResponse(`Failed to list reminders: ${error.message}`);
    if (!data?.length) return interactionResponse("Tidak ada reminder pending.");

    const lines = data.map((reminder: any, index: number) => {
      const time = formatAppTime(reminder.remind_at);
      return `${index + 1}. ${reminder.task} - ${time} (${reminder.status}) [${reminder.id}]`;
    });

    return interactionResponse(["Pending reminders:", ...lines].join("\n"));
  }

  if (subcommand.name === "done" || subcommand.name === "skip") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const status = subcommand.name === "done" ? "done" : "skipped";
    await markReminder(String(options.id), status, userId);
    return interactionResponse(status === "done" ? doneMessage() : skippedMessage());
  }

  if (subcommand.name === "snooze") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const minutes = Number(options.minutes);
    if (![10, 30, 60].includes(minutes)) return interactionResponse("Pilihan snooze belum valid.");

    const updated = await updateReminderSchedule({
      id: String(options.id),
      userId,
      remindAt: new Date(Date.now() + minutes * 60_000),
      action: "snoozed",
      message: `Snoozed from Discord command for ${minutes} minutes`
    });

    if (!updated) return interactionResponse(notFoundMessage());
    return interactionResponse(`Reminder ditunda ${minutes} menit.\n\nJadwal baru: ${formatAppTime(updated.remind_at)}\nJangan ditunda lagi kalau tidak perlu.`);
  }

  if (subcommand.name === "reschedule") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const remindAt = parseAppDateTimeToIso(options.date, options.time);
    if (!remindAt) return interactionResponse("Format tanggal atau jam belum valid. Contoh: date `2026-05-24`, time `21:00`.");

    const updated = await updateReminderSchedule({
      id: String(options.id),
      userId,
      remindAt: new Date(remindAt),
      action: "rescheduled",
      message: `Rescheduled from Discord command to ${remindAt}`
    });

    if (!updated) return interactionResponse(notFoundMessage());
    return interactionResponse(`Reminder dijadwalkan ulang.\n\nJadwal baru: ${formatAppTime(updated.remind_at)}\nPastikan ini penyesuaian, bukan pelarian.`);
  }

  if (subcommand.name === "summary") {
    if (!supabase) return interactionResponse("Supabase env belum diset untuk Edge Function.");

    const { start, end } = appDayRange();
    const { data, error } = await supabase
      .from("reminders")
      .select("status")
      .eq("discord_user_id", userId)
      .gte("remind_at", start.toISOString())
      .lt("remind_at", end.toISOString());

    if (error) return interactionResponse(`Failed to load summary: ${error.message}`);

    const done = data.filter((item: any) => item.status === "done").length;
    const skipped = data.filter((item: any) => item.status === "skipped").length;
    const pending = data.filter((item: any) => item.status === "pending" || item.status === "sent").length;
    const completed = done + skipped;
    const completionRate = completed === 0 ? 0 : Math.round((done / completed) * 100);

    return interactionResponse(
      `Daily Discipline Summary\n\nDone: ${done}\nSkipped: ${skipped}\nPending: ${pending}\n\nCompletion rate: ${completionRate}%`
    );
  }

  return interactionResponse("Unknown /remind command.");
}

async function markReminder(id: string, status: "done" | "skipped", userId?: string) {
  if (!supabase) throw new Error("Supabase client is not configured");

  const timestampField = status === "done" ? "completed_at" : "skipped_at";
  const updates = { status, [timestampField]: new Date().toISOString() };

  let query = supabase.from("reminders").update(updates).eq("id", id);
  if (userId) query = query.eq("discord_user_id", userId);

  await query;
  await supabase.from("reminder_logs").insert({
    reminder_id: id,
    action: status === "done" ? "done" : "skipped",
    message: `Marked ${status} from Discord`
  });
}

async function updateReminderSchedule({
  id,
  userId,
  remindAt,
  action,
  message
}: {
  id: string;
  userId?: string;
  remindAt: Date;
  action: "snoozed" | "rescheduled";
  message: string;
}) {
  if (!supabase) throw new Error("Supabase client is not configured");

  let query = supabase
    .from("reminders")
    .update({
      remind_at: remindAt.toISOString(),
      status: "pending",
      sent_at: null
    })
    .eq("id", id)
    .in("status", ["pending", "sent"]);

  if (userId) query = query.eq("discord_user_id", userId);

  const { data, error } = await query.select("id, remind_at, status").single();
  if (error || !data) return null;

  await supabase.from("reminder_logs").insert({
    reminder_id: data.id,
    action,
    message
  });

  return data;
}

function interactionResponse(content: string) {
  return json({
    type: 4,
    data: {
      content,
      flags: 64
    }
  });
}

function notFoundMessage() {
  return "Reminder tidak ditemukan.\n\nKemungkinan sudah selesai, sudah di-skip, bukan milik kamu, atau ID-nya salah.";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function verifyDiscordRequest(request: Request, rawBody: string) {
  if (!discordPublicKey) return false;

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!signature || !timestamp) return false;

  return nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + rawBody),
    hexToUint8Array(signature),
    hexToUint8Array(discordPublicKey)
  );
}

function hexToUint8Array(hex: string) {
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
}
