// Minimal iCalendar (RFC 5545) generation for event invitations. One event per
// file, built from an EventInvitation's plaintext snapshot, attached to the
// invite email so any recipient can import it into Apple/Google/Outlook — no
// account needed.

// Escape TEXT values: backslash, semicolon, comma, newline.
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const pad = (n) => String(n).padStart(2, '0');

// UTC timestamp: 20260708T143000Z
function utcStamp(d) {
  const t = new Date(d);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

// Date-only value: 20260708. All-day records are stored at noon UTC, so the
// UTC calendar date is the intended date.
function dateStamp(d) {
  const t = new Date(d);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

// Fold long content lines at 75 octets (approximated as chars) per RFC 5545 §3.1.
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

// Build a single-VEVENT calendar from an invitation's event snapshot.
function buildEventICS({ uid, event }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Household Calendar//Event Invitation//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@household-calendar.app`,
    `DTSTAMP:${utcStamp(new Date())}`,
  ];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.startDate)}`);
    // DTEND is exclusive for all-day events: the day after the last day.
    const last = new Date(event.endDate || event.startDate);
    last.setUTCDate(last.getUTCDate() + 1);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(last)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(event.startDate)}`);
    if (event.endDate) lines.push(`DTEND:${utcStamp(event.endDate)}`);
  }

  lines.push(`SUMMARY:${esc(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`);
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`);
  if (event.url) lines.push(`URL:${esc(event.url)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildEventICS };
