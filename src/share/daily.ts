/**
 * Reharm Daily hub record (`daily:v1:reharm`).
 * Contract: ReharmLab-Dailys/design/data-contract.md §1; parsed by the hub's src/lib/records.ts.
 * The hub rolls over at LOCAL midnight; `dateKey` is the local calendar date, the same day
 * REHARM's puzzle number is derived from.
 */
import type { BadgeId, PlayerStats, SpiceTier } from '../types';
import type { HistoryEntry } from './storage';

export const DAILY_KEY = 'daily:v1:reharm';
export const DAILY_HUB_URL = 'https://itailiors.github.io/reharm-daily/';
export const DAILY_SHARE_URL = `${DAILY_HUB_URL}?open=share`;
export const LAB_CHANGES_URL = 'https://itailiors.github.io/reharm-lab/?mode=changes&from=reharm-daily';

export type DailyStatus = 'new' | 'in_progress' | 'done';

export interface LabMove {
  slug: string;
  label: string;
}

export interface DailyRecord {
  v: 1;
  gameId: 'reharm';
  dateKey: string;
  puzzleNo: number;
  status: DailyStatus;
  score: number | null;
  scoreLabel: string;
  tierIcon?: string;
  streak: number;
  bestScore: number | null;
  playedCount: number;
  progressLabel?: string;
  shareText?: string;
  labMove?: LabMove | null;
  updatedAt: number;
}

export const TIER_ICON: Record<SpiceTier, string> = {
  'radio-safe': '●',
  'jazz-standard': '◆',
  'modal-interchange': '◐',
  'deep-reharm': '▲',
};

/** REHARM badge → Reharm Lab move slug (bridge-spec §3), in priority order. */
const BADGE_TO_MOVE: ReadonlyArray<[BadgeId, LabMove]> = [
  ['tritone-sub', { slug: 'tritone-sub', label: 'Tritone Sub' }],
  ['backdoor-dominant', { slug: 'backdoor-dominant', label: 'Backdoor Dominant' }],
  ['modal-borrow', { slug: 'modal-interchange', label: 'Modal Interchange' }],
  ['chromatic-mediant', { slug: 'chromatic-mediant', label: 'Chromatic Mediant' }],
];

/** Number of open (non-anchor) bars in every puzzle. */
export const OPEN_BARS = 3;

export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function labMoveFor(badges: readonly string[]): LabMove | null {
  for (const [badge, move] of BADGE_TO_MOVE) if (badges.includes(badge)) return { ...move };
  return null;
}

type LifetimeStats = Pick<PlayerStats, 'currentStreak' | 'bestScore' | 'played'>;

function base(puzzleNo: number, stats: LifetimeStats, now: Date) {
  return {
    v: 1 as const,
    gameId: 'reharm' as const,
    dateKey: localDateKey(now),
    puzzleNo,
    streak: Math.max(0, stats.currentStreak),
    bestScore: stats.played ? stats.bestScore : null,
    playedCount: stats.played,
    updatedAt: now.getTime(),
  };
}

export function buildDoneRecord(entry: HistoryEntry, stats: LifetimeStats, now: Date = new Date()): DailyRecord {
  const icon = TIER_ICON[entry.tier];
  const pct = entry.percentileLabel;
  const tail = [icon, pct].filter(Boolean).join(' ');
  return {
    ...base(entry.puzzleNumber, stats, now),
    status: 'done',
    score: entry.total,
    scoreLabel: pct ? `${entry.total}/100 · ${pct}` : `${entry.total}/100`,
    tierIcon: icon,
    shareText: `🎛️ REHARM: ${entry.total}/100${tail ? ` · ${tail}` : ''}`,
    labMove: labMoveFor(entry.badges),
  };
}

/** `filled` = open bars holding a chord (the locked anchor never counts). 0 → status 'new'. */
export function buildProgressRecord(puzzleNo: number, filled: number, stats: LifetimeStats, now: Date = new Date()): DailyRecord {
  const n = Math.max(0, Math.min(OPEN_BARS, Math.floor(filled)));
  if (n === 0) return { ...base(puzzleNo, stats, now), status: 'new', score: null, scoreLabel: '' };
  const label = `${n}/${OPEN_BARS} bars`;
  return { ...base(puzzleNo, stats, now), status: 'in_progress', score: null, scoreLabel: label, progressLabel: label };
}

/**
 * Whether `next` may replace `prev`. A finished local day never regresses to in_progress/new:
 * Guards edge cases such as a device clock / time-zone change mid-day serving a new puzzle.
 */
export function shouldReplace(prev: Partial<DailyRecord> | null, next: DailyRecord): boolean {
  if (next.status === 'done') return true;
  if (!prev || prev.dateKey !== next.dateKey) return next.status === 'in_progress';
  if (prev.status === 'done') return false;
  if (next.status === 'new') return prev.puzzleNo === next.puzzleNo; // bars cleared on the same puzzle
  return true;
}
