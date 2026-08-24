import type { Score } from "./engine/types";

export const STORAGE_KEY = "tenkey.v1";

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
  sessions: StoredSession[];
};

const EMPTY: Store = { name: "", sessions: [] };

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, sessions: [] };
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.slice(0, 80) : [],
    };
  } catch {
    return { ...EMPTY, sessions: [] };
  }
}

export function saveStore(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function recordSession(store: Store, session: StoredSession): Store {
  const next: Store = {
    ...store,
    sessions: [session, ...store.sessions.filter((item) => item.id !== session.id)].slice(0, 80),
  };
  saveStore(next);
  return next;
}

export function setName(store: Store, name: string): Store {
  const next = { ...store, name: name.trim().slice(0, 40) };
  saveStore(next);
  return next;
}

export function bestsByDuration(store: Store): Map<number, StoredSession> {
  const map = new Map<number, StoredSession>();
  for (const session of store.sessions) {
    if (session.practice) continue;
    const prev = map.get(session.durationMs);
    if (!prev || better(session, prev)) map.set(session.durationMs, session);
  }
  return map;
}

export function better(a: StoredSession, b: StoredSession): boolean {
  const aNet = a.score.netKph * a.score.uncorrectedAccuracy;
  const bNet = b.score.netKph * b.score.uncorrectedAccuracy;
  return aNet > bNet;
}

export function personalBest(store: Store, durationMs: number, practice: boolean): StoredSession | null {
  let best: StoredSession | null = null;
  for (const session of store.sessions) {
    if (session.durationMs !== durationMs) continue;
    if (session.practice !== practice) continue;
    if (!best || better(session, best)) best = session;
  }
  return best;
}
