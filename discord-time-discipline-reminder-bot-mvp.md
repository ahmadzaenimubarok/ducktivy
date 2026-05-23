# MVP Project Specification: Discord Time Discipline Reminder Bot

## 1. Project Overview

Build a Discord-based reminder automation system to help users practice time discipline.

The system allows users to create scheduled reminders, receive automated messages in Discord, and mark each reminder as done or skipped. The bot tracks reminder history and provides a simple daily summary.

This project is intended as a portfolio project for backend automation, Discord integration, and Supabase-based persistence.

---

## 2. Important Stack Decision

The user wants to keep the stack as simple as possible and mainly use React.

However, React alone cannot handle Discord automation because React runs in the browser and cannot safely store bot tokens, run scheduled jobs, or send automated Discord messages in the background.

Therefore, the MVP stack will be:

- React
- Supabase Database
- Supabase Edge Functions
- Supabase Scheduled Jobs / Cron
- Discord REST API
- Discord Slash Commands or simple command endpoint

No separate Express.js backend is required for the MVP.

---

## 3. MVP Goal

Create a working Discord reminder automation system with the following flow:

```txt
User creates reminder
→ Reminder is stored in Supabase
→ Scheduled worker checks due reminders
→ Bot sends reminder message to Discord
→ User marks reminder as done or skipped
→ System stores the result
→ User can view reminder history
```

The MVP must prioritize reliability over excessive features.

---

## 4. Core Features

### 4.1 Create Reminder

User can create a reminder with:

- Task title
- Reminder date and time
- Discord channel ID
- Optional duration in minutes
- Optional strict message mode

Example:

```txt
/remind 21:00 "Belajar Laravel 30 menit"
```

Expected bot response:

```txt
Reminder created:
Belajar Laravel 30 menit
Time: 21:00
```

---

### 4.2 Send Scheduled Reminder

When the reminder time arrives, the system sends a Discord message automatically.

Example message:

```txt
⏰ Waktunya mulai: Belajar Laravel 30 menit.

Aturannya:
1. Mulai sekarang.
2. Jangan buka hal lain.
3. Kalau malas, tetap mulai 5 menit.

Klik Done kalau selesai, atau Skip kalau kamu benar-benar tidak mengerjakannya.
```

The message should include two action buttons if possible:

- Done
- Skip

If buttons are too much for the first version, slash commands are acceptable:

```txt
/reminder done <id>
/reminder skip <id>
```

---

### 4.3 Mark Reminder as Done

User can mark a reminder as done.

Expected response:

```txt
✅ Selesai dicatat.

Bagus. Kamu nurut sama jadwalmu sendiri.
```

---

### 4.4 Mark Reminder as Skipped

User can mark a reminder as skipped.

Expected response:

```txt
⚠️ Skip dicatat.

Jangan biasakan negosiasi dengan jadwal sendiri.
```

---

### 4.5 List Reminders

User can list active reminders.

Example:

```txt
/reminder list
```

Expected output:

```txt
Pending reminders:
1. Belajar Laravel - 21:00
2. Review portfolio - 22:00
```

---

### 4.6 Daily Summary

System can generate a simple daily summary.

Example:

```txt
📊 Daily Discipline Summary

Done: 3
Skipped: 1
Pending: 0

Completion rate: 75%
```

This can be triggered manually first:

```txt
/reminder summary
```

Automatic daily summary is optional for MVP v1.

---

## 5. Non-MVP Features

Do not build these in the first version:

- AI-generated coaching
- Complex recurring reminders
- Payment system
- Multi-server analytics dashboard
- Team management
- OAuth login
- Mobile app
- Habit streak system
- Calendar integration

These can be added later.

---

## 6. Suggested Architecture

```txt
React App
  ↓
Supabase Database
  ↓
Supabase Edge Functions
  ↓
Discord REST API
  ↓
Discord Channel
```

### Explanation

React is used for:

- Simple dashboard
- Creating reminders manually
- Viewing reminder history
- Viewing reminder status

Supabase is used for:

- Database
- Scheduled reminder checking
- Edge functions for Discord message sending
- Secure environment variables

Discord is used for:

- Receiving reminders
- Slash command interaction
- Done / Skip responses

---

## 7. Database Schema

### Table: reminders

```sql
create table reminders (
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
  created_at timestamptz not null default now()
);
```

Allowed status values:

```txt
pending
sent
done
skipped
cancelled
```

---

### Table: reminder_logs

```sql
create table reminder_logs (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references reminders(id) on delete cascade,
  action text not null,
  message text null,
  created_at timestamptz not null default now()
);
```

Allowed action values:

```txt
created
sent
done
skipped
cancelled
failed
```

---

## 8. Supabase Environment Variables

Set these in Supabase Edge Functions:

```env
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Never expose the Discord bot token in React.

---

## 9. Supabase Edge Functions

### 9.1 send-reminders

Purpose:

- Runs every minute using Supabase scheduled jobs
- Finds reminders where:
  - status = pending
  - remind_at <= now()
- Sends message to Discord channel
- Updates reminder status to sent
- Creates reminder log

Pseudo flow:

```txt
fetch due reminders
for each reminder:
  send Discord message
  if success:
    update status to sent
    set sent_at
    insert log sent
  if failed:
    insert log failed
```

---

### 9.2 discord-interactions

Purpose:

- Handles Discord slash commands and button interactions
- Creates reminder
- Marks reminder as done
- Marks reminder as skipped
- Lists reminders
- Shows summary

Commands:

```txt
/remind add
/remind list
/remind done
/remind skip
/remind summary
```

---

## 10. React Dashboard Pages

Keep the dashboard simple.

### 10.1 Dashboard

Show:

- Total reminders today
- Done count
- Skipped count
- Pending count
- Completion rate

---

### 10.2 Reminder List

Show reminders with:

- Task
- Reminder time
- Status
- Created date

Filters:

- Today
- Pending
- Done
- Skipped

---

### 10.3 Create Reminder Form

Fields:

- Task
- Reminder date
- Reminder time
- Discord channel ID
- Duration in minutes
- Strict mode checkbox

---

## 11. Reminder Message Tone

The bot should be firm but not abusive.

Good tone:

```txt
⏰ Waktunya mulai: {{task}}

Jangan negosiasi dengan jadwal sendiri.
Mulai 5 menit pertama dulu.
```

Done response:

```txt
✅ Selesai dicatat.

Bagus. Kamu menyelesaikan apa yang sudah kamu jadwalkan.
```

Skip response:

```txt
⚠️ Skip dicatat.

Kalau ini karena alasan valid, tidak masalah.
Kalau cuma malas, jangan dibiasakan.
```

Avoid extreme insults, harassment, or personal attacks.

---

## 12. MVP Development Steps

### Step 1: Setup Project

- Create React project
- Connect to Supabase
- Create database tables
- Configure environment variables

---

### Step 2: Build Supabase Tables

- Create `reminders`
- Create `reminder_logs`
- Add basic indexes

Recommended indexes:

```sql
create index reminders_status_remind_at_idx
on reminders(status, remind_at);

create index reminders_discord_user_id_idx
on reminders(discord_user_id);
```

---

### Step 3: Build Reminder Sender Function

Create Supabase Edge Function:

```txt
send-reminders
```

Responsibilities:

- Query due reminders
- Send message to Discord REST API
- Update reminder status
- Insert logs

---

### Step 4: Setup Scheduler

Run `send-reminders` every minute.

Expected behavior:

```txt
Every 1 minute:
  check pending reminders
  send due reminders
```

---

### Step 5: Build Discord Commands

Implement commands:

```txt
/remind add
/remind list
/remind done
/remind skip
/remind summary
```

For MVP, command parsing can be simple.

---

### Step 6: Build React Dashboard

Pages:

- Dashboard
- Reminder List
- Create Reminder

Use a simple UI. Do not over-design.

---

### Step 7: Test End-to-End

Test cases:

- Create reminder from dashboard
- Create reminder from Discord command
- Reminder is sent at correct time
- Done status works
- Skip status works
- Daily summary returns correct numbers
- Bot does not resend the same reminder twice
- Reminder still works after function rerun

---

## 13. Definition of Done

The MVP is considered done when:

- User can create a reminder
- Reminder is stored in Supabase
- Scheduled function sends the reminder to Discord
- Reminder is not sent twice
- User can mark reminder as done
- User can mark reminder as skipped
- User can view list of reminders
- User can view basic summary
- Bot token is not exposed in frontend
- README explains setup clearly

---

## 14. README Requirements

The final project must include a README with:

- Project description
- Feature list
- Tech stack
- Database setup
- Environment variable setup
- Supabase Edge Function deployment
- Discord bot setup
- How to test reminder
- Screenshots or demo GIF placeholder

---

## 15. Portfolio Positioning

Use this title:

```txt
Discord Productivity Automation Bot
```

Short portfolio description:

```txt
A Discord-based productivity automation bot that helps users build time discipline by scheduling tasks, sending automated reminders, tracking completion status, and generating daily productivity summaries.
```

Key portfolio points:

- Discord bot integration
- Supabase database persistence
- Serverless scheduled automation
- Reminder status tracking
- Productivity summary
- Secure token handling

---

## 16. Important Constraints for Codex Agent

Follow these constraints strictly:

- Do not build unnecessary features.
- Do not use local memory for reminders.
- Do not expose Discord bot token in React.
- Do not create a separate Express backend unless absolutely required.
- Use Supabase for persistence.
- Use Supabase Edge Functions for automation.
- Keep the React UI simple.
- Prioritize working end-to-end flow over visual polish.
- Make the project easy to deploy and explain as portfolio.
