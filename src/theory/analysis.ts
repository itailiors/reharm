import type { SpiceTier } from '../types';
import { type Chord, chordCorePcs, isDominant, isMajorType, isMinorType } from './chords';
import { type KeyContext, borrowedLabel, degreeOf, isDiatonic, romanFor } from './key';
import { mod12 } from './pitch';

export type DeviceKind =
  | 'tritone-sub'
  | 'backdoor-dominant'
  | 'chromatic-mediant'
  | 'modal-borrow'
  | 'ii-v'
  | 'secondary-dominant'
  | 'passing-diminished'
  | 'deceptive-cadence'
  | 'authentic-cadence'
  | 'plagal-cadence'
  | 'predominant';

export interface Device {
  kind: DeviceKind;
  /** Source bar and resolution-target bar (target wraps 3 -> 0 because the loop repeats). */
  from: number;
  to: number;
  tier: SpiceTier;
  label: string;
  /** Bars whose Spice Tier this device colours. */
  owners: number[];
}

export const TIER_ORDER: readonly SpiceTier[] = ['radio-safe', 'jazz-standard', 'modal-interchange', 'deep-reharm'];
export const tierRank = (t: SpiceTier): number => TIER_ORDER.indexOf(t);
export const maxTier = (a: SpiceTier, b: SpiceTier): SpiceTier => (tierRank(a) >= tierRank(b) ? a : b);

export const TIER_LABEL: Record<SpiceTier, string> = {
  'radio-safe': '● Safe',
  'jazz-standard': '◆ Jazz',
  'modal-interchange': '◐ Modal',
  'deep-reharm': '▲ Deep',
};

export const TIER_NAME: Record<SpiceTier, string> = {
  'radio-safe': 'Radio Safe',
  'jazz-standard': 'Jazz Standard',
  'modal-interchange': 'Modal Interchange',
  'deep-reharm': 'Deep Reharm',
};

const sameChord = (a: Chord, b: Chord) => a.symbol === b.symbol;
const isSeventhMinor = (c: Chord) =>
  (c.type.kind === 'minor' && (c.type.family === 'm7')) || c.type.kind === 'halfdim';

function triadCore(c: Chord): Set<number> {
  // First three body tones (root, 3rd, 5th)
  return new Set(chordCorePcs(c).slice(0, 3));
}

/** All functional devices formed by moving from chord a (bar i) to chord b (bar j). */
export function devicesForPair(key: KeyContext, a: Chord, b: Chord, i: number, j: number): Device[] {
  if (sameChord(a, b)) return [];
  const out: Device[] = [];
  const fall5 = mod12(b.root - a.root) === 5; // a resolves down a fifth to b
  const degA = degreeOf(key, a.root);
  const degB = degreeOf(key, b.root);
  const tonicB = degB === 0;
  const aDia = isDiatonic(key, a);
  const bDia = isDiatonic(key, b);
  const bBorrow = borrowedLabel(key, b) !== null;
  const borrowA = borrowedLabel(key, a);
  const romA = romanFor(key, a);
  const romB = romanFor(key, b);
  const push = (kind: DeviceKind, tier: SpiceTier, label: string, owners: number[]) =>
    out.push({ kind, from: i, to: j, tier, label, owners });

  if (isDominant(a)) {
    if (mod12(a.root - b.root) === 1) {
      push('tritone-sub', 'deep-reharm', `Tritone Sub (${romA} → ${romB})`, [i]);
    } else if (mod12(b.root - a.root) === 2 && (isMajorType(b) || tonicB)) {
      push('backdoor-dominant', 'deep-reharm', `Backdoor Dominant (${romA} → ${romB})`, [i]);
    } else if (fall5 && tonicB) {
      push('authentic-cadence', 'jazz-standard', `${romA} → ${romB} Cadence`, [i]);
    } else if (fall5 && (bDia || bBorrow)) {
      push('secondary-dominant', 'jazz-standard', `Secondary Dominant (V7/${romB.replace(/(maj7|7|ø7|°|\+|sus)$/, '')})`, [i]);
    }
  } else if (fall5 && tonicB && degA === 7 && isMajorType(a)) {
    push('authentic-cadence', 'radio-safe', `Authentic Cadence (V → I)`, [i]);
  }

  if (isSeventhMinor(a) && isDominant(b) && fall5) {
    push('ii-v', 'jazz-standard', `${romA} → ${romB}`, [i, j]);
  }
  if ((a.type.kind === 'dim') && mod12(b.root - a.root) === 1) {
    push('passing-diminished', 'jazz-standard', `Passing Diminished (${a.symbol} → ${b.symbol})`, [i]);
  }
  if (key.mode === 'major' && degA === 7 && (isDominant(a) || isMajorType(a)) && degB === 9 && isMinorType(b)) {
    push('deceptive-cadence', 'jazz-standard', 'Deceptive Cadence (V → vi)', [i]);
  }
  if (degA === 5 && tonicB && !isDominant(a) && (isMajorType(a) || isMinorType(a))) {
    push('plagal-cadence', 'radio-safe', `Plagal Cadence (${romA} → I)`, [i]);
  }
  if (aDia && (degA === 5 || degA === 2) && degB === 7 && (isMajorType(b) || isDominant(b)) && !isDominant(a)) {
    push('predominant', 'radio-safe', `Pre-dominant (${romA} → ${romB})`, [i]);
  }

  if (borrowA && (bDia || bBorrow)) {
    push('modal-borrow', 'modal-interchange', `Modal Borrow (${borrowA})`, [i]);
  }

  // Chromatic mediant: same-quality roots a third apart sharing exactly one common tone,
  // anchored to the key (one side is the tonic, or a borrowed chord meets a diatonic one).
  const rootInt = mod12(b.root - a.root);
  const keyed = degA === 0 || tonicB || (borrowA !== null && bDia) || (bBorrow && aDia);
  if ([3, 4, 8, 9].includes(rootInt) && !(aDia && bDia) && keyed) {
    const sameQuality = (isMajorType(a) && isMajorType(b)) || (isMinorType(a) && isMinorType(b));
    if (sameQuality) {
      const ta = triadCore(a);
      const common = [...triadCore(b)].filter((p) => ta.has(p)).length;
      if (common === 1) {
        push('chromatic-mediant', 'deep-reharm', `Chromatic Mediant (${romA} → ${romB})`, [bDia ? i : j]);
      }
    }
  }
  return out;
}

export interface BarAnalysis {
  tier: SpiceTier;
  deviceLabel?: string;
  /** Non-diatonic chord with no functional explanation (anti-cheese penalty). */
  unexplainedChromatic: boolean;
  /** Dominant that never resolves (anti-cheese penalty). */
  unresolvedDominant: boolean;
}

export interface ProgressionAnalysis {
  devices: Device[];
  bars: (BarAnalysis | null)[];
}

/**
 * Analyse a 4-bar loop. Empty bars (null) are skipped; a chord whose neighbour is still empty
 * is never marked unresolved (its resolution is pending).
 */
export function analyzeProgression(key: KeyContext, chords: readonly (Chord | null)[]): ProgressionAnalysis {
  const n = chords.length;
  const devices: Device[] = [];
  for (let i = 0; i < n; i++) {
    const a = chords[i];
    const j = (i + 1) % n;
    const b = chords[j];
    if (a && b) devices.push(...devicesForPair(key, a, b, i, j));
  }
  const bars = chords.map((c, i): BarAnalysis | null => {
    if (!c) return null;
    const owned = devices.filter((d) => d.owners.includes(i));
    const involved = devices.filter((d) => d.from === i || d.to === i);
    const next = chords[(i + 1) % n];
    const dia = isDiatonic(key, c);
    let tier: SpiceTier = dia && c.type.intervals.length <= 3 ? 'radio-safe' : 'jazz-standard';
    let deviceLabel: string | undefined;
    let bestRank = -1;
    for (const d of owned) {
      if (tierRank(d.tier) > bestRank) {
        bestRank = tierRank(d.tier);
        tier = maxTier(tier, d.tier);
        deviceLabel = d.label;
      }
    }
    const resolvesOut = devices.some((d) => d.from === i && d.kind !== 'modal-borrow' && d.kind !== 'chromatic-mediant');
    const pending = !next;
    const unexplainedChromatic = !dia && involved.length === 0 && !pending;
    const unresolvedDominant = isDominant(c) && !resolvesOut && !pending && !unexplainedChromatic;
    if (unexplainedChromatic) deviceLabel = 'Unresolved colour';
    return { tier, deviceLabel, unexplainedChromatic, unresolvedDominant };
  });
  return { devices, bars };
}

const TIER_BASE: Record<SpiceTier | 'none', number> = {
  none: 6,
  'radio-safe': 10,
  'jazz-standard': 26,
  'modal-interchange': 36,
  'deep-reharm': 44,
};

export interface RarityResult {
  rarity: number;
  topTier: SpiceTier | null;
  kinds: DeviceKind[];
  chainBonus: number;
  penalty: number;
}

/** Harmonic Rarity (0..50): coupled strictly to recognised functional devices. */
export function rarityScore(analysis: ProgressionAnalysis): RarityResult {
  const { devices, bars } = analysis;
  let topTier: SpiceTier | null = null;
  for (const d of devices) topTier = topTier ? maxTier(topTier, d.tier) : d.tier;
  const kinds = [...new Set(devices.map((d) => d.kind))];
  const extras = Math.min(6, 3 * Math.max(0, kinds.length - 1));
  // Chains: ii-V that then resolves (ii-V-I), or iv -> bVII7 -> I backdoor chain.
  let chainBonus = 0;
  for (const d of devices) {
    if (d.kind === 'ii-v' && devices.some((e) => e.from === d.to && ['authentic-cadence', 'secondary-dominant', 'tritone-sub', 'backdoor-dominant'].includes(e.kind))) chainBonus = 2;
    if (d.kind === 'backdoor-dominant' && devices.some((e) => e.to === d.from && e.kind === 'modal-borrow')) chainBonus = 2;
  }
  let penalty = 0;
  for (const b of bars) {
    if (!b) continue;
    if (b.unexplainedChromatic) penalty += 6;
    else if (b.unresolvedDominant) penalty += 3;
  }
  const base = TIER_BASE[topTier ?? 'none'];
  const rarity = Math.max(0, Math.min(50, base + extras + chainBonus - penalty));
  return { rarity, topTier, kinds, chainBonus, penalty };
}
