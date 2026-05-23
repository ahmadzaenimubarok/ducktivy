const DEFAULT_TIME_ZONE = "Asia/Jakarta";
const DEFAULT_TIME_ZONE_OFFSET_MINUTES = 420;

export function appTimeZone() {
  return getEnv("APP_TIME_ZONE") || DEFAULT_TIME_ZONE;
}

export function appTimeZoneOffsetMinutes() {
  const raw = getEnv("APP_TIME_ZONE_OFFSET_MINUTES");
  if (!raw) return DEFAULT_TIME_ZONE_OFFSET_MINUTES;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_TIME_ZONE_OFFSET_MINUTES;
}

export function parseAppDateTimeToIso(date, time) {
  const parsed = parseAppDateTime(date, time);
  return parsed ? parsed.toISOString() : null;
}

export function parseAppDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(time))) return null;

  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);

  if (hour > 23 || minute > 59) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - appTimeZoneOffsetMinutes() * 60_000;
  const parsed = new Date(utcMs);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function appDayRange(date = new Date()) {
  const offsetMs = appTimeZoneOffsetMinutes() * 60_000;
  const appDate = new Date(date.getTime() + offsetMs);
  const startUtcMs =
    Date.UTC(appDate.getUTCFullYear(), appDate.getUTCMonth(), appDate.getUTCDate()) - offsetMs;
  const endUtcMs = startUtcMs + 24 * 60 * 60_000;

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs)
  };
}

export function formatAppDateTime(value, locale = "id-ID") {
  return new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: appTimeZone()
  });
}

export function formatAppTime(value, locale = "en-GB") {
  return new Date(value).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appTimeZone()
  });
}

function getEnv(key) {
  if (typeof Deno !== "undefined") return Deno.env.get(key);
  return globalThis.process?.env?.[key];
}
