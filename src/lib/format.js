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

export const relative = (date, now = new Date()) => {
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
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
