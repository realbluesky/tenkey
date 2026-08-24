import type { Score } from "./engine/types";

export const STORAGE_KEY = "tenkey.v1";
const MAX_SESSIONS_PER_OPERATOR = 80;

export type StoredSession = {
  id: string;
  at: number;
  name: string;
  durationMs: number;
  seed: number;
  practice: boolean;
  score: Score;
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

export function bestsByDuration(store: Store): Map<number, StoredSession> {
  const map = new Map<number, StoredSession>();
  for (const session of sessionsFor(store)) {
    if (session.practice) continue;
    const prev = map.get(session.durationMs);
    if (!prev || better(session, prev)) map.set(session.durationMs, session);
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
): StoredSession | null {
  let best: StoredSession | null = null;
  for (const session of sessionsFor(store)) {
    if (session.durationMs !== durationMs) continue;
    if (session.practice !== practice) continue;
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
