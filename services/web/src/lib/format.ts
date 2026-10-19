import { DateTime } from "effect";

const dateFormat = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `Oct 19, 2026` */
export const formatDate = (date: DateTime.DateTime): string =>
  dateFormat.format(DateTime.toDate(date));

/** `Oct 19, 2026, 14:05` */
export const formatDateTime = (date: DateTime.DateTime): string =>
  dateTimeFormat.format(DateTime.toDate(date));

/** `2026-10-19`, for `<time dateTime>`. */
export const isoDate = (date: DateTime.DateTime): string =>
  DateTime.formatIso(date).slice(0, 10);

const units = ["B", "KiB", "MiB", "GiB", "TiB"];

/** `1.5 MiB` */
export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

/** `1,234` */
export const formatNumber = (value: number): string =>
  value.toLocaleString("en");
