import { isValidTimeZone } from "@/lib/time-zone";

export function getLocalDateTimeParts(value: Date, timeZone: string) {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;

  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error(`Unable to format local time for timezone: ${timeZone}`);
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
  };
}

export function isLocalTimePastSendTime(now: Date, timeZone: string, sendTime: string) {
  return getLocalDateTimeParts(now, timeZone).time >= sendTime;
}
