// Codex and Pi sessions, read from the agents' own logs on the machine they run on:
//   Codex: ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl (token_count and turn_context events)
//   Pi:    ~/.pi/agent/sessions/--<cwd>--/<start>_<id>.jsonl (each reply's usage and cost)
// Neither log says which terminal wrote it, so a terminal gets the session that started in
// its folder after it did (and before the next terminal of the same agent in that folder).
// Everything is read with `sh` on the agent's machine, so only the summary crosses over.
import { exec, hc } from "herdr";

export const kindOf = (x) => {
  const k = x?.app ?? x?.agent ?? x?.report?.app ?? x?.status?.app ?? x?.program?.key ?? null;
  if (k === "claude-code" || k === "claude") return "claude";
  if (k === "codex") return "codex";
  if (k === "pi") return "pi";
  return null;
};
export const machineOf = (addr) => (typeof addr === "string" && addr.includes("/") ? addr.split("/")[0] : null);

const SLACK = 20000; // ms: an agent's log may start a little after its terminal (nix develop, npx)
const RESOLVE_MS = 30000; // ms: look for a newer session (/new) at most this often

const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on, timeout: 15000 });
const iso = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Each line: path, modified (epoch seconds), then the session's first bytes (Codex) or
// its file name (Pi, whose name starts with the session's start).
const MTIME = `m=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)`;
const LIST = {
  codex: `ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -40 | while IFS= read -r f; do ${MTIME}; printf '%s\\t%s\\t' "$f" "$m"; head -c 900 "$f" | tr -d '\\n\\r\\t'; echo; done`,
  pi: `d="$HOME/.pi/agent/sessions/$1"; ls -t "$d" 2>/dev/null | grep '\\.jsonl$' | head -30 | while IFS= read -r n; do f="$d/$n"; ${MTIME}; printf '%s\\t%s\\t%s\\n' "$f" "$m" "$n"; done`,
};
const piDir = (cwd) => `--${String(cwd ?? "").replace(/^[\\/]+/, "").replace(/[\\/:]/g, "-")}--`;

// [{file, start, mtime, cwd}] newest-modified first; times in ms.
async function list(kind, cwd, on) {
  const r = await sh(LIST[kind], kind === "pi" ? [piDir(cwd)] : [], on);
  return String(r.stdout ?? "").split("\n").filter(Boolean).map((line) => {
    const [file, m, rest = ""] = line.split("\t");
    const mtime = Number(m) ? Number(m) * 1000 : null;
    if (kind === "pi") {
      const x = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(rest);
      return { file, mtime, start: x ? iso(`${x[1]}T${x[2]}:${x[3]}:${x[4]}.${x[5]}Z`) : null, cwd };
    }
    const stamps = [...rest.matchAll(/"timestamp":"([^"]+)"/g)].map((x) => x[1]);
    const c = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1]?.replace(/\\\\/g, "\\");
    return { file, mtime, start: iso(stamps[1] ?? stamps[0]), cwd: c ?? null };
  });
}

// The terminal's session among those that started in its window (oldest first): the
// first one, until it was left (last written before a later one started: `/new`).
// Sessions that started while it was still being written are someone else's, such as
// the sub-agents an agent runs in-process (Pi's pi-subagents) in the same folder.
function follow(inside) {
  let cur = inside[0] ?? null;
  for (const c of inside.slice(1)) if (cur?.mtime && c.start > cur.mtime) cur = c;
  return cur;
}

const SUMMARY = {
  codex: `f="$1"
printf '%s\\n' "$(head -c 900 "$f" | tr -d '\\n\\r')"
printf '%s\\n' "$(grep -F '"total_token_usage"' "$f" | tail -1)"
printf '%s\\n' "$(grep -F '"turn_context"' "$f" | tail -1 | grep -o '"model":"[^"]*"\\|"effort":"[^"]*"' | tr '\\n' ' ')"
printf '%s\\n' "$(tail -c 4000 "$f" | grep -o '"timestamp":"[^"]*"' | tail -1)"`,
  pi: `f="$1"
printf '%s\\n' "$(head -1 "$f" | head -c 600)"
printf '%s\\n' "$(grep -o '"provider":"[^"]*","model":"[^"]*"' "$f" | tail -1)"
printf '%s\\n' "$(grep -o '"thinkingLevel":"[^"]*"' "$f" | tail -1)"
printf '%s\\n' "$(tail -c 4000 "$f" | grep -o '"timestamp":"[^"]*"' | tail -1)"
grep -o '"usage":{[^{}]*"cost":{[^{}]*}[^{}]*}' "$f"`,
};
// Every model's id, name and context window, in file order (one token per line).
const MODELS = `grep -ho '"id": *"[^"]*"\\|"name": *"[^"]*"\\|"contextWindow": *[0-9]*' "$HOME/.pi/agent/models.json" "$HOME/.pi/agent/models-store.json" 2>/dev/null`;

function codexSummary(lines) {
  const [meta, tok, ctx, last] = lines;
  let info = null;
  try { info = JSON.parse(tok).payload?.info ?? null; } catch {}
  const stamps = [...(meta ?? "").matchAll(/"timestamp":"([^"]+)"/g)].map((x) => x[1]);
  const t = info?.total_token_usage ?? {}, l = info?.last_token_usage ?? {};
  return {
    model: /"model":"([^"]*)"/.exec(ctx ?? "")?.[1] ?? null,
    effort: /"effort":"([^"]*)"/.exec(ctx ?? "")?.[1] ?? null,
    ctx: { used: info ? num(l.total_tokens) : null, size: info?.model_context_window ?? null },
    cost: null,
    tokens: { input: num(t.input_tokens), cached: num(t.cached_input_tokens), output: num(t.output_tokens), total: num(t.total_tokens) },
    started: iso(stamps[1] ?? stamps[0]),
    last: iso(/"timestamp":"([^"]*)"/.exec(last ?? "")?.[1]),
  };
}

function piSummary(lines) {
  const [head, model, thinking, last, ...usage] = lines;
  const tokens = { input: 0, cached: 0, output: 0, total: 0 };
  let cost = 0, lastUse = null;
  for (const line of usage) {
    let u;
    try { u = JSON.parse(line.slice(line.indexOf(":") + 1)); } catch { continue; }
    tokens.input += num(u.input) + num(u.cacheRead) + num(u.cacheWrite);
    tokens.cached += num(u.cacheRead);
    tokens.output += num(u.output);
    cost += num(u.cost?.total);
    lastUse = u;
  }
  tokens.total = tokens.input + tokens.output;
  const m = /"provider":"([^"]*)","model":"([^"]*)"/.exec(model ?? "");
  return {
    provider: m?.[1] ?? null,
    model: m?.[2] ?? null,
    effort: /"thinkingLevel":"([^"]*)"/.exec(thinking ?? "")?.[1] ?? null,
    ctx: { used: lastUse ? num(lastUse.input) + num(lastUse.cacheRead) + num(lastUse.cacheWrite) + num(lastUse.output) : null, size: null },
    cost: usage.length ? cost : null,
    tokens,
    started: iso(/"timestamp":"([^"]*)"/.exec(head ?? "")?.[1]),
    last: iso(/"timestamp":"([^"]*)"/.exec(last ?? "")?.[1]),
  };
}

export class AgentLogs {
  constructor() {
    this.created = new Map(); // address -> ms
    this.files = new Map(); // address -> { file, at }
    this.models = new Map(); // "machine|model" -> { size, name }
  }

  async createdAt(addr) {
    if (this.created.has(addr)) return this.created.get(addr);
    const r = await hc(["get", addr, "--json"]);
    const ms = JSON.parse(r.stdout || "{}").created_ms ?? null;
    if (ms) this.created.set(addr, ms);
    return ms;
  }

  // `t`: the terminal; `peers`: every live terminal of the same agent, for the claims.
  async resolve(t, kind, peers) {
    const on = machineOf(t.address), kept = this.files.get(t.address);
    if (kept && Date.now() - kept.at < RESOLVE_MS) return kept.file;
    const mine = await this.createdAt(t.address);
    const same = [];
    for (const p of peers) {
      if (machineOf(p.address) !== on || p.cwd !== t.cwd) continue;
      same.push({ address: p.address, created: p.address === t.address ? mine : await this.createdAt(p.address).catch(() => null) });
    }
    same.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    const next = same.find((p) => (p.created ?? 0) > (mine ?? 0))?.created ?? Infinity;
    const found = (await list(kind, t.cwd, on)).filter((c) => c.cwd === t.cwd);
    const inside = mine ? found.filter((c) => c.start !== null && c.start >= mine - SLACK && c.start < next - SLACK) : [];
    inside.sort((a, b) => a.start - b.start);
    // A resumed session started before the terminal: alone in the folder, the newest log is it.
    const file = follow(inside)?.file ?? (same.length <= 1 ? found[0]?.file : null) ?? null;
    this.files.set(t.address, { file, at: Date.now() });
    return file;
  }

  async modelInfo(model, on) {
    const key = `${on ?? ""}|${model}`;
    if (this.models.has(key)) return this.models.get(key);
    const r = await sh(MODELS, [], on).catch(() => null);
    const info = { size: null, name: null };
    let mine = false;
    for (const line of String(r?.stdout ?? "").split(/\r?\n/)) {
      const id = /^"id": *"(.*)"$/.exec(line)?.[1];
      if (id !== undefined) { if (mine) break; mine = id === model; continue; }
      if (!mine) continue;
      info.name ??= /^"name": *"(.*)"$/.exec(line)?.[1] ?? null;
      const cw = /^"contextWindow": *(\d+)$/.exec(line)?.[1];
      if (cw && !info.size) info.size = Number(cw);
    }
    this.models.set(key, info);
    return info;
  }


  // The session's summary, or null when no log matches.
  async read(t, kind, peers) {
    const file = await this.resolve(t, kind, peers);
    if (!file) return null;
    const on = machineOf(t.address);
    const r = await sh(SUMMARY[kind], [file], on);
    const lines = String(r.stdout ?? "").split("\n");
    const s = kind === "codex" ? codexSummary(lines) : piSummary(lines);
    if (kind === "pi" && s.model) {
      const m = await this.modelInfo(s.model, on);
      s.ctx.size = m.size;
      s.modelName = m.name;
    }
    return { ...s, file };
  }
}
