// Timezone helpers ported verbatim from client/src/utils/tz.js. Times are stored
// as true UTC instants; these convert to/from local wall-clock in a specific IANA
// zone using built-in Intl APIs (Hermes supports Intl with timeZone). When tz is
// empty they fall back to device-local interpretation.

// Offset (ms) of `tz` at a given instant: (wall-clock read as UTC) − instant.
function offsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = dtf.formatToParts(instant).reduce((a: Record<string, string>, x) => {
    a[x.type] = x.value;
    return a;
  }, {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

// Wall-clock (dateStr 'yyyy-MM-dd', timeStr 'HH:mm') in `tz` → UTC Date.
export function zonedWallclockToUtc(dateStr: string, timeStr: string, tz?: string): Date | null {
  if (!dateStr) return null;
  const time = timeStr || '00:00';
  if (!tz) return new Date(`${dateStr}T${time}:00`);
  const guess = new Date(`${dateStr}T${time}:00Z`);
  let utc = new Date(guess.getTime() - offsetMs(guess, tz));
  utc = new Date(guess.getTime() - offsetMs(utc, tz));
  return utc;
}

export interface ZonedParts {
  dateStr: string;
  timeStr: string;
  minutes: number;
}

// UTC instant → wall-clock parts in `tz` (or device-local when tz missing).
export function zonedParts(instant: string | number | Date, tz?: string): ZonedParts {
  const d = new Date(instant);
  if (!tz) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      minutes: d.getHours() * 60 + d.getMinutes(),
    };
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = dtf.formatToParts(d).reduce((a: Record<string, string>, x) => {
    a[x.type] = x.value;
    return a;
  }, {});
  return {
    dateStr: `${p.year}-${p.month}-${p.day}`,
    timeStr: `${p.hour}:${p.minute}`,
    minutes: +p.hour * 60 + +p.minute,
  };
}

// "6:00 PM EDT" style label for an instant in tz (or device-local, no abbrev).
export function zonedTimeLabel(instant: string | number | Date, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (tz) {
    opts.timeZone = tz;
    opts.timeZoneName = 'short';
  }
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(instant));
}
