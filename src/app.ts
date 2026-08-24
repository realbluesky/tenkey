import {
  amountToWords,
  formatCheckAmount,
  formatClock,
  formatKph,
  formatMoney,
  formatPct,
  goalLabel,
  kphBand,
  TenkeySession,
} from "./engine";
import { VERSION } from "./version";
import type { CheckItem, KeyInput } from "./engine";
import { downloadBestsReport, downloadSessionReport, sessionToReport } from "./pdf";
import {
  bestsByGoal,
  checkIn,
  loadStore,
  operatorStore,
  personalBest,
  recordSession,
  sessionsFor,
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
  private practice = true;
  private session: TenkeySession | null = null;
  private lastStored: StoredSession | null = null;
  private timer: number | null = null;
  private slideTimer: number | null = null;
  private front: HTMLElement | null = null;
  private waiting: HTMLElement | null = null;
  private pendingLeave: HTMLElement | null = null;

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
    $("#pdf-bests-btn").addEventListener("click", () => downloadBestsReport(operatorStore(this.store)));
    $("#pdf-bests-setup-btn").addEventListener("click", () =>
      downloadBestsReport(operatorStore(this.store)),
    );

    document.addEventListener("keydown", (event) => this.onKey(event));
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
    $("#bests-heading").textContent = who ? `${who} · exam bests` : "Personal bests (exam)";
    $("#recent-heading").textContent = who ? `${who} · recent` : "Recent";
    const bests = bestsByGoal(this.store);
    $("#bests-empty").hidden = bests.length > 0;
    $("#bests-empty").textContent = who
      ? `No exam sessions for ${who} yet.`
      : "No exam sessions on this station yet.";
    const list = $("#bests-list");
    list.innerHTML = bests
      .map((session) => {
        return `<li><span>${goalLabel(session)}</span><strong>${formatKph(session.score.netKph)} KPH</strong><em>${formatPct(session.score.amountAccuracy)}</em></li>`;
      })
      .join("");

    const history = $("#history-body");
    const rows = sessionsFor(this.store).slice(0, 8);
    $("#history-empty").hidden = rows.length > 0;
    $("#history-empty").textContent = who
      ? `No sessions for ${who} yet.`
      : "Check in to see your scores.";
    const historyTable = document.querySelector<HTMLElement>(".history");
    if (historyTable) historyTable.hidden = rows.length === 0;
    history.innerHTML = rows
      .map((session) => {
        const dur = goalLabel(session);
        const when = new Date(session.at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        return `<tr>
          <td>${when}</td>
          <td>${session.practice ? "Practice" : "Exam"}</td>
          <td>${dur}</td>
          <td>${formatKph(session.score.netKph)}</td>
          <td>${formatPct(session.score.amountAccuracy)}</td>
        </tr>`;
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
    for (const btn of document.querySelectorAll<HTMLElement>("#mode-pills [data-mode]")) {
      const isPractice = btn.dataset.mode === "practice";
      btn.classList.toggle("is-on", isPractice === this.practice);
    }
    $("#stack-field").hidden = this.lengthKind !== "stack";
    $("#duration-field").hidden = this.lengthKind !== "time";
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
      seed,
    });
    this.lastStored = null;
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
    if (event.repeat && (input.key === "Tab" || input.key === "+")) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.abort();
      return;
    }
    event.preventDefault();
    this.send(input);
  }

  private send(input: KeyInput): void {
    if (!this.session || this.screen !== "test") return;
    const now = performance.now();
    const result = this.session.handleKey(input, now);
    if (result.finished) {
      this.complete();
      return;
    }
    if (result.unslid) this.playUnslide();
    else if (result.slid) this.playSlide(result.recycle);
    else if (result.recycle) this.finishSlideSwap();
    this.renderTape();
    this.renderEntry();
    this.renderHint();
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
    const now = this.session.endedAt ?? performance.now();
    const score = this.session.snapshot(now);
    const stored: StoredSession = {
      id: this.session.id,
      at: Date.now(),
      name: this.store.name,
      durationMs: this.session.durationMs,
      stackSize: this.session.stackSize,
      seed: this.session.seed,
      practice: this.session.practice,
      score,
    };
    this.store = recordSession(this.store, stored);
    this.lastStored = stored;
    this.show("results");
  }

  private renderTest(updateCheck: boolean): void {
    if (updateCheck) this.renderChecks();
    this.renderTape();
    this.renderEntry();
    this.renderHint();
    this.renderLive(performance.now());
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
  }

  private renderTape(): void {
    if (!this.session) return;
    const tape = $("#tape");
    const lines = this.session.submissions.slice(-12).map((sub) => {
      const amount = sub.parsedCents != null ? formatCheckAmount(sub.parsedCents) : sub.raw;
      const mark = this.session!.practice ? (sub.correct ? " ✓" : " ✗") : "";
      const cls = this.session!.practice ? (sub.correct ? "ok" : "bad") : "";
      return `<div class="tape-line ${cls}"><span>${amount}</span><span>+${mark}</span></div>`;
    });
    tape.innerHTML = lines.join("") || `<div class="tape-line dim"><span>ready</span><span></span></div>`;
    tape.scrollTop = tape.scrollHeight;
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
    const last =
      this.session.stackSize != null &&
      this.session.hasCurrentCheck &&
      this.session.currentIndex === this.session.stackSize - 1;
    if (this.session.phase === "armed") {
      hint.textContent = last
        ? "Last check. First digit starts."
        : "First digit starts the clock.";
    } else if (this.session.phase === "awaiting_slide") {
      hint.textContent = last ? "Tab — last check, then you're done." : "Tab — slide this check aside.";
    } else if (this.session.phase === "awaiting_plus") {
      hint.textContent =
        this.session.stackSize != null && this.session.entryIndex === this.session.stackSize - 1
          ? "+ to add the last check and finish. Shift+Tab brings it back."
          : "+ to add. Shift+Tab brings the check back.";
    } else if (this.session.buffer.length === 0) {
      hint.textContent = "Enter the amount, then + or Tab.";
    } else if (this.session.buffer.some((ch) => ch.miskey)) {
      hint.textContent = "Backspace the red keys, then +.";
    } else {
      hint.textContent = "+ to add, or Tab to slide first.";
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
    $("#res-mode").textContent = `${stored.practice ? "Practice" : "Exam"} · ${goalLabel(stored)}`;
    $("#res-gross").textContent = formatKph(score.grossKph);
    $("#res-numeric").textContent = formatKph(score.numericKph);
    $("#res-corr-acc").textContent = formatPct(score.correctedAccuracy);
    $("#res-corrected").textContent = String(score.correctedErrors);
    $("#res-uncorrected").textContent = String(score.uncorrectedErrors);
    $("#res-checks").textContent = `${score.checksCorrect} / ${score.checksSubmitted}`;
    $("#res-entered").textContent = formatMoney(score.enteredTotalCents);
    $("#res-true").textContent = formatMoney(score.trueTotalCents);
    const match = score.enteredTotalCents === score.trueTotalCents;
    $("#res-total-note").textContent = match
      ? "Entered total matches the checks you submitted."
      : "Entered total does not match the true total of those checks.";
    $("#res-total-note").classList.toggle("bad", !match);
    const leftover = $("#res-leftover");
    if (score.leftoverRaw) {
      leftover.hidden = false;
      leftover.textContent = `Unfinished next check when time expired (${score.leftoverRaw}) — not counted as an error.`;
    } else {
      leftover.hidden = true;
      leftover.textContent = "";
    }

    const best = personalBest(
      this.store,
      stored.durationMs,
      stored.practice,
      stored.stackSize ?? null,
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
