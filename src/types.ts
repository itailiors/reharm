/**
 * REHARM — shared TypeScript contracts.
 * Copied from design/claude-code-handoff.md §3 and design/motion-spec.md §3.
 * Additive fields are marked "(impl)" and are optional so the contract stays intact.
 */

export type NoteName =
  | 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F'
  | 'Gb' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export type ChordQuality =
  | 'Maj' | 'm' | '7' | 'maj7' | 'm7'
  | 'ø7' | 'dim' | 'sus' | 'aug' | 'alt';

export type SpiceTier =
  | 'radio-safe'
  | 'jazz-standard'
  | 'modal-interchange'
  | 'deep-reharm';

export type SlotLifecycleState =
  | 'locked'
  | 'empty'
  | 'queued'
  | 'legal'
  | 'clash';

export type BadgeId =
  | 'tritone-sub'
  | 'backdoor-dominant'
  | 'modal-borrow'
  | 'chromatic-mediant'
  | 'sharp11-melody'
  | 'smooth-bass'
  | 'radio-safe'
  | 'jazz-trench';

export type BarIndex = 0 | 1 | 2 | 3;

export interface MelodyNote {
  id: string;
  midi: number;
  pitchLabel: string;
  barIndex: BarIndex;
  startBeat: number;
  durationBeats: number;
  yNorm: number;
  isAccent: boolean;
}

export interface ConsonantHint {
  safeRoots: NoteName[];
  safeQualities: ChordQuality[];
  safeMidiNotes: number[];
}

export interface DailyPuzzle {
  puzzleNumber: number;
  dateISO: string;
  keyLabel: string;
  bpm: number;
  lockedBarIndex: BarIndex;
  anchorChord: ChordInput;
  melody: MelodyNote[];
  consonantHintsByBar: Record<BarIndex, ConsonantHint>;
  /** (impl) tonic pitch class + mode used by the theory engine */
  tonic?: NoteName;
  mode?: 'major' | 'minor';
  /** (impl) bank id, for debugging only — never shown */
  bankId?: string;
}

export interface ChordInput {
  root: NoteName;
  quality: ChordQuality;
  slashBass?: NoteName;
  /** Compact display symbol, e.g., "Db7#11", "CMaj7/E" */
  symbol: string;
  customMidiNotes?: number[];
}

export interface BarSlotState {
  barIndex: BarIndex;
  state: SlotLifecycleState;
  chord: ChordInput | null;
  queuedChord?: ChordInput | null;
  tier?: SpiceTier;
  deviceLabel?: string;
  clashReason?: string;
  clashSuggestions?: string[];
}

export interface UnlockedBadge {
  id: BadgeId;
  title: string;
  reason: string;
}

export interface ScoreBreakdown {
  total: number;
  rarity: number;
  melodyColor: number;
  bassFlow: number;
  avgBassSemitones: number;
  percentile: number;
  percentileLabel: string;
  overallTier: SpiceTier;
  axisSummaries: {
    rarity: string;
    melodyColor: string;
    bassFlow: string;
  };
  unlockedBadges: UnlockedBadge[];
}

export type BarTierOrLocked = SpiceTier | 'locked';

export interface SharePayload {
  puzzleNumber: number;
  url: string;
  emojiCardText: string;
  score: number;
  percentileLabel: string;
  barTiers: [BarTierOrLocked, BarTierOrLocked, BarTierOrLocked, BarTierOrLocked];
  badges: BadgeId[];
}

export interface ReceiverCompareData {
  senderName: string;
  puzzleNumber: number;
  hasPlayerSolvedToday: boolean;
  friendBars: BarSlotState[];
  friendScore: ScoreBreakdown;
  playerBars?: BarSlotState[];
  playerScore?: ScoreBreakdown;
}

export interface PlayerStats {
  played: number;
  currentStreak: number;
  maxStreak: number;
  averageScore: number;
  bestScore: number;
  spiceDistribution: {
    radioSafe: number;
    jazzStandard: number;
    modalInterchange: number;
    deepReharm: number;
  };
  badgeCounts: Record<BadgeId, number>;
}

export interface UserSettings {
  theme: 'dark' | 'light';
  consonantHelper: boolean;
  isMuted: boolean;
  reducedMotion: boolean;
  inputMode: 'palette' | 'piano';
  /** (impl) Keyboard sound. */
  piano: 'rhodes' | 'grand' | 'felt' | 'wurli';
  /** (impl) How each bar's chord is played. */
  chordStyle: 'block' | 'arpeggio' | 'outside-in' | 'random' | 'bach';
  /** (impl) Melody sound. */
  melodyTone: 'bell' | 'vibes' | 'flute' | 'synth';
}

export interface ReharmVisualHooks {
  onTransportFrame(normalizedLoopProgress: number, activeNoteIds: string[]): void;
  onBeat(barIndex: BarIndex, beatIndex: 0 | 1 | 2 | 3): void;
  onBarStart(barIndex: BarIndex): void;
  onChordSwap(
    barIndex: BarIndex,
    state: 'queued' | 'legal' | 'clash' | 'empty',
    tier?: SpiceTier,
  ): void;
  onClash(barIndex: BarIndex, clashReason: string, suggestions?: string[]): void;
  onScoreReveal(breakdown: {
    total: number;
    rarity: number;
    melodyColor: number;
    bassFlow: number;
    percentileLabel: string;
    unlockedBadges: string[];
  }): void;
}

export const BAR_INDICES: readonly BarIndex[] = [0, 1, 2, 3] as const;

export const BADGE_IDS: readonly BadgeId[] = [
  'tritone-sub',
  'backdoor-dominant',
  'modal-borrow',
  'chromatic-mediant',
  'sharp11-melody',
  'smooth-bass',
  'radio-safe',
  'jazz-trench',
] as const;
