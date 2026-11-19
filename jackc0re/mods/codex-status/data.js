// Pure helpers for the Codex subscription limits, read from Codex's own session
// rollouts. No Herdr imports, so this file can be loaded with plain Node.

// Codex reports two rolling windows in every token_count event: `primary` (5h)
// and `secondary` (7d), each with `used_percent` and `resets_at`.
export const WINDOWS = [
  { key: "primary", label: "5h", name: "5-hour limit", seconds: 5 * 3600 },
  { key: "secondary", label: "7d", name: "Weekly limit", seconds: 7 * 86400 },
];
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n) => String(n).padStart(2, "0");
export const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A duration for people: 7m, 2h 05m, 3d 4h.
export function span(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

// One window at `now` (epoch seconds), or null when the report has none.
// `passed`: the part of the window behind us; `pace`: the percentage at the
// reset if the use goes on at the same rate.
export function windowState(w, limits, now) {
  const l = limits?.[w.key];
  if (typeof l?.used_percent !== "number" || typeof l?.resets_at !== "number") return null;
  const left = l.resets_at - now;
  if (left <= 0) return { ...w, reset: true, used: 0, left: 0, passed: null, pace: null };
  const passed = w.seconds ? Math.min(1, Math.max(0, 1 - left / w.seconds)) : null;
  // Too early in a window to project from: the first 5% would swing wildly.
  const pace = passed !== null && passed >= 0.05 ? l.used_percent / passed : null;
  return { ...w, reset: false, used: l.used_percent, left, at: l.resets_at, passed, pace };
}

// The last token_count event of a rollout, as { at, limits, plan }, or null.
// `line` is the raw JSON line the scanner printed.
export function readReport(line) {
  if (!line) return null;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  const limits = ev?.payload?.rate_limits;
  if (!limits || typeof limits !== "object") return null;
  const at = Date.parse(ev.timestamp) / 1000;
  return { at: Number.isFinite(at) ? at : null, limits, plan: limits.plan_type ?? null };
}

// The newest usable report among the lines a scan printed. Only the account-wide
// `codex` limit counts (other limit_ids are per-model buckets).
export function readReports(text) {
  const lines = String(text).split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = readReport(lines[i]);
    const id = r?.limits?.limit_id;
    if (r && (id == null || id === "codex")) return r;
  }
  return null;
}
