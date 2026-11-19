// The agent session of the shown tab, for a side panel: Claude Code (model, context,
// cost, time, lines, prompt cache and the badges of the person's own status line, from
// the files statusline.sh keeps), or Codex / Pi (model, context, cost or tokens, from
// their own logs: agentlog.js). Below it, one card per sub-agent the tab started
// (`hc run` from an agent: terminals whose parent is in this tab), each with its
// context and cost. The block shows only while the tab has one of these agents: this
// part hides and shows its own block (props().block) with layout.hide / layout.show.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, appHome, home, theme, focused, panes, terminals, run } from "herdr";
import * as fs from "fs/promises";
import { span, tokens, money, badges, shortPath, safeId } from "./data.js";
import { AgentLogs, kindOf } from "./agentlog.js";

const MONO = "JetBrains Mono"; // jackc0re: section labels match the critters sidebar
const DIR = () => `${appHome()}/claude-status/sessions`;
const TICK = 500; // ms: how fast the block follows the shown tab
const READ_EVERY = 4; // ticks between reads of the shown sessions
const CLEAN_EVERY = 120; // ticks between removals of files of ended terminals
const LABEL = { claude: "CLAUDE CODE", codex: "CODEX", pi: "PI" };

// jackc0re: a terminal on another machine ("wsl/t1") keeps its files as "wsl-t1";
// that machine's status line sets HC_TERMINAL_ID=wsl-<id> (see the README).
const fileId = (addr) => (typeof addr === "string" ? addr.replace("/", "-") : addr);

// Claude Code's status line input, as the same summary Codex and Pi give.
function claudeSummary(s) {
  if (!s) return null;
  const cw = s.context_window ?? {};
  return {
    model: s.model?.display_name ?? null,
    effort: s.effort?.level ?? null,
    ctx: { used: cw.total_input_tokens ?? null, size: cw.context_window_size ?? null, pct: cw.used_percentage ?? null },
    cost: s.cost?.total_cost_usd ?? null,
    tokens: null,
  };
}
const pctOf = (d) => (typeof d?.ctx?.pct === "number" ? d.ctx.pct
  : typeof d?.ctx?.used === "number" && d.ctx.size ? (100 * d.ctx.used) / d.ctx.size : null);

export default class Session {
  constructor(props) {
    this.block = props.block ?? null;
    this.visible = undefined;
    this.pane = null; // the main agent's pane
    this.subs = []; // sub-agent terminals of the tab
    this.data = undefined; // Claude: undefined not read yet, null no file
    this.line = "";
    this.info = new Map(); // address -> { data, error } for Codex, Pi and sub-agents
    this.logs = new AgentLogs();
    this.reading = false;
    this.ticks = 0;
  }

  init(cx) {
    this.sync(cx);
    this.clean(cx);
    cx.timer.every(TICK, (cx) => {
      this.ticks++;
      this.sync(cx);
      if (this.ticks % READ_EVERY === 0 && this.visible) this.read(cx);
      if (this.ticks % CLEAN_EVERY === 0) this.clean(cx);
    });
  }

  // The agent pane to show: the focused one, else the one shown last, else the first.
  pick(tab) {
    const ps = panes().filter((p) => p.tab === tab && p.terminal && kindOf(p));
    return ps.find((p) => p.focused) ?? ps.find((p) => p.terminal === this.pane?.terminal) ?? ps[0] ?? null;
  }

  // Live agent terminals started from this tab's terminals (and from those, and so on),
  // also ones kept as a tab of their own (terminal.keep), but not this tab's own panes.
  subAgents(tab, all) {
    const inTab = new Set(panes().filter((p) => p.tab === tab && p.terminal).map((p) => p.terminal));
    const shown = new Set(inTab);
    const out = [];
    for (let grew = true; grew;) {
      grew = false;
      for (const t of all) {
        if (inTab.has(t.address) || !t.parent || !inTab.has(t.parent)) continue;
        inTab.add(t.address);
        grew = true;
        if (!shown.has(t.address) && t.state === "live" && kindOf(t)) out.push(t);
      }
    }
    return out;
  }

  sync(cx) {
    const tab = focused()?.tab ?? null;
    const pane = tab ? this.pick(tab) : null;
    const subs = tab ? this.subAgents(tab, terminals()) : [];
    const want = Boolean(pane) || subs.length > 0;
    if (this.block && want !== this.visible) run(want ? "layout.show" : "layout.hide", { id: this.block });
    this.visible = want;
    const changed = pane?.terminal !== this.pane?.terminal;
    const subsKey = subs.map((t) => `${t.address}:${t.status}`).join(",");
    if (changed || pane?.cwd !== this.pane?.cwd || pane?.branch !== this.pane?.branch || subsKey !== this.subsKey) {
      const newSubs = subs.some((t) => !this.info.has(t.address));
      this.pane = pane;
      this.subs = subs;
      this.subsKey = subsKey;
      if (changed) { this.data = undefined; this.line = ""; }
      if (changed || newSubs) this.read(cx);
      cx.notify();
    }
  }

  read(cx) {
    const pane = this.pane;
    if (kindOf(pane) === "claude") this.readClaude(pane.terminal, cx);
    const others = [...(pane && kindOf(pane) !== "claude" ? [pane.terminal] : []), ...this.subs.map((t) => t.address)];
    if (!others.length || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const all = terminals();
        for (const addr of others) {
          const t = all.find((x) => x.address === addr);
          const kind = kindOf(t) ?? kindOf(pane?.terminal === addr ? pane : null);
          if (!t || !kind) continue;
          try {
            const data = kind === "claude" ? claudeSummary(await this.claudeFile(addr)) : await this.logs.read(t, kind, all.filter((x) => kindOf(x) === kind));
            this.info.set(addr, { data, error: null });
          } catch (e) {
            this.info.set(addr, { data: this.info.get(addr)?.data ?? null, error: String(e?.message ?? e) });
          }
        }
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }

  async claudeFile(addr) {
    const id = fileId(addr);
    if (!safeId(id)) return null;
    const json = await readTextFile(`${DIR()}/${id}.json`);
    return json ? JSON.parse(json).input ?? null : null;
  }

  readClaude(addr, cx) {
    const id = fileId(addr);
    if (!safeId(id)) return;
    cx.spawn(async (cx) => {
      try {
        const [json, line] = await Promise.all([readTextFile(`${DIR()}/${id}.json`), readTextFile(`${DIR()}/${id}.line`)]);
        if (fileId(this.pane?.terminal) !== id) return;
        this.data = json ? JSON.parse(json) : null;
        this.line = line ?? "";
        this.error = null;
      } catch (e) {
        this.error = `Cannot read session: ${e}`;
      }
      cx.notify();
    });
  }

  // Files of terminals that no longer exist on this computer. Only judged while
  // the core lists terminals, so a core that is not answering never loses files.
  clean(cx) {
    const addrs = terminals().map((t) => t.address).filter((a) => typeof a === "string");
    const live = new Set(addrs.map(fileId));
    for (const a of [...this.info.keys()]) if (!addrs.includes(a)) this.info.delete(a);
    // Only judge machines that list terminals now, so an offline one never loses files.
    const listing = new Set(addrs.map((a) => (a.includes("/") ? a.split("/")[0] : "")));
    if (live.size === 0) return;
    cx.spawn(async () => {
      try {
        for (const name of await fs.readdir(DIR())) {
          // Only the files statusline.sh writes: `<terminal>.json`, `<terminal>.line`, and
          // `<terminal>.<ext>.tmp.<pid>` when Claude Code stopped a status line halfway.
          const m = name.match(/^([A-Za-z0-9_-]{1,64})\.(json|line)(\.tmp\.\d+)?$/);
          const owner = /^[A-Za-z0-9_]+-t\d+$/.test(m?.[1] ?? "") ? m[1].split("-")[0] : "";
          if (m && (m[3] || (listing.has(owner) && !live.has(m[1])))) await fs.unlink(`${DIR()}/${name}`).catch(() => {});
        }
      } catch {}
    });
  }

  render() {
    const t = theme();
    const p = this.pane;
    const panel = v_flex().id("claude-session").size_full().min_h(0).rounded(10).border(1).border_color(t.border)
      .bg(t.background).text_size(13).text_color(t.foreground).overflow_hidden();
    if (!p && !this.subs.length) return panel;

    const ui = this.parts(t);
    const kind = kindOf(p);
    const icon = ui.icon(p?.program, 14);
    const head = p ? (kind === "claude" ? claudeSummary(this.data?.input) : this.info.get(p.terminal)?.data) : null;
    const header = h_flex().id("cs-header").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(Boolean(p), (el) => el.cursor_pointer().on_click(() => run("pane.focus", { terminal: p.terminal })).tooltip("Focus this agent's pane"))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().font_family(MONO).text_size(11).font_bold().text_color(t.dim).flex_none().child(p ? LABEL[kind] : "SUB-AGENTS"))
      .child(div().flex_1().min_w(0))
      .when(kind === "claude" && Boolean(this.data?.input?.fast_mode), (el) => el.child(ui.chip("fast", t.ansi3, "cs-fast")))
      .when(Boolean(head?.modelName ?? head?.model), (el) => el.child(ui.chip(head.modelName ?? head.model, t.accent, "cs-model")))
      .when(Boolean(head?.effort), (el) => el.child(ui.chip(head.effort, null, "cs-effort").tooltip("Reasoning effort")));

    const body = !p ? null : kind === "claude" ? this.claudeBody(t, ui) : this.logBody(t, ui, p);
    const subs = this.subs.length ? this.subsList(t, ui) : null;
    return panel.child(header).child(
      v_flex().id("cs-body").flex_1().min_h(0).px(14).py(12).gap(11).overflow_y_scrollbar()
        .when(Boolean(body), (el) => el.children(body))
        .when(Boolean(subs), (el) => el.child(subs)));
  }

  // Shared pieces.
  parts(t) {
    const chip = (text, color, id) =>
      div().id(id).flex_none().h(20).px(7).rounded(5).flex().items_center().text_size(11)
        .bg((color ?? t.dim) + "22").text_color(color ?? t.muted).child(text);
    const icon = (program, size) => !program?.icon ? null
      : program.tint ? svg(program.icon).size(size).flex_none().text_color(t.muted) : image(program.icon).size(size).flex_none();
    const note = (text, color) => div().text_size(12).text_color(color ?? t.dim).child(text);
    const ctxColor = (pct) => (pct === null ? t.dim : pct >= 80 ? t.ansi1 : pct >= 60 ? t.ansi3 : t.accent);
    const context = (d) => {
      const pct = pctOf(d), c = d?.ctx ?? {};
      return v_flex().gap(6)
        .child(h_flex().items_center().justify_between()
          .child(div().text_size(11).text_color(t.dim).child("Context"))
          .child(div().text_size(13).font_semibold().text_color(pct === null ? t.dim : pct >= 60 ? ctxColor(pct) : t.foreground).child(pct === null ? "–" : `${Math.round(pct)}%`)))
        .child(div().h(8).rounded(4).bg(t.border).overflow_hidden()
          .child(div().h_full().w(`${Math.min(100, pct ?? 0)}%`).rounded(4).bg(ctxColor(pct))))
        .child(h_flex().justify_between().text_size(11).text_color(t.dim)
          .child(div().child(`${tokens(c.used ?? undefined)} / ${tokens(c.size ?? undefined)} tokens`))
          .when(typeof c.size === "number" && typeof c.used === "number", (el) =>
            el.child(div().child(`${tokens(Math.max(0, c.size - c.used))} left`))));
    };
    const tile = (id, label, value) => v_flex().id(id).flex_1().min_w(0).gap(2).px(8).py(6).rounded(6).bg(t.raised)
      .child(div().text_size(10.5).text_color(t.dim).child(label)).child(value);
    const big = (text, color) => div().text_size(13).font_semibold().text_color(color ?? t.foreground).truncate().child(text);
    return { chip, icon, note, ctxColor, context, tile, big };
  }

  claudeBody(t, ui) {
    const p = this.pane, s = this.data?.input, now = Date.now() / 1000;
    if (!safeId(fileId(p.terminal))) return [ui.note("No session details for this terminal.")];
    if (this.error) return [ui.note(this.error, t.ansi1)];
    if (!s) return [ui.note(this.data === null
      ? "Waiting for the first response of this session. Connect the Claude Code status line to statusline.sh in the claude-status mod folder if nothing comes."
      : "Loading session…")];

    // Where: session name, folder, branch, pull request.
    const where = [shortPath(s.workspace?.current_dir ?? s.cwd, home()), s.workspace?.git_worktree ? `worktree ${s.workspace.git_worktree}` : p.branch]
      .filter(Boolean).join(" · ");
    const pr = s.pr?.number ? `PR #${s.pr.number}${s.pr.review_state ? ` · ${s.pr.review_state.replace("_", " ")}` : ""}` : null;
    const title = v_flex().gap(2)
      .when(Boolean(s.session_name), (el) => el.child(div().truncate().child(s.session_name)))
      .child(h_flex().gap(6).text_size(11.5).text_color(t.dim).min_w(0)
        .child(div().flex_1().min_w(0).truncate().child(where || "–"))
        .when(Boolean(pr), (el) => el.child(div().flex_none().text_color(s.pr.review_state === "approved" ? t.ansi2 : t.dim).child(pr))));

    // Cost, time, lines: three tiles.
    const c = s.cost ?? {};
    const stats = h_flex().gap(6)
      .child(ui.tile("cs-cost", "Cost", ui.big(money(c.total_cost_usd))).tooltip("Estimated at list price by Claude Code"))
      .child(ui.tile("cs-time", "Time", ui.big(typeof c.total_duration_ms === "number" ? span(c.total_duration_ms / 1000) : "–"))
        .tooltip(typeof c.total_api_duration_ms === "number" ? `Waiting for the API: ${span(c.total_api_duration_ms / 1000)}` : "Session time"))
      .child(ui.tile("cs-lines", "Lines", h_flex().gap(4).text_size(13).font_semibold()
        .child(div().text_color(t.ansi2).child(`+${c.total_lines_added ?? 0}`))
        .child(div().text_color(t.ansi1).child(`−${c.total_lines_removed ?? 0}`))));

    // Prompt cache: warm until expires_at; cold means the next request writes the cache again.
    const pc = s.prompt_cache;
    const warm = pc?.warm && typeof pc.expires_at === "number" && pc.expires_at > now;
    const cache = !pc?.caching_observed ? null : h_flex().id("cs-cache").gap(6).items_center().text_size(11.5).text_color(t.dim)
      .child(div().size(6).flex_none().rounded(3).bg(warm ? t.ansi2 : t.ansi3))
      .child(div().truncate().child(warm
        ? `Cache warm · ${span(pc.expires_at - now)} left${typeof pc.hit_ratio === "number" ? ` · ${Math.round(pc.hit_ratio * 100)}% hits` : ""}`
        : `Cache cold · next request writes ${tokens(pc.recache_tokens_if_cold)}`))
      .tooltip(`Requests ${pc.requests ?? 0}, misses ${pc.misses ?? 0}, TTL ${pc.ttl ?? "–"}`);

    // Badges: what the person's own status line printed in brackets, then session settings.
    const extra = [
      ...badges(this.line).map((b) => ({ text: b.text, color: b.color })),
      s.output_style?.name && s.output_style.name !== "default" ? { text: s.output_style.name } : null,
      s.vim?.mode ? { text: s.vim.mode } : null,
      s.agent?.name ? { text: s.agent.name } : null,
    ].filter(Boolean);
    const chips = extra.length === 0 ? null
      : h_flex().flex_wrap().gap(5).children(extra.map((b, i) => ui.chip(b.text, b.color, `cs-badge-${i}`)));

    return [title, ui.context(claudeSummary(s)), stats, cache, chips].filter(Boolean);
  }

  // Codex and Pi, from their logs.
  logBody(t, ui, p) {
    const kind = kindOf(p), entry = this.info.get(p.terminal), d = entry?.data;
    const where = [shortPath(p.cwd, home()), p.branch].filter(Boolean).join(" · ");
    const title = v_flex().gap(2)
      .child(div().truncate().child(p.title || p.program?.name || LABEL[kind]))
      .child(div().text_size(11.5).text_color(t.dim).truncate().child(where || "–"));
    if (!d) return [title, ui.note(entry?.error ? `Cannot read the ${p.program?.name ?? kind} log: ${entry.error}`
      : entry ? `No ${p.program?.name ?? kind} session log found for this terminal yet.` : "Loading session…", entry?.error ? t.ansi1 : null)];
    return [title, ui.context(d), this.logStats(t, ui, kind, d, "cs"), this.cacheLine(t, d)].filter(Boolean);
  }

  logStats(t, ui, kind, d, id) {
    const tk = d.tokens ?? {};
    const cost = d.cost === null
      ? ui.tile(`${id}-cost`, "Cost", ui.big("plan", t.dim)).tooltip("Codex runs on your ChatGPT plan; its logs carry no prices")
      : ui.tile(`${id}-cost`, "Cost", ui.big(money(d.cost))).tooltip(`Estimated by ${kind === "pi" ? "Pi" : kind} from its model prices`);
    const time = d.started && d.last ? span((d.last - d.started) / 1000) : "–";
    return h_flex().gap(6)
      .child(cost)
      .child(ui.tile(`${id}-time`, "Time", ui.big(time)).tooltip("From the session's start to its last entry"))
      .child(ui.tile(`${id}-tokens`, "Tokens", ui.big(tokens(tk.total)))
        .tooltip(`In ${tokens(tk.input)} (${tokens(tk.cached)} from cache) · out ${tokens(tk.output)}`));
  }

  cacheLine(t, d) {
    const tk = d.tokens;
    if (!tk?.input) return null;
    return h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
      .child(div().size(6).flex_none().rounded(3).bg(t.ansi2))
      .child(div().truncate().child(`${Math.round((100 * tk.cached) / tk.input)}% of input from cache`));
  }

  // One compact card per sub-agent: name, model, status, context and cost.
  subsList(t, ui) {
    const card = (s, i) => {
      const kind = kindOf(s), entry = this.info.get(s.address), d = entry?.data, pct = pctOf(d);
      const status = s.status ?? s.report?.state ?? null;
      const right = !d ? "" : d.cost !== null && d.cost !== undefined ? money(d.cost) : d.tokens ? `${tokens(d.tokens.total)} tok` : "";
      return v_flex().id(`cs-sub-${i}`).gap(5).px(9).py(7).rounded(7).bg(t.raised).cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click(() => run("terminal.peek", { terminal: s.address }))
        .tooltip(`${s.name ?? s.address} · ${LABEL[kind]}${d?.effort ? ` · ${d.effort}` : ""}\nClick to peek`)
        .child(h_flex().gap(6).items_center().min_w(0)
          .when(Boolean(ui.icon(s.program, 12)), (el) => el.child(ui.icon(s.program, 12)))
          .child(div().text_size(12).font_semibold().flex_none().child(s.name ?? s.address))
          .when(status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working).spin(900)))
          .when(status === "blocked" || status === "done", (el) => el.child(div().size(6).flex_none().rounded(3).bg(t[status])))
          .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).truncate().child(d?.modelName ?? d?.model ?? ""))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(right)))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().h(4).rounded(2).bg(t.border).overflow_hidden()
            .child(div().h_full().w(`${Math.min(100, pct ?? 0)}%`).rounded(2).bg(ui.ctxColor(pct))))
          .child(div().w(30).flex_none().text_right().text_size(10.5).text_color(pct === null ? t.dim : pct >= 60 ? ui.ctxColor(pct) : t.muted)
            .child(pct === null ? (entry?.error ? "err" : "–") : `${Math.round(pct)}%`)));
    };
    return v_flex().gap(6)
      .child(h_flex().pt(this.pane ? 4 : 0).items_center().gap(6)
        .child(div().font_family(MONO).text_size(10).font_bold().text_color(t.dim).child("SUB-AGENTS"))
        .child(div().text_size(10).text_color(t.dim).child(String(this.subs.length))))
      .children(this.subs.map(card));
  }
}
