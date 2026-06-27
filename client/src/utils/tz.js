// Timezone helpers for journey bookings (flights, trains, ships) whose departure
// and arrival happen in different IANA zones. Times are stored as true UTC
// instants; these convert to/from local wall-clock in a specific zone using the
// built-in Intl APIs — no extra dependencies.

// Offset (ms) of `tz` at a given instant: (wall-clock read as UTC) − instant.
function offsetMs(instant, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(instant).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

// Wall-clock (dateStr 'yyyy-MM-dd', timeStr 'HH:mm') in `tz` → UTC Date.
// Falls back to browser-local interpretation when tz is missing.
export function zonedWallclockToUtc(dateStr, timeStr, tz) {
  if (!dateStr) return null;
  const time = timeStr || '00:00';
  if (!tz) return new Date(`${dateStr}T${time}:00`);
  const guess = new Date(`${dateStr}T${time}:00Z`);
  // Two passes converge across DST boundaries.
  let utc = new Date(guess.getTime() - offsetMs(guess, tz));
  utc = new Date(guess.getTime() - offsetMs(utc, tz));
  return utc;
}

// UTC instant → wall-clock parts in `tz` (or browser-local when tz missing).
// Returns { dateStr: 'yyyy-MM-dd', timeStr: 'HH:mm', minutes }.
export function zonedParts(instant, tz) {
  const d = new Date(instant);
  if (!tz) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
      dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      minutes: d.getHours() * 60 + d.getMinutes(),
    };
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = dtf.formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return {
    dateStr: `${p.year}-${p.month}-${p.day}`,
    timeStr: `${p.hour}:${p.minute}`,
    minutes: +p.hour * 60 + +p.minute,
  };
}

// "6:00 PM EDT" style label for an instant in tz (or browser-local, no abbrev).
export function zonedTimeLabel(instant, tz) {
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (tz) { opts.timeZone = tz; opts.timeZoneName = 'short'; }
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(instant));
}
