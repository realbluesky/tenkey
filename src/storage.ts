import type { PacePoint } from "./engine/series";
import type { Score } from "./engine/types";

export const STORAGE_KEY = "tenkey.v1";
const MAX_SESSIONS_PER_OPERATOR = 80;

export type StoredSession = {
  id: string;
  at: number;
  name: string;
  durationMs: number;
  stackSize: number | null;
  seed: number;
  practice: boolean;
  score: Score;
  pace?: PacePoint[];
};

export type Store = {
  name: string;
  operators: string[];
  sessions: StoredSession[];
};

const EMPTY: Store = { name: "", operators: [], sessions: [] };

export function sameOperator(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, operators: [], sessions: [] };
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 40) : "";
    const fromSessions = uniqueOperators(sessions.map((session) => session.name));
    const operators = uniqueOperators([
      ...(Array.isArray(parsed.operators) ? parsed.operators : []),
      ...fromSessions,
      name,
    ]);
    return { name, operators, sessions };
  } catch {
    return { ...EMPTY, operators: [], sessions: [] };
  }
}

export function saveStore(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function sessionsFor(store: Store, name = store.name): StoredSession[] {
  if (!name.trim()) return [];
  return store.sessions.filter((session) => sameOperator(session.name, name));
}

export function recordSession(store: Store, session: StoredSession): Store {
  const checkedIn = checkIn(store, session.name, false);
  const mine = [
    session,
    ...sessionsFor(checkedIn, session.name).filter((item) => item.id !== session.id),
  ].slice(0, MAX_SESSIONS_PER_OPERATOR);
  const others = checkedIn.sessions.filter(
    (item) => !sameOperator(item.name, session.name) && item.id !== session.id,
  );
  const next: Store = { ...checkedIn, sessions: [...mine, ...others] };
  saveStore(next);
  return next;
}

export function checkIn(store: Store, name: string, persist = true): Store {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) {
    const next = { ...store, name: "" };
    if (persist) saveStore(next);
    return next;
  }
  const existing = matchOperator(store.operators, trimmed);
  const operators = existing ? store.operators : [...store.operators, trimmed];
  const next: Store = { ...store, name: existing ?? trimmed, operators };
  if (persist) saveStore(next);
  return next;
}

export function setName(store: Store, name: string): Store {
  return checkIn(store, name);
}

export function operatorStore(store: Store): Store {
  return {
    ...store,
    sessions: sessionsFor(store),
  };
}

export function goalKey(session: StoredSession): string {
  if (session.stackSize) return `stack:${session.stackSize}`;
  return `time:${session.durationMs}`;
}

export function bestsByGoal(store: Store): StoredSession[] {
  const map = new Map<string, StoredSession>();
  for (const session of sessionsFor(store)) {
    if (session.practice) continue;
    const key = goalKey(session);
    const prev = map.get(key);
    if (!prev || better(session, prev)) map.set(key, session);
  }
  return [...map.values()].sort((a, b) => {
    const aStack = a.stackSize ?? 0;
    const bStack = b.stackSize ?? 0;
    if (aStack !== bStack) {
      if (aStack === 0) return 1;
      if (bStack === 0) return -1;
      return aStack - bStack;
    }
    return a.durationMs - b.durationMs;
  });
}

export function bestsByDuration(store: Store): Map<number, StoredSession> {
  const map = new Map<number, StoredSession>();
  for (const session of bestsByGoal(store)) {
    if (session.stackSize) continue;
    map.set(session.durationMs, session);
  }
  return map;
}

export function better(a: StoredSession, b: StoredSession): boolean {
  const aNet = a.score.netKph * a.score.amountAccuracy;
  const bNet = b.score.netKph * b.score.amountAccuracy;
  return aNet > bNet;
}

export function personalBest(
  store: Store,
  durationMs: number,
  practice: boolean,
  stackSize: number | null = null,
): StoredSession | null {
  let best: StoredSession | null = null;
  for (const session of sessionsFor(store)) {
    if (session.practice !== practice) continue;
    const sessionStack = session.stackSize ?? null;
    if ((stackSize ?? null) !== sessionStack) continue;
    if (!stackSize && session.durationMs !== durationMs) continue;
    if (!best || better(session, best)) best = session;
  }
  return best;
}

function uniqueOperators(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function matchOperator(operators: string[], name: string): string | undefined {
  return operators.find((operator) => sameOperator(operator, name));
}

export type DayGroup = {
  key: string;
  label: string;
  at: number;
  sessions: StoredSession[];
  medianKph: number;
};

export function groupSessionsByDay(sessions: StoredSession[]): DayGroup[] {
  const groups = new Map<string, StoredSession[]>();
  const order: string[] = [];
  for (const session of sessions) {
    const key = dayKey(session.at);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(session);
  }
  return order.map((key) => {
    const list = groups.get(key)!;
    const kphs = list.map((session) => session.score.netKph).sort((a, b) => a - b);
    return {
      key,
      label: dayLabel(list[0]!.at),
      at: list[0]!.at,
      sessions: list,
      medianKph: median(kphs),
    };
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
