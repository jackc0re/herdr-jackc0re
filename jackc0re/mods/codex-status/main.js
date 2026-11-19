// Codex subscription limits for the sidebar: the 5-hour and 7-day windows,
// drawn like the Claude panel beside it. Codex writes these numbers into its own
// session rollouts (~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl, one
// token_count event per response), so a scan of the newest one is the whole job.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, layout, home, watchFolder, machines } from "herdr";
import { WINDOWS, DAYS, clock, span, windowState, readReports } from "./data.js";

const MONO = "JetBrains Mono"; // jackc0re: section labels match the critters sidebar
const POLL = 45000; // ms; one scan at rest (starting PowerShell is most of it)
const FLOOR = 20000; // ms; least time between scans while Codex is writing

const windows = () => home().includes("\\");
const DIR = () => home() + (windows() ? "\\.codex\\sessions" : "/.codex/sessions");

// The last rate_limits lines of the newest rollout, printed to stdout. Codex may
// run here or on another machine (WSL, ssh), each with its own ~/.codex: the
// local scan uses this computer's shell, a remote one runs `sh` there.
function localCommand() {
  if (windows()) {
    return (
      `$d = '${DIR()}'; ` +
      "$f = Get-ChildItem -LiteralPath $d -Recurse -Filter rollout-*.jsonl -ErrorAction SilentlyContinue | " +
      "Sort-Object LastWriteTime -Descending | Select-Object -First 1; " +
      "if ($f) { Get-Content -LiteralPath $f.FullName -Tail 400 | " +
      "Where-Object { $_ -like '*rate_limits*' } | Select-Object -Last 20 }"
    );
  }
  return shCommand(`'${DIR()}'`);
}
const shCommand = (dir) =>
  `f=$(ls -t ${dir}/*/*/*/rollout-*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -n 400 "$f" | grep -F rate_limits | tail -20`;

async function scanMachine(machine) {
  const r = machine
    ? await exec("sh", ["-c", shCommand('"$HOME/.codex/sessions"')], { on: machine, timeout: 30000 })
    : windows()
      ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", localCommand()], { timeout: 30000 })
      : await exec("sh", ["-c", localCommand()], { timeout: 30000 });
  const report = readReports(r.stdout ?? "");
  return report ? { ...report, machine } : null;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class CodexLimits extends View {
  init(_props, cx) {
    this.data = undefined; // undefined: nothing read yet, null: no report found
    this.error = null;
    this.busy = false;
    this.started = 0;
    this.scan(cx);
    cx.timer.every(POLL, (cx) => this.scan(cx));
    this.watch(cx);
  }

  // Codex appends while it runs: scan when its sessions change, and no faster
  // than FLOOR. The timer above covers a watch that never resolves.
  watch(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(DIR());
        } catch {
          return; // no folder (no Codex): the timer still scans
        }
        if (Date.now() - this.started >= FLOOR) this.scan(cx);
      }
    });
  }

  scan(cx) {
    if (this.busy) return;
    this.busy = true;
    this.started = Date.now();
    cx.spawn(async (cx) => {
      try {
        // Every machine with a Codex: the newest report wins, wherever it is.
        const names = [null, ...machines().map((m) => m.name).filter((n) => n && n !== null)];
        const found = await Promise.all(names.map((m) => scanMachine(m).catch(() => null)));
        const reports = found.filter(Boolean);
        this.data = reports.length ? reports.reduce((a, b) => ((b.at ?? 0) > (a.at ?? 0) ? b : a)) : null;
        this.error = null;
      } catch (e) {
        this.error = `Cannot read Codex usage: ${e}`;
      } finally {
        // Always redraw: the age label ("6m ago") is part of what a scan updates.
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const now = Date.now() / 1000;
    const limits = this.data?.limits;
    const shown = WINDOWS.map((w) => windowState(w, limits, now)).filter(Boolean);
    const tone = (s) => (s.used >= 90 || s.pace >= 100 ? t.ansi1 : s.used >= 70 || s.pace >= 85 ? t.ansi3 : t.accent);

    const root = v_flex().id("codex-limits").size_full().bg(t.chrome).text_size(12);

    if (narrow()) {
      return root.items_center().justify_center().gap(6).children(
        shown.filter((s) => s.seconds).map((s) =>
          v_flex().items_center().child(div().text_size(9).text_color(t.dim).child(s.label))
            .child(div().text_size(11).text_color(s.reset ? t.dim : tone(s)).child(`${Math.round(s.used)}%`))));
    }

    const tip = (s) => {
      if (s.reset) return `${s.name}: the window has reset. New numbers come with the next Codex response.`;
      const lines = [`${s.name}: ${s.used.toFixed(0)}% used`];
      const d = new Date(s.at * 1000);
      lines.push(`Resets ${s.left > 86400 ? `${DAYS[d.getDay()]} ` : ""}${clock(d)} (in ${span(s.left)})`);
      if (s.pace !== null) lines.push(`At this pace: ${Math.round(s.pace)}% by the reset`);
      return lines.join("\n");
    };
    const resetText = (s) => {
      if (s.reset) return "reset";
      if (s.left > 86400) {
        const d = new Date(s.at * 1000);
        return `${DAYS[d.getDay()]} ${clock(d)}`;
      }
      return span(s.left);
    };
    const bar = (s) =>
      div().flex_1().h(6).rounded(3).bg(t.border).relative()
        .child(div().h_full().w(`${Math.min(100, s.used)}%`).rounded(3).bg(s.reset ? t.dim : tone(s)))
        .when(s.passed !== null, (el) => el.child(
          div().absolute().top(-3).h(12).w(2).rounded(1).bg(t.foreground).opacity(0.55).left(`${s.passed * 100}%`)));
    const row = (s) =>
      h_flex().id(`cx-${s.key}`).h(20).gap(8).items_center().tooltip(tip(s))
        .child(div().w(30).flex_none().font_family(MONO).text_size(10).font_bold().text_color(t.dim).child(s.label.toUpperCase()))
        .child(bar(s))
        .child(div().w(32).flex_none().text_right().font_family(MONO).text_size(10.5)
          .text_color(s.reset ? t.dim : tone(s) === t.accent ? t.foreground : tone(s))
          .child(`${Math.round(s.used)}%`))
        .child(div().w(62).flex_none().text_right().font_family(MONO).text_size(10).text_color(t.dim).truncate().child(resetText(s)));

    const age = !this.data?.at ? null : now - this.data.at < 60 ? "now" : `${span(now - this.data.at)} ago`;
    const header = h_flex().px(16).h(30).pt(8).flex_none().items_center().justify_between()
      .child(div().font_family(MONO).text_size(11).font_bold().text_color(t.dim).child("CODEX"))
      .when(Boolean(age), (el) => el.child(div().id("cx-age").font_family(MONO).text_size(10).text_color(t.dim).child(age)
        .tooltip(`When Codex last reported these limits, in its newest session on ${this.data?.machine ?? "this computer"}`)));

    const note = (text, color = t.dim) => div().text_size(11).text_color(color).child(text);
    return root.child(header).child(
      v_flex().px(16).pb(6).gap(1)
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.ansi1)))
        .when(this.data === undefined, (el) => el.child(note("Reading Codex usage…")))
        .when(this.data === null, (el) => el.child(note("No Codex usage yet. Start a Codex session.")))
        .when(Boolean(this.data) && shown.length === 0, (el) => el.child(note("No limits in the last report.")))
        .children(shown.map(row)),
    );
  }
}
