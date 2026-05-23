# Discord Productivity Automation Bot

A Discord-based productivity automation bot that helps users build time discipline by scheduling tasks, sending automated reminders, tracking completion status, and generating daily productivity summaries.

## Features

- Create reminders from a React dashboard or Discord command.
- Store reminders and logs in Supabase.
- Send due reminders with Supabase Edge Functions.
- Mark reminders as done or skipped.
- View pending reminders and a simple daily summary.

## Tech Stack

- React + Vite
- Supabase Database
- Supabase Edge Functions
- Supabase Scheduled Jobs / Cron
- Discord REST API

## Local Command Test

Run the first local smoke test:

```bash
npm run test:commands
```

Run a specific command parser test:

```bash
npm run test:commands -- add --task "Belajar Laravel 30 menit" --time 21:00 --channel 123 --user 456
```

The test command uses an in-memory store. It is meant for early validation before connecting Discord and Supabase.

## Local Dashboard

Run the dashboard API in one terminal:

```bash
npm run dashboard:api
```

Run the React dashboard in another terminal:

```bash
npm run dev
```

Open:

```txt
http://localhost:5173
```

The dashboard API uses `SUPABASE_SERVICE_ROLE_KEY` on the server side. Do not expose that key in React.

## Discord Slash Command Test

Register slash commands:

```bash
npm run discord:register
```

For faster testing, set `DISCORD_GUILD_ID` in `.env` before registering. Guild commands usually appear immediately, while global commands can take time.

After the interaction endpoint is deployed and configured in the Discord Developer Portal, test in Discord:

```txt
/remind test
```

Expected response:

```txt
Bot aktif. Reminder system siap.
```

For local gateway testing before deploying the interaction endpoint, run:

```bash
npm run bot:dev
```

Then test in Discord:

```txt
/remind test
```

Expected local response:

```txt
Bot aktif dari lokal. Reminder system siap.
```

Create a reminder from Discord while the local bot is running:

```txt
/remind add task:"Belajar Laravel 30 menit" date:"2026-05-21" time:"21:00"
```

The local bot stores the reminder in Supabase using `SUPABASE_SERVICE_ROLE_KEY`. Use `VITE_SUPABASE_PUBLISHABLE_KEY` only for the React dashboard.

Run the local reminder worker in a second terminal:

```bash
npm run worker:dev
```

The worker checks due reminders and sends Discord messages automatically. Optional polling interval:

```env
REMINDER_WORKER_POLL_MS=30000
```

If Discord shows `Application did not respond`, check that:

- `discord-interactions` is deployed with `--no-verify-jwt`.
- Supabase Edge Function secrets include `DISCORD_PUBLIC_KEY`.
- Discord Developer Portal uses the deployed function URL as the Interactions Endpoint URL.
- The endpoint URL was saved successfully in Discord Developer Portal.

## Database Setup

Apply the SQL in:

```txt
supabase/migrations/001_initial_schema.sql
```

The migration creates:

- `reminders`
- `reminder_logs`
- indexes for due reminder lookup and user lookup

## Environment Variables

Copy `.env.example` to `.env.local` for the React dashboard.

Supabase now labels the frontend key as a publishable key. Use:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Set these secrets for Supabase Edge Functions:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
```

Never expose `DISCORD_BOT_TOKEN` in React.

## Supabase Edge Functions

Functions included:

- `send-reminders`
- `discord-interactions`

Deploy with the Supabase CLI after the project is linked:

```bash
supabase functions deploy send-reminders
supabase functions deploy discord-interactions --no-verify-jwt
```

Schedule `send-reminders` to run every minute.

## Discord Setup

Create a Discord application and bot, then configure interactions to point to the deployed `discord-interactions` function URL.

Register slash commands for:

- `/remind add`
- `/remind list`
- `/remind done`
- `/remind skip`
- `/remind summary`
- `/remind test`

## MVP Status

This repository currently contains the first implementation scaffold plus a local test command, Discord command registration, and Discord interaction signature verification.
