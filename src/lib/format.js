export const formatInTz = (date, tz, withTime = true) =>
  new Intl.DateTimeFormat(
    undefined,
    withTime
      ? { timeZone: tz, dateStyle: "medium", timeStyle: "short" }
      : { timeZone: tz, dateStyle: "medium" }
  ).format(date);

const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

// For day/month granularity we compare calendar units (in local TZ),
// not seconds — otherwise "May 23rd" parsed at noon vs hovered at 12:48
// PM reads as "48 minutes ago" instead of "today".
export const relative = (date, gran = "time", now = new Date()) => {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (gran === "day" || gran === "month") {
    const months =
      (date.getFullYear() - now.getFullYear()) * 12 +
      (date.getMonth() - now.getMonth());

    if (gran === "day") {
      const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const days = Math.round((a - b) / 86400000);
      const abs = Math.abs(days);
      if (abs < 7) return rtf.format(days, "day");
      if (abs < 28) return rtf.format(Math.round(days / 7), "week");
    }

    if (Math.abs(months) < 12) return rtf.format(months, "month");
    return rtf.format(Math.round(months / 12), "year");
  }

  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diffSec) >= secs || unit === "second") {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return "";
};

export const shortTzLabel = (tz) => {
  const parts = tz.split("/");
  return parts[parts.length - 1].replace(/_/g, " ");
};
