import type { BadgeId, PlayerStats, SpiceTier, UserSettings } from '../types';
import { BADGE_IDS } from '../types';

export interface HistoryEntry {
  puzzleNumber: number;
  dateISO: string;
  symbols: string[];
  total: number;
  rarity: number;
  melodyColor: number;
  bassFlow: number;
  tier: SpiceTier;
  percentileLabel: string;
  badges: BadgeId[];
  barTiers: SpiceTier[];
}

export interface DraftEntry {
  puzzleNumber: number;
  symbols: (string | null)[];
  /** Custom Piano Mode voicings per bar (MIDI). */
  voicings?: (number[] | null)[];
}

export interface MetaState {
  seenHowTo: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  consonantHelper: true,
  isMuted: false,
  reducedMotion: false,
  inputMode: 'palette',
};

const PREFIX = 'reharm:v1:';
const K = {
  settings: `${PREFIX}settings`,
  history: `${PREFIX}history`,
  draft: `${PREFIX}draft`,
  meta: `${PREFIX}meta`,
} as const;

/** Minimal key/value backend (window.localStorage or an in-memory map in tests). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** localStorage when available (it can throw in private mode / blocked storage). */
export function browserKV(): KV {
  try {
    const ls = window.localStorage;
    const probe = `${PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryKV();
  }
}

function read<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(kv: KV, key: string, value: unknown): void {
  try {
    kv.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode: ignore, the game still works for this session */
  }
}

export class ReharmStore {
  constructor(private readonly kv: KV) {}

  loadSettings(): UserSettings {
    const s = read<Partial<UserSettings>>(this.kv, K.settings, {});
    return { ...DEFAULT_SETTINGS, ...s };
  }

  saveSettings(s: UserSettings): void {
    write(this.kv, K.settings, s);
  }

  loadHistory(): Record<number, HistoryEntry> {
    return read<Record<number, HistoryEntry>>(this.kv, K.history, {});
  }

  getResult(puzzleNumber: number): HistoryEntry | null {
    return this.loadHistory()[puzzleNumber] ?? null;
  }

  /** Records a solve. The first lock of a puzzle is final (daily-game rules). */
  recordResult(entry: HistoryEntry): HistoryEntry {
    const h = this.loadHistory();
    const existing = h[entry.puzzleNumber];
    if (existing) return existing;
    h[entry.puzzleNumber] = entry;
    write(this.kv, K.history, h);
    this.clearDraft();
    return entry;
  }

  loadDraft(puzzleNumber: number): DraftEntry | null {
    const d = read<DraftEntry | null>(this.kv, K.draft, null);
    return d && d.puzzleNumber === puzzleNumber ? d : null;
  }

  saveDraft(d: DraftEntry): void {
    write(this.kv, K.draft, d);
  }

  clearDraft(): void {
    try {
      this.kv.removeItem(K.draft);
    } catch {
      /* ignore */
    }
  }

  loadMeta(): MetaState {
    return { seenHowTo: false, ...read<Partial<MetaState>>(this.kv, K.meta, {}) };
  }

  saveMeta(m: MetaState): void {
    write(this.kv, K.meta, m);
  }

  stats(todayNumber: number): PlayerStats {
    return computeStats(this.loadHistory(), todayNumber);
  }
}

export function emptyBadgeCounts(): Record<BadgeId, number> {
  return Object.fromEntries(BADGE_IDS.map((id) => [id, 0])) as Record<BadgeId, number>;
}

/** Derive all stats from history so they can never drift out of sync. */
export function computeStats(history: Record<number, HistoryEntry>, todayNumber: number): PlayerStats {
  const entries = Object.values(history).sort((a, b) => a.puzzleNumber - b.puzzleNumber);
  const solved = new Set(entries.map((e) => e.puzzleNumber));
  const dist = { radioSafe: 0, jazzStandard: 0, modalInterchange: 0, deepReharm: 0 };
  const badgeCounts = emptyBadgeCounts();
  let sum = 0;
  let best = 0;
  for (const e of entries) {
    sum += e.total;
    best = Math.max(best, e.total);
    if (e.total >= 90) dist.deepReharm++;
    else if (e.total >= 75) dist.modalInterchange++;
    else if (e.total >= 50) dist.jazzStandard++;
    else dist.radioSafe++;
    for (const b of e.badges) if (b in badgeCounts) badgeCounts[b]++;
  }
  // Current streak: consecutive solves ending today (or yesterday if today is still open).
  let cursor = solved.has(todayNumber) ? todayNumber : todayNumber - 1;
  let currentStreak = 0;
  while (solved.has(cursor)) {
    currentStreak++;
    cursor--;
  }
  let maxStreak = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const e of entries) {
    run = e.puzzleNumber === prev + 1 ? run + 1 : 1;
    prev = e.puzzleNumber;
    maxStreak = Math.max(maxStreak, run);
  }
  return {
    played: entries.length,
    currentStreak,
    maxStreak,
    averageScore: entries.length ? Math.round(sum / entries.length) : 0,
    bestScore: best,
    spiceDistribution: dist,
    badgeCounts,
  };
}
