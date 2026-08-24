import {
  amountToWords,
  deskNoun,
  deskTitle,
  formatCheckAmount,
  formatClock,
  formatKph,
  formatMoney,
  formatPct,
  goalLabel,
  itemNoun,
  kphBand,
  sourceTitle,
  TenkeySession,
  isEnterKey,
  isPlusKey,
} from "./engine";
import { buildPace } from "./engine/series";
import { renderPaceSvg } from "./chart";
import { readoffFollowScrollTop } from "./readoff-scroll";
import { VERSION } from "./version";
import type { CheckItem, DeskKind, KeyInput, SourceKind } from "./engine";
import { downloadBestsReport, downloadSessionReport, sessionToReport } from "./pdf";
import {
  bestsByGoal,
  checkIn,
  groupSessionsByDay,
  loadStore,
  operatorStore,
  personalBest,
  recordSession,
  sessionDesk,
  sessionSource,
  sessionsForSource,
  type Store,
  type StoredSession,
} from "./storage";

const NEW_OPERATOR = "__new__";

export const DURATIONS = [
  { label: "0:30", name: "30 seconds", ms: 30_000 },
  { label: "1:00", name: "1 minute", ms: 60_000 },
  { label: "3:00", name: "3 minutes", ms: 180_000 },
  { label: "5:00", name: "5 minutes", ms: 300_000 },
  { label: "10:00", name: "10 minutes", ms: 600_000 },
] as const;

type Screen = "setup" | "test" | "results";

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}

function keyFromEvent(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    code: event.code,
    location: event.location,
    shiftKey: event.shiftKey,
  };
}

export function boot(): void {
  const app = new App();
  app.mount();
  if (import.meta.env.DEV) {
    (window as unknown as { __tenkeyEnd: () => void }).__tenkeyEnd = () => {
      app.endForPreview();
    };
  }
}

class App {
  private store: Store = loadStore();
  private screen: Screen = "setup";
  private lengthKind: "stack" | "time" = "stack";
  private stackSize = 25;
  private durationMs = 60_000;
  private desk: DeskKind = "calculator";
  private source: SourceKind = "checks";
  private practice = true;
  private session: TenkeySession | null = null;
  private lastStored: StoredSession | null = null;
  private timer: number | null = null;
  private slideTimer: number | null = null;
  private front: HTMLElement | null = null;
  private waiting: HTMLElement | null = null;
  private pendingLeave: HTMLElement | null = null;
  private tapePrinted = 0;
  private softDown = new Map<string, HTMLElement>();

  mount(): void {
    $("#version-stamp").textContent = `v${VERSION}`;
    this.bind();
    this.show("setup");
  }

  private bind(): void {
    $("#operator-select").addEventListener("change", () => this.onOperatorSelect());
    $("#checkin-btn").addEventListener("click", () => this.checkInFromInput());
    $("#name-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.checkInFromInput();
      }
    });
    $("#length-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-length]");
      if (!btn) return;
      this.lengthKind = btn.dataset.length === "time" ? "time" : "stack";
      this.renderPills();
    });
    $("#stack-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-stack]");
      if (!btn) return;
      this.stackSize = Number(btn.dataset.stack);
      this.renderPills();
    });
    $("#duration-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-ms]");
      if (!btn) return;
      this.durationMs = Number(btn.dataset.ms);
      this.renderPills();
    });
    $("#source-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-source]");
      if (!btn) return;
      this.source = btn.dataset.source === "transcription" ? "transcription" : "checks";
      this.renderSetup();
    });
    $("#desk-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-desk]");
      if (!btn) return;
      this.desk = btn.dataset.desk === "spreadsheet" ? "spreadsheet" : "calculator";
      this.renderPills();
    });
    $("#mode-pills").addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
      if (!btn) return;
      this.practice = btn.dataset.mode === "practice";
      this.renderPills();
    });
    $("#start-btn").addEventListener("click", () => this.start());
    $("#abort-btn").addEventListener("click", () => this.abort());
    $("#again-btn").addEventListener("click", () => this.start());
    $("#retry-seed-btn").addEventListener("click", () => {
      const seed = this.session?.seed ?? this.lastStored?.seed;
      this.start(seed);
    });
    $("#home-btn").addEventListener("click", () => this.show("setup"));
    $("#pdf-session-btn").addEventListener("click", () => this.pdfSession());
    $("#pdf-bests-btn").addEventListener("click", () => {
      const source = this.session?.source ?? this.source;
      downloadBestsReport(this.storeForSource(source), source);
    });
    $("#pdf-bests-setup-btn").addEventListener("click", () =>
      downloadBestsReport(this.storeForSource(this.source), this.source),
    );

    document.addEventListener("keydown", (event) => this.onKey(event));
    document.addEventListener("keyup", (event) => this.onKeyUp(event));
    window.addEventListener("blur", () => this.clearSoftDown());
    $("#soft-keys").addEventListener("pointerdown", (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (!btn) return;
      event.preventDefault();
      this.send({
        key: btn.dataset.key ?? "",
        code: btn.dataset.code ?? "",
        location: Number(btn.dataset.location ?? 0),
      });
    });
  }

  private show(screen: Screen): void {
    this.screen = screen;
    $("#setup").hidden = screen !== "setup";
    $("#test").hidden = screen !== "test";
    $("#results").hidden = screen !== "results";
    $("#abort-btn").hidden = screen !== "test";
    $("#live-stats").hidden = screen !== "test";
    document.body.dataset.screen = screen;
    if (screen === "setup") this.renderSetup();
    if (screen === "test") this.renderTest(true);
    if (screen === "results") this.renderResults();
  }

  private renderSetup(): void {
    this.renderCheckin();
    this.renderPills();
    const who = this.store.name.trim();
    const job = sourceTitle(this.source);
    $("#bests-heading").textContent = who
      ? `${who} · ${job} · exam bests`
      : `${job} · exam bests`;
    $("#recent-heading").textContent = who ? `${who} · recent` : "Recent";
    const bests = bestsByGoal(this.store, this.source);
    $("#bests-empty").hidden = bests.length > 0;
    $("#bests-empty").textContent = who
      ? `No ${job.toLowerCase()} exam sessions for ${who} yet.`
      : `No ${job.toLowerCase()} exam sessions on this station yet.`;
    const list = $("#bests-list");
    list.innerHTML = bests
      .map((session) => {
        return `<li><span>${goalLabel(session)}</span><strong>${formatKph(session.score.netKph)} KPH</strong><em>${formatPct(session.score.amountAccuracy)}</em></li>`;
      })
      .join("");

    const rows = sessionsForSource(this.store, this.source);
    $("#history-empty").hidden = rows.length > 0;
    $("#history-empty").textContent = who
      ? `No sessions for ${who} yet.`
      : "Check in to see your scores.";
    const days = $("#history-days");
    days.hidden = rows.length === 0;
    const today = new Date();
    days.innerHTML = groupSessionsByDay(rows)
      .map((group) => {
        const open = sameDay(group.at, today.getTime()) ? " open" : "";
        const runs = group.sessions
          .map((session) => {
            const when = new Date(session.at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            });
            return `<tr>
              <td>${when}</td>
              <td>${session.practice ? "Practice" : "Exam"} · ${deskNoun(sessionDesk(session))}</td>
              <td>${goalLabel(session)}</td>
              <td>${formatKph(session.score.netKph)}</td>
              <td>${formatPct(session.score.amountAccuracy)}</td>
            </tr>`;
          })
          .join("");
        return `<details${open}>
          <summary><span>${group.label} · ${group.sessions.length} run${group.sessions.length === 1 ? "" : "s"}</span><strong>median ${formatKph(group.medianKph)} KPH</strong></summary>
          <table class="history">
            <thead><tr><th>When</th><th>Mode</th><th>Length</th><th>KPH</th><th>Acc</th></tr></thead>
            <tbody>${runs}</tbody>
          </table>
        </details>`;
      })
      .join("");
  }

  private renderCheckin(): void {
    const select = $("#operator-select") as HTMLSelectElement;
    const input = $("#name-input") as HTMLInputElement;
    const row = $("#new-operator-row");
    const button = $("#checkin-btn");
    const hint = $("#checkin-hint");
    const error = $("#checkin-error");
    error.hidden = true;
    const operators = this.store.operators;
    const adding = select.value === NEW_OPERATOR;

    if (operators.length === 0) {
      select.hidden = true;
      row.hidden = false;
      button.hidden = false;
      input.value = this.store.name;
      hint.textContent = "Type your name to check in at this station.";
      return;
    }

    select.hidden = false;
    const current = adding ? NEW_OPERATOR : this.store.name;
    select.innerHTML = [
      `<option value="">Select operator…</option>`,
      ...operators.map(
        (name) =>
          `<option value="${escapeHtml(name)}"${name === current ? " selected" : ""}>${escapeHtml(name)}</option>`,
      ),
      `<option value="${NEW_OPERATOR}"${adding ? " selected" : ""}>Add a new operator…</option>`,
    ].join("");
    if (!adding && this.store.name) select.value = this.store.name;

    const showNew = adding || !this.store.name;
    row.hidden = !showNew;
    button.hidden = !showNew;
    if (showNew && adding) input.value = "";
    else if (!adding) input.value = this.store.name;
    hint.textContent = adding
      ? "Enter the new operator name, then Check in."
      : this.store.name
        ? `Checked in as ${this.store.name}. Scores on the right are yours.`
        : "Pick your name, or add a new operator.";
  }

  private onOperatorSelect(): void {
    const select = $("#operator-select") as HTMLSelectElement;
    if (select.value === NEW_OPERATOR) {
      ($("#name-input") as HTMLInputElement).value = "";
      this.renderCheckin();
      ($("#name-input") as HTMLInputElement).focus();
      return;
    }
    if (!select.value) {
      this.store = checkIn(this.store, "");
      this.renderSetup();
      return;
    }
    this.store = checkIn(this.store, select.value);
    ($("#name-input") as HTMLInputElement).value = this.store.name;
    this.renderSetup();
  }

  private checkInFromInput(): boolean {
    const input = $("#name-input") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) {
      $("#checkin-error").hidden = false;
      input.focus();
      return false;
    }
    this.store = checkIn(this.store, name);
    ($("#operator-select") as HTMLSelectElement).value = this.store.name;
    this.renderSetup();
    return true;
  }

  private renderPills(): void {
    for (const btn of document.querySelectorAll<HTMLElement>("#length-pills [data-length]")) {
      btn.classList.toggle("is-on", btn.dataset.length === this.lengthKind);
    }
    for (const btn of document.querySelectorAll<HTMLElement>("#stack-pills [data-stack]")) {
      btn.classList.toggle("is-on", Number(btn.dataset.stack) === this.stackSize);
    }
    for (const btn of document.querySelectorAll<HTMLElement>("#duration-pills [data-ms]")) {
      btn.classList.toggle("is-on", Number(btn.dataset.ms) === this.durationMs);
    }
    for (const btn of document.querySelectorAll<HTMLElement>("#source-pills [data-source]")) {
      btn.classList.toggle("is-on", btn.dataset.source === this.source);
    }
    for (const btn of document.querySelectorAll<HTMLElement>("#desk-pills [data-desk]")) {
      btn.classList.toggle("is-on", btn.dataset.desk === this.desk);
    }
    for (const btn of document.querySelectorAll<HTMLElement>("#mode-pills [data-mode]")) {
      const isPractice = btn.dataset.mode === "practice";
      btn.classList.toggle("is-on", isPractice === this.practice);
    }
    $("#stack-field").hidden = this.lengthKind !== "stack";
    $("#duration-field").hidden = this.lengthKind !== "time";
    $("#source-checks-note").hidden = this.source !== "checks";
    $("#source-trans-note").hidden = this.source !== "transcription";
    $("#desk-calc-note").hidden = this.desk !== "calculator";
    $("#desk-sheet-note").hidden = this.desk !== "spreadsheet";
    $("#mode-practice-note").hidden = !this.practice;
    $("#mode-exam-note").hidden = this.practice;
    this.renderTicketCopy();
  }

  private renderTicketCopy(): void {
    const sheet = this.desk === "spreadsheet";
    const trans = this.source === "transcription";
    const commit = sheet ? "Enter" : "+";
    this.applyChrome(this.source);
    $("#kicker").textContent = trans
      ? "Station 4 · Transcription"
      : "Station 4 · Check processing";
    $("#headline").textContent = trans
      ? "Read the list. Key the amounts."
      : "Add the stack. Slide the check.";
    $("#length-stack-btn").textContent = trans ? "List" : "Stack";
    $("#stack-heading").textContent = trans ? "List size" : "Stack size";
    $("#stack-note").textContent = trans
      ? "Work through the whole list. The clock is only for KPH."
      : "Work through the whole stack. The clock is only for KPH.";
    $("#duration-note").textContent = trans
      ? "Keep going down the list until time runs out."
      : "Infinite stack until time runs out.";
    $("#desk-sheet-note").innerHTML = trans
      ? `<kbd>Enter</kbd> commits the cell and you work down the column.`
      : `<kbd>Enter</kbd> commits the cell and you work down the column. Tab still slides the check.`;
    $("#howto-checks").hidden = trans;
    $("#howto-transcription").hidden = !trans;
    if (trans) {
      $("#lede").innerHTML = `The full list is in front of you. Type each amount and press <kbd>${commit}</kbd> to add — you can read ahead. The clock starts on your first digit. Speed is Keystrokes per Hour (KPH). Scores are separate from check processing.`;
      $("#howto-trans-commit").innerHTML = sheet
        ? `Press <kbd>Enter</kbd> to commit the cell and move to the next line.`
        : `Press <kbd>+</kbd> to add and move to the next line.`;
    } else if (sheet) {
      $("#lede").innerHTML = `Type each amount. <kbd>Enter</kbd> commits the cell and you work down the column. <kbd>Tab</kbd> slides the check — either order. <kbd>Shift</kbd>+<kbd>Tab</kbd> brings a premature slide back. The clock starts on your first digit. Speed is Keystrokes per Hour (KPH).`;
      $("#howto-commit").innerHTML = `Press <kbd>Enter</kbd> to commit the cell, and <kbd>Tab</kbd> to slide — either order.`;
    } else {
      $("#lede").innerHTML = `Type each amount. <kbd>+</kbd> and <kbd>Tab</kbd> can happen in either order — add, then slide, or start sliding before you hit add. <kbd>Shift</kbd>+<kbd>Tab</kbd> brings a premature slide back. The clock starts on your first digit. Speed is Keystrokes per Hour (KPH).`;
      $("#howto-commit").innerHTML = `Press <kbd>+</kbd> to add toward the total, and <kbd>Tab</kbd> to slide — either order.`;
    }
  }

  private applyChrome(source: SourceKind): void {
    $("#brand-tagline").textContent = source === "transcription" ? "transcription" : "check totals";
    document.title = source === "transcription" ? "TENKEY — transcription" : "TENKEY — check totals";
  }

  private storeForSource(source: SourceKind): ReturnType<typeof operatorStore> {
    const scoped = operatorStore(this.store);
    return { ...scoped, sessions: sessionsForSource(scoped, source) };
  }

  private start(seed?: number): void {
    const select = $("#operator-select") as HTMLSelectElement;
    if (!this.store.name.trim() || select.value === NEW_OPERATOR) {
      if (!this.checkInFromInput()) return;
    }
    if (!this.store.name.trim()) {
      $("#checkin-error").hidden = false;
      return;
    }
    this.stopTimer();
    this.session = new TenkeySession({
      durationMs: this.lengthKind === "time" ? this.durationMs : 0,
      stackSize: this.lengthKind === "stack" ? this.stackSize : null,
      practice: this.practice,
      desk: this.desk,
      source: this.source,
      seed,
    });
    this.applyDeskUi($("#live-machine"), this.desk);
    this.lastStored = null;
    this.tapePrinted = 0;
    this.front = $("#check-front");
    this.waiting = $("#check-back");
    this.pendingLeave = null;
    if (this.slideTimer != null) {
      window.clearTimeout(this.slideTimer);
      this.slideTimer = null;
    }
    this.show("test");
    (document.activeElement as HTMLElement | null)?.blur();
    this.timer = window.setInterval(() => this.pulse(), 100);
  }

  private abort(): void {
    if (!this.session) return;
    if (!window.confirm("Abort this test without saving?")) return;
    this.session.abort(performance.now());
    this.stopTimer();
    this.finishSlideSwap();
    this.clearSoftDown();
    this.show("setup");
  }

  private pulse(): void {
    if (!this.session || this.screen !== "test") return;
    const now = performance.now();
    if (this.session.tick(now)) {
      this.complete();
      return;
    }
    this.renderLive(now);
  }

  private onKey(event: KeyboardEvent): void {
    if (this.screen !== "test" || !this.session) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    const input = keyFromEvent(event);
    if (
      event.repeat &&
      (input.key === "Tab" || input.key === "+" || input.key === "=" || input.key === "Enter")
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.abort();
      return;
    }
    event.preventDefault();
    this.pressSoftKey(input);
    this.send(input);
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (this.screen !== "test") return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    this.releaseSoftKey(keyFromEvent(event));
  }

  private pressSoftKey(input: KeyInput): void {
    const btn = this.softKeyFor(input);
    if (!btn) return;
    const id = input.code || input.key;
    btn.classList.add("is-down");
    this.softDown.set(id, btn);
  }

  private releaseSoftKey(input: KeyInput): void {
    const id = input.code || input.key;
    const btn = this.softDown.get(id);
    if (!btn) return;
    btn.classList.remove("is-down");
    this.softDown.delete(id);
  }

  private clearSoftDown(): void {
    for (const btn of this.softDown.values()) btn.classList.remove("is-down");
    this.softDown.clear();
  }

  private softKeyFor(input: KeyInput): HTMLElement | null {
    const pad = document.querySelector("#soft-keys");
    if (!pad) return null;
    if (isPlusKey(input)) return pad.querySelector(".plus");
    if (isEnterKey(input) && this.session?.desk === "spreadsheet") {
      return pad.querySelector(".plus");
    }
    if (input.code) {
      const byCode = pad.querySelector<HTMLElement>(`[data-code="${input.code}"]`);
      if (byCode) return byCode;
    }
    if (input.key) {
      const byKey = pad.querySelector<HTMLElement>(`[data-key="${CSS.escape(input.key)}"]`);
      if (byKey) return byKey;
    }
    return null;
  }

  private send(input: KeyInput): void {
    if (!this.session || this.screen !== "test") return;
    const now = performance.now();
    const result = this.session.handleKey(input, now);
    if (result.finished) {
      this.complete();
      return;
    }
    if (this.session.source === "transcription") {
      this.renderReadoff();
    } else if (result.unslid) this.playUnslide();
    else if (result.slid) this.playSlide(result.recycle);
    else if (result.recycle) this.finishSlideSwap();
    this.renderOutput();
    this.renderEntry();
    this.renderHint();
    if (this.session.source === "checks") this.renderPeeks();
    this.renderLive(now);
  }

  private playSlide(recycle: boolean): void {
    if (!this.front || !this.waiting) return;
    if (this.slideTimer != null) this.finishSlideSwap();
    const leaving = this.front;
    const revealed = this.waiting;
    leaving.classList.add("is-leaving");
    if (!revealed.hidden) {
      revealed.classList.remove("is-waiting");
      revealed.classList.add("is-current");
      this.front = revealed;
    }
    this.pendingLeave = leaving;
    if (recycle) {
      this.slideTimer = window.setTimeout(() => this.finishSlideSwap(), 280);
    }
  }

  private playUnslide(): void {
    if (!this.pendingLeave || !this.front) return;
    if (this.slideTimer != null) {
      window.clearTimeout(this.slideTimer);
      this.slideTimer = null;
    }
    const returning = this.pendingLeave;
    returning.hidden = false;
    returning.classList.remove("is-leaving", "is-settling");
    returning.classList.add("is-current");
    if (this.front === returning) {
      this.pendingLeave = null;
      return;
    }
    const demoted = this.front;
    demoted.classList.remove("is-current");
    demoted.classList.add("is-waiting");
    this.front = returning;
    this.waiting = demoted;
    this.pendingLeave = null;
  }

  private finishSlideSwap(): void {
    if (this.slideTimer != null) {
      window.clearTimeout(this.slideTimer);
      this.slideTimer = null;
    }
    const leaving = this.pendingLeave;
    if (!leaving || !this.session) return;
    this.pendingLeave = null;
    leaving.classList.add("is-settling");
    leaving.classList.remove("is-leaving", "is-current");
    leaving.classList.add("is-waiting");
    const next = this.session.checks[this.session.currentIndex + 1];
    if (next) {
      leaving.hidden = false;
      fillCheck(leaving, next);
    } else {
      leaving.hidden = true;
    }
    this.waiting = leaving;
    window.requestAnimationFrame(() => leaving.classList.remove("is-settling"));
  }

  endForPreview(): void {
    if (!this.session || this.screen !== "test") return;
    this.session.finish(performance.now());
    this.complete();
  }

  private complete(): void {
    if (!this.session) return;
    this.stopTimer();
    this.finishSlideSwap();
    this.clearSoftDown();
    const now = this.session.endedAt ?? performance.now();
    const score = this.session.snapshot(now);
    const pace =
      this.session.startedAt != null
        ? buildPace(this.session.events, this.session.startedAt, now)
        : [];
    const stored: StoredSession = {
      id: this.session.id,
      at: Date.now(),
      name: this.store.name,
      durationMs: this.session.durationMs,
      stackSize: this.session.stackSize,
      seed: this.session.seed,
      practice: this.session.practice,
      desk: this.session.desk,
      source: this.session.source,
      score,
      pace,
    };
    this.store = recordSession(this.store, stored);
    this.lastStored = stored;
    this.show("results");
  }

  private renderTest(updateCheck: boolean): void {
    if (!this.session) return;
    $("#test").dataset.source = this.session.source;
    this.applyChrome(this.session.source);
    this.applyDeskUi($("#live-machine"), this.session.desk);
    if (this.session.source === "transcription") this.renderReadoff();
    else if (updateCheck) this.renderChecks();
    this.renderOutput();
    this.renderEntry();
    this.renderHint();
    this.renderLive(performance.now());
  }

  private applyDeskUi(root: HTMLElement, desk: DeskKind): void {
    root.dataset.desk = desk;
    const plus = root.querySelector<HTMLButtonElement>(".soft-keys .plus");
    if (!plus) return;
    if (desk === "spreadsheet") {
      plus.dataset.key = "Enter";
      plus.dataset.code = "NumpadEnter";
      plus.textContent = "↵";
    } else {
      plus.dataset.key = "+";
      plus.dataset.code = "";
      plus.textContent = "+";
    }
  }

  private renderOutput(): void {
    if (!this.session) return;
    if (this.session.desk === "spreadsheet") this.renderSheet();
    else this.renderTape();
  }

  private renderChecks(): void {
    if (!this.session || !this.front || !this.waiting) return;
    this.front.classList.remove("is-leaving", "is-settling", "is-waiting");
    this.front.classList.add("is-current");
    this.waiting.classList.remove("is-leaving", "is-settling", "is-current");
    this.waiting.classList.add("is-waiting");
    const current = this.session.checks[this.session.currentIndex];
    if (current) {
      this.front.hidden = false;
      fillCheck(this.front, current);
    } else {
      this.front.hidden = true;
    }
    const next = this.session.checks[this.session.currentIndex + 1];
    this.waiting.hidden = !next;
    if (next) fillCheck(this.waiting, next);
    this.renderPeeks();
  }

  private renderPeeks(): void {
    if (!this.session) return;
    const remaining =
      this.session.stackSize == null
        ? 99
        : Math.max(0, this.session.stackSize - this.session.currentIndex);
    document.querySelector<HTMLElement>(".peek.p1")!.hidden = remaining < 2;
    document.querySelector<HTMLElement>(".peek.p2")!.hidden = remaining < 3;
    document.querySelector<HTMLElement>(".peek.p3")!.hidden = remaining < 4;
  }

  private renderReadoff(): void {
    if (!this.session) return;
    const session = this.session;
    const list = $("#readoff-list");
    const current = session.currentIndex;
    list.innerHTML = session.checks
      .map((item, i) => {
        const amount = formatMoney(item.cents);
        const sub = session.submissions[i];
        const classes: string[] = [];
        if (i === current && session.phase !== "done" && session.phase !== "aborted") {
          classes.push("is-current");
        } else if (sub) {
          classes.push("is-done");
          if (session.practice) classes.push(sub.correct ? "ok" : "bad");
        }
        return `<li class="${classes.join(" ")}"><span class="n">${i + 1}</span><span class="amt">${amount}</span></li>`;
      })
      .join("");
    const total = session.stackSize ?? session.checks.length;
    $("#readoff-meta").textContent =
      session.stackSize != null
        ? `${total} ${itemNoun("transcription", total)}`
        : "open list";
    const currentRow = list.querySelector<HTMLElement>(".is-current");
    if (currentRow) {
      const currentTop =
        currentRow.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTop = readoffFollowScrollTop({
        viewH: list.clientHeight,
        scrollH: list.scrollHeight,
        currentTop,
        currentH: currentRow.offsetHeight,
      });
    }
  }

  private renderTape(): void {
    if (!this.session) return;
    const tape = $("#tape");
    const subs = this.session.submissions;
    if (subs.length === 0) {
      tape.innerHTML = `<div class="tape-line dim"><span>ready</span><span></span></div>`;
      this.tapePrinted = 0;
      return;
    }
    if (this.tapePrinted === 0) tape.replaceChildren();
    const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    while (this.tapePrinted < subs.length) {
      const sub = subs[this.tapePrinted]!;
      const amount = sub.parsedCents != null ? formatCheckAmount(sub.parsedCents) : sub.raw;
      const mark = this.session.practice ? (sub.correct ? " ✓" : " ✗") : "";
      const line = document.createElement("div");
      line.className = `tape-line ${this.session.practice ? (sub.correct ? "ok" : "bad") : ""}`;
      line.innerHTML = `<span>${amount}</span><span>+${mark}</span>`;
      if (motionOk) {
        line.classList.add("is-printing");
        tape.append(line);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            line.classList.remove("is-printing");
            line.classList.add("is-printed");
          });
        });
      } else {
        line.classList.add("is-printed");
        tape.append(line);
      }
      this.tapePrinted += 1;
    }
    while (tape.childElementCount > 28) tape.firstElementChild?.remove();
  }

  private renderSheet(): void {
    if (!this.session) return;
    const session = this.session;
    const body = $("#sheet-body");
    const activeIndex = session.submissions.length;
    const rows = sheetRowCount(session);
    const parts: string[] = [];
    for (let i = 0; i < rows; i++) {
      const sub = session.submissions[i];
      const isActive =
        i === activeIndex && session.phase !== "done" && session.phase !== "aborted";
      let cell = "";
      let cls = "cell";
      if (sub) {
        cell = escapeHtml(sub.parsedCents != null ? formatCheckAmount(sub.parsedCents) : sub.raw);
        if (session.practice) cls += sub.correct ? " ok" : " bad";
      } else if (isActive) {
        cell = liveEntryHtml(session, false);
      }
      parts.push(
        `<tr class="${isActive ? "is-active" : ""}"><th class="row-h">${i + 1}</th><td class="${cls}">${cell}</td></tr>`,
      );
    }
    body.innerHTML = parts.join("");
    $("#sheet-ref").textContent = `A${activeIndex + 1}`;
    $("#sheet-formula").innerHTML = liveEntryHtml(session, false);
    $("#sheet-sum").textContent = formatMoney(session.snapshot(performance.now()).enteredTotalCents);
    body.querySelector("tr.is-active")?.scrollIntoView({ block: "nearest" });
  }

  private renderEntry(): void {
    if (!this.session) return;
    const lcd = $("#lcd-entry");
    if (this.session.phase === "awaiting_slide" && this.session.lastSubmitted) {
      lcd.innerHTML = `<span class="committed">${this.session.lastSubmitted.raw}</span>`;
    } else if (this.session.buffer.length === 0) {
      lcd.innerHTML = `<span class="lcd-ghost">0.00</span><span class="cursor"></span>`;
    } else {
      const chars = this.session.buffer
        .map((ch) =>
          ch.miskey ? `<span class="miskey">${escapeHtml(ch.ch)}</span>` : escapeHtml(ch.ch),
        )
        .join("");
      lcd.innerHTML = `${chars}<span class="cursor"></span>`;
    }
    const score = this.session.snapshot(performance.now());
    $("#lcd-total").textContent = formatMoney(score.enteredTotalCents);
  }

  private renderHint(): void {
    if (!this.session) return;
    const hint = $("#hint");
    const commit = this.session.desk === "spreadsheet" ? "Enter" : "+";
    const trans = this.session.source === "transcription";
    const unit = trans ? "amount" : "check";
    const last =
      this.session.stackSize != null &&
      this.session.hasCurrentCheck &&
      this.session.currentIndex === this.session.stackSize - 1;
    if (this.session.phase === "armed") {
      hint.textContent = last
        ? `Last ${unit}. First digit starts.`
        : "First digit starts the clock.";
    } else if (trans) {
      if (this.session.buffer.some((ch) => ch.miskey)) {
        hint.textContent = `Backspace the red keys, then ${commit}.`;
      } else if (last) {
        hint.textContent = `${commit} to add the last amount and finish.`;
      } else if (this.session.buffer.length === 0) {
        hint.textContent = `Type the amount, then ${commit}.`;
      } else {
        hint.textContent = `${commit} to add and go to the next line.`;
      }
    } else if (this.session.phase === "awaiting_slide") {
      hint.textContent = last ? "Tab — last check, then you're done." : "Tab — slide this check aside.";
    } else if (this.session.phase === "awaiting_plus") {
      hint.textContent =
        this.session.stackSize != null && this.session.entryIndex === this.session.stackSize - 1
          ? `${commit} to add the last check and finish. Shift+Tab brings it back.`
          : `${commit} to add. Shift+Tab brings the check back.`;
    } else if (this.session.buffer.length === 0) {
      hint.textContent = `Enter the amount, then ${commit} or Tab.`;
    } else if (this.session.buffer.some((ch) => ch.miskey)) {
      hint.textContent = `Backspace the red keys, then ${commit}.`;
    } else {
      hint.textContent = `${commit} to add, or Tab to slide first.`;
    }
    const current = this.session.checks[this.session.currentIndex];
    this.front?.classList.toggle("is-whole", Boolean(current?.wholeDollar));
  }

  private renderLive(now: number): void {
    if (!this.session) return;
    const score = this.session.snapshot(now);
    const elapsed = this.session.elapsedMs(now);
    const stack = this.session.stackSize;
    $("#stat-progress-wrap").hidden = stack == null;
    $("#stat-progress-label").textContent =
      this.session.source === "transcription" ? "list" : "stack";
    if (stack != null) {
      $("#stat-progress").textContent = `${this.session.clearedCount}/${stack}`;
      $("#stat-time-label").textContent = "elapsed";
      $("#stat-time").textContent = formatClock(elapsed);
    } else {
      $("#stat-time-label").textContent = "time";
      $("#stat-time").textContent = formatClock(this.session.remainingMs(now));
    }
    const liveReady = this.session.startedAt != null && elapsed >= 2000;
    $("#stat-kph").textContent = liveReady ? formatKph(score.netKph) : "—";
    $("#stat-acc").textContent =
      this.session.startedAt == null || this.session.submissions.length === 0
        ? "—"
        : formatPct(score.amountAccuracy);
  }

  private renderResults(): void {
    const stored = this.lastStored;
    const session = this.session;
    if (!stored || !session) return;
    const score = stored.score;
    $("#res-kph").textContent = formatKph(score.netKph);
    $("#res-acc").textContent = formatPct(score.amountAccuracy);
    $("#res-band").textContent = kphBand(score.netKph);
    const source = sessionSource(stored);
    this.applyChrome(source);
    $("#res-mode").textContent = `${sourceTitle(source)} · ${stored.practice ? "Practice" : "Exam"} · ${goalLabel(stored)} · ${deskTitle(sessionDesk(stored))}`;
    $("#res-items-label").textContent =
      source === "transcription" ? "Amounts correct" : "Checks correct";
    $("#retry-seed-btn").textContent =
      source === "transcription" ? "Same amounts" : "Same checks";
    $("#res-gross").textContent = formatKph(score.grossKph);
    $("#res-numeric").textContent = formatKph(score.numericKph);
    $("#res-corr-acc").textContent = formatPct(score.correctedAccuracy);
    $("#res-corrected").textContent = String(score.correctedErrors);
    $("#res-uncorrected").textContent = String(score.uncorrectedErrors);
    $("#res-checks").textContent = `${score.checksCorrect} / ${score.checksSubmitted}`;
    $("#res-entered").textContent = formatMoney(score.enteredTotalCents);
    $("#res-true").textContent = formatMoney(score.trueTotalCents);
    const match = score.enteredTotalCents === score.trueTotalCents;
    const items = itemNoun(source);
    $("#res-total-note").textContent = match
      ? `Entered total matches the ${items} you submitted.`
      : `Entered total does not match the true total of those ${items}.`;
    $("#res-total-note").classList.toggle("bad", !match);
    const paceWrap = $("#pace-wrap");
    const pace = stored.pace ?? [];
    if (pace.length >= 2) {
      paceWrap.hidden = false;
      const kphs = pace.map((p) => p.kph);
      $("#pace-range").textContent = `${formatKph(Math.min(...kphs))} – ${formatKph(Math.max(...kphs))}`;
      $("#pace-chart").innerHTML = renderPaceSvg(pace);
    } else {
      paceWrap.hidden = true;
      $("#pace-chart").innerHTML = "";
      $("#pace-range").textContent = "";
    }
    const leftover = $("#res-leftover");
    if (score.leftoverRaw) {
      leftover.hidden = false;
      leftover.textContent = `Unfinished next ${itemNoun(source, 1)} when time expired (${score.leftoverRaw}) — not counted as an error.`;
    } else {
      leftover.hidden = true;
      leftover.textContent = "";
    }

    const best = personalBest(
      this.store,
      stored.durationMs,
      stored.practice,
      stored.stackSize ?? null,
      source,
    );
    const pb = $("#res-pb");
    if (best && best.id !== stored.id && best.score.netKph > 0) {
      pb.hidden = false;
      pb.textContent = `Personal best for this duration: ${formatKph(best.score.netKph)} net KPH at ${formatPct(best.score.amountAccuracy)}.`;
    } else if (best && best.id === stored.id) {
      pb.hidden = false;
      pb.textContent = "New personal best for this duration.";
    } else {
      pb.hidden = true;
    }
    this.renderReviewOutput();
  }

  private renderReviewOutput(): void {
    const session = this.session;
    if (!session) return;
    this.applyDeskUi($("#review-machine"), session.desk);
    if (session.desk === "spreadsheet") this.renderReviewSheet();
    else this.renderReviewTape();
  }

  private renderReviewTape(): void {
    const session = this.session;
    if (!session) return;
    const tape = $("#review-tape");
    const subs = session.submissions;
    if (subs.length === 0) {
      tape.innerHTML = `<div class="tape-line dim"><span>no entries</span><span></span></div>`;
    } else {
      tape.innerHTML = subs
        .map((sub) => {
          const amount = sub.parsedCents != null ? formatCheckAmount(sub.parsedCents) : sub.raw;
          const mark = sub.correct ? " ✓" : " ✗";
          const cls = sub.correct ? "ok" : "bad";
          return `<div class="tape-line ${cls} is-printed"><span>${amount}</span><span>+${mark}</span></div>`;
        })
        .join("");
    }
    $("#review-total").textContent = formatMoney(session.snapshot(session.endedAt ?? performance.now()).enteredTotalCents);
    $("#review-caption").textContent = session.practice ? "practice" : "exam review";
    tape.scrollTop = tape.scrollHeight;
  }

  private renderReviewSheet(): void {
    const session = this.session;
    if (!session) return;
    const body = $("#review-sheet-body");
    const subs = session.submissions;
    if (subs.length === 0) {
      body.innerHTML = `<tr><th class="row-h">1</th><td class="cell"></td></tr>`;
    } else {
      body.innerHTML = subs
        .map((sub, i) => {
          const amount = escapeHtml(
            sub.parsedCents != null ? formatCheckAmount(sub.parsedCents) : sub.raw,
          );
          const cls = sub.correct ? "ok" : "bad";
          return `<tr><th class="row-h">${i + 1}</th><td class="cell ${cls}">${amount}</td></tr>`;
        })
        .join("");
    }
    $("#review-sheet-sum").textContent = formatMoney(
      session.snapshot(session.endedAt ?? performance.now()).enteredTotalCents,
    );
    body.lastElementChild?.scrollIntoView({ block: "nearest" });
  }

  private pdfSession(): void {
    if (!this.lastStored) return;
    const name = this.store.name.trim();
    if (!name) {
      const typed = window.prompt("Name for the official report?", this.store.name);
      if (typed == null) return;
      this.store = checkIn(this.store, typed);
      if (!this.store.name) return;
    }
    downloadSessionReport(sessionToReport(this.lastStored, this.store.name));
  }

  private stopTimer(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function sheetRowCount(session: TenkeySession): number {
  if (session.stackSize != null) return Math.max(session.stackSize, session.submissions.length);
  return Math.max(16, session.submissions.length + 6);
}

function liveEntryHtml(session: TenkeySession, ghost: boolean): string {
  if (session.phase === "awaiting_slide" || session.buffer.length === 0) {
    return ghost
      ? `<span class="lcd-ghost">0.00</span><span class="cursor"></span>`
      : `<span class="cursor"></span>`;
  }
  const chars = session.buffer
    .map((ch) =>
      ch.miskey ? `<span class="miskey">${escapeHtml(ch.ch)}</span>` : escapeHtml(ch.ch),
    )
    .join("");
  return `${chars}<span class="cursor"></span>`;
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function fillCheck(root: HTMLElement, check: CheckItem): void {
  root.querySelector(".check-no")!.textContent = String(check.checkNumber);
  root.querySelector(".check-payee")!.textContent = check.payee;
  root.querySelector(".check-amount")!.textContent = formatCheckAmount(check.cents);
  root.querySelector(".check-words")!.textContent = `${amountToWords(check.cents)} Dollars`;
  root.querySelector(".check-memo")!.textContent = check.memo;
  root.querySelector(".check-micr")!.textContent = micr(check);
  root.classList.toggle("is-whole", check.wholeDollar);
  const box = root.querySelector<HTMLElement>(".amount-box")!;
  box.dataset.hand = check.amountHand;
  box.dataset.size = check.amountSize;
  box.style.setProperty("--amount-tilt", String(check.amountTilt));
}

function micr(check: CheckItem): string {
  const acct = String(10_000_000 + ((check.checkNumber * 17) % 80_000_000));
  return `:${check.checkNumber}:  :021000021:  ${acct}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
