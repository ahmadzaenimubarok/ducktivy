create extension if not exists pgcrypto;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  discord_channel_id text not null,
  task text not null,
  remind_at timestamptz not null,
  duration_minutes integer null,
  status text not null default 'pending',
  strict_mode boolean not null default true,
  sent_at timestamptz null,
  completed_at timestamptz null,
  skipped_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint reminders_status_check check (
    status in ('pending', 'sent', 'done', 'skipped', 'cancelled')
  )
);

create table if not exists public.reminder_logs (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references public.reminders(id) on delete cascade,
  action text not null,
  message text null,
  created_at timestamptz not null default now(),
  constraint reminder_logs_action_check check (
    action in ('created', 'sent', 'done', 'skipped', 'cancelled', 'failed', 'snoozed', 'rescheduled')
  )
);

create index if not exists reminders_status_remind_at_idx
  on public.reminders(status, remind_at);

create index if not exists reminders_discord_user_id_idx
  on public.reminders(discord_user_id);

alter table public.reminders enable row level security;
alter table public.reminder_logs enable row level security;
