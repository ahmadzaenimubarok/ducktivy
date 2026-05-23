alter table public.reminder_logs
  drop constraint if exists reminder_logs_action_check;

alter table public.reminder_logs
  add constraint reminder_logs_action_check check (
    action in ('created', 'sent', 'done', 'skipped', 'cancelled', 'failed', 'snoozed', 'rescheduled')
  );
