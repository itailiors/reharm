import type {
  BadgeId, BarIndex, MelodyNote, ScoreBreakdown, SpiceTier, UnlockedBadge,
} from '../types';
import { DEVICE_PLAIN, type ProgressionAnalysis, analyzeProgression, rarityScore, tierRank } from './analysis';
import {
  type Chord, bassPc, chordPcs, hasInterval, isDominant, makeChord, typeBySuffix, chordTypeFor,
} from './chords';
import { type KeyContext, isDiatonic } from './key';
import { checkedBarNotes, describeClash, findClashes, barNotes, relToRoot } from './legality';
import { mod12, pcDistance, pcName } from './pitch';

export interface PuzzleContext {
  key: KeyContext;
  melody: readonly MelodyNote[];
  lockedBarIndex: BarIndex;
}

// ---------------------------------------------------------------------------
// Melody colour
// ---------------------------------------------------------------------------

/** True when the interval is part of the chord body (root..7th), not an upper tension. */
const isBody = (chord: Chord, semis: number): boolean => chord.type.intervals.includes(semis);

/** Name of a melody note's role over a chord (for copy). */
export function intervalRole(chord: Chord, pc: number): string {
  const rel = relToRoot(chord, pc);
  switch (rel) {
    case 0: return 'root';
    case 1: return 'b9';
    case 2: return isBody(chord, 2) ? '2nd' : '9th';
    case 3: return isBody(chord, 3) ? 'minor 3rd' : '#9';
    case 4: return '3rd';
    case 5: return isBody(chord, 5) ? '4th' : '11th';
    case 6: return isBody(chord, 6) ? 'b5' : '#11';
    case 7: return '5th';
    case 8: return isBody(chord, 8) ? '#5' : isDominant(chord) ? 'b13' : 'b6';
    case 9: return isBody(chord, 9) ? (chord.type.kind === 'dim' ? 'bb7' : '6th') : '13th';
    case 10: return 'b7';
    default: return 'maj7';
  }
}

/** Colour value (0..5) of a melody pitch over a chord: roots are plain, upper extensions are lush. */
export function colorPoints(chord: Chord, pc: number): number {
  const rel = relToRoot(chord, pc);
  const dom = isDominant(chord);
  switch (rel) {
    case 0: return 0;
    case 1: return dom ? 4 : 0;
    case 2: return isBody(chord, 2) ? 2.5 : 4;
    case 3: return isBody(chord, 3) ? 2 : dom ? 4 : 0;
    case 4: return 2;
    case 5: return isBody(chord, 5) ? 2 : 3.5;
    case 6: return isBody(chord, 6) ? 2 : 5;
    case 7: return 1;
    case 8: return isBody(chord, 8) ? 2.5 : dom ? 4 : 3;
    case 9: return isBody(chord, 9) ? 3 : 4;
    case 10: return 3;
    default: return 3;
  }
}

interface ColorMoment { note: MelodyNote; chord: Chord; points: number }

function colorMoments(ctx: PuzzleContext, chords: readonly Chord[]): ColorMoment[] {
  const out: ColorMoment[] = [];
  for (let bar = 0 as BarIndex; bar < 4; bar = (bar + 1) as BarIndex) {
    if (bar === ctx.lockedBarIndex) continue;
    const chord = chords[bar]!;
    for (const note of checkedBarNotes(ctx.melody, bar)) {
      out.push({ note, chord, points: colorPoints(chord, note.midi) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bass flow & voice retention
// ---------------------------------------------------------------------------

// index = semitone distance 0..6: chromatic/stepwise best, strong 4th/5th root motion decent, tritone leaps worst
const BASS_STEP_POINTS = [2.4, 6, 5.8, 4.4, 4, 4.6, 1];
export const SMOOTH_BASS_THRESHOLD = 20;

export interface BassResult { bassFlow: number; avg: number; path: string[]; smooth: boolean }

export function bassFlowScore(chords: readonly Chord[]): BassResult {
  const basses = chords.map(bassPc);
  let bassPart = 0;
  let distSum = 0;
  let retention = 0;
  const steps = chords.length - 1;
  for (let i = 0; i < steps; i++) {
    const d = pcDistance(basses[i]!, basses[i + 1]!);
    distSum += d;
    bassPart += BASS_STEP_POINTS[d]!;
    const a = chordPcs(chords[i]!);
    const b = [...chordPcs(chords[i + 1]!)];
    const common = b.filter((p) => a.has(p)).length;
    retention += common / Math.min(a.size, b.length);
  }
  const retentionPart = (retention / steps) * 10;
  const bassFlow = Math.max(0, Math.min(25, Math.round(bassPart + retentionPart)));
  const avg = Math.round((distSum / steps) * 10) / 10;
  return { bassFlow, avg, path: basses.map((p) => pcName(p)), smooth: bassFlow >= SMOOTH_BASS_THRESHOLD };
}

// ---------------------------------------------------------------------------
// Percentile mapping (zero-backend: calibrated curve)
// ---------------------------------------------------------------------------

const PCT_CURVE: [number, number][] = [
  [100, 1], [95, 2], [91, 4], [85, 9], [75, 20], [60, 40], [50, 55], [30, 80], [0, 99],
];

export function percentileFor(total: number): number {
  const t = Math.max(0, Math.min(100, total));
  for (let i = 0; i < PCT_CURVE.length - 1; i++) {
    const [hiS, hiP] = PCT_CURVE[i]!;
    const [loS, loP] = PCT_CURVE[i + 1]!;
    if (t <= hiS && t >= loS) {
      const f = hiS === loS ? 0 : (t - loS) / (hiS - loS);
      return Math.max(1, Math.round(loP + (hiP - loP) * f));
    }
  }
  return 99;
}

export function tierForTotal(total: number): SpiceTier {
  if (total >= 90) return 'deep-reharm';
  if (total >= 75) return 'modal-interchange';
  if (total >= 50) return 'jazz-standard';
  return 'radio-safe';
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export const BADGE_META: Record<BadgeId, { title: string; emoji: string; hint: string }> = {
  'tritone-sub': { title: 'Tritone Sub', emoji: '⚡', hint: 'Resolve a dominant down a half step (bII7 → I).' },
  'backdoor-dominant': { title: 'Backdoor Dominant', emoji: '🚪', hint: 'Resolve a dominant up a whole step (bVII7 → I).' },
  'modal-borrow': { title: 'Modal Borrow', emoji: '🌙', hint: 'Borrow iv, bVI, bIII or bVII from the parallel mode.' },
  'chromatic-mediant': { title: 'Chromatic Mediant', emoji: '🌈', hint: 'Move a third between same-quality chords (I → bVI, I → III).' },
  'sharp11-melody': { title: '#11 Melody', emoji: '💎', hint: 'Make a held melody note the #11 of a major or dominant chord.' },
  'smooth-bass': { title: 'Smooth Bass', emoji: '🧈', hint: 'Keep the bassline stepwise or chromatic (18+ Bass Flow).' },
  'radio-safe': { title: 'Radio Safe', emoji: '📻', hint: 'Lock a clean all-diatonic progression with a real cadence.' },
  'jazz-trench': { title: 'Jazz Trench', emoji: '🦑', hint: 'Score 95 or higher.' },
};

export interface FullScore extends ScoreBreakdown {
  analysis: ProgressionAnalysis;
  barTiers: SpiceTier[];
}

/**
 * Names the bars behind a rarity penalty, e.g. "−12: Cø7 (Bar 2) and Db7#11 (Bar 3) are outside the key
 * with no move in or out (−6 each)". A bare "−12 unresolved" left players guessing which bar to fix.
 */
function penaltyDetail(chords: readonly Chord[], analysis: ProgressionAnalysis, total: number): string {
  const name = (i: number) => `${chords[i]!.symbol} (Bar ${i + 1})`;
  const list = (xs: number[]) => (xs.length > 1 ? `${xs.slice(0, -1).map(name).join(', ')} and ${name(xs[xs.length - 1]!)}` : name(xs[0]!));
  const outside = analysis.bars.flatMap((b, i) => (b?.unexplainedChromatic ? [i] : []));
  const loose = analysis.bars.flatMap((b, i) => (b?.unresolvedDominant ? [i] : []));
  const parts: string[] = [];
  if (outside.length) parts.push(`${list(outside)} ${outside.length > 1 ? 'are' : 'is'} outside the key with no move in or out (−6${outside.length > 1 ? ' each' : ''})`);
  if (loose.length) parts.push(`${list(loose)} never resolve${loose.length > 1 ? '' : 's'} (−3${loose.length > 1 ? ' each' : ''})`);
  return `−${total}: ${parts.join('; ')}`;
}

/** Krillion-style 3-axis score for a complete 4-bar progression. */
export function scoreProgression(ctx: PuzzleContext, chords: readonly Chord[]): FullScore {
  if (chords.length !== 4) throw new Error('scoreProgression expects 4 chords');
  const analysis = analyzeProgression(ctx.key, chords);
  const rar = rarityScore(analysis);

  // Clashing bars cannot score colour (Lock Mix normally prevents this).
  const moments = colorMoments(ctx, chords).filter((m) => findClashes(m.chord, [m.note]).length === 0);
  const avg = moments.length ? moments.reduce((s, m) => s + m.points, 0) / moments.length : 3;
  const melodyColor = Math.round(25 * Math.min(1, avg / 4.4));

  const bass = bassFlowScore(chords);
  const total = rar.rarity + melodyColor + bass.bassFlow;
  const percentile = percentileFor(total);

  // Summaries
  const ranked = [...analysis.devices].sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
  const labels = [...new Set(ranked.map((d) => d.label))].slice(0, 2);
  const plain = ranked[0] ? ` — ${DEVICE_PLAIN[ranked[0].kind]}` : '';
  const penalty = rar.penalty ? penaltyDetail(chords, analysis, rar.penalty) : '';
  const raritySummary = labels.length
    ? labels.join(' + ') + plain + (penalty ? ` · ${penalty}` : '')
    : penalty ? `No functional devices · ${penalty}` : 'In-key chords, but no named move between them yet';
  const best = [...moments].sort((a, b) => b.points - a.points)[0];
  const melodySummary = best
    ? `Melody ${pcName(best.note.midi)} lands on the ${intervalRole(best.chord, best.note.midi)} of ${best.chord.symbol}`
    : 'Melody sits on plain chord tones';
  const word = bass.avg <= 2.5 ? 'Smooth' : bass.avg <= 4 ? 'Flowing' : 'Leaping';
  const bassSummary = `${word} ${bass.avg}-semitone average motion (${bass.path.join(' → ')})`;

  // Badges
  const badges: UnlockedBadge[] = [];
  const add = (id: BadgeId, reason: string) => badges.push({ id, title: BADGE_META[id].title, reason });
  const firstOf = (kind: string) => analysis.devices.find((d) => d.kind === kind);
  const tri = firstOf('tritone-sub');
  if (tri) add('tritone-sub', `${chords[tri.from]!.symbol} resolves to ${chords[tri.to]!.symbol}`);
  const back = firstOf('backdoor-dominant');
  if (back) add('backdoor-dominant', `${chords[back.from]!.symbol} slides up to ${chords[back.to]!.symbol}`);
  const bor = firstOf('modal-borrow');
  if (bor) add('modal-borrow', `${chords[bor.from]!.symbol} ${bor.label.replace('Modal Borrow ', 'borrowed ')}`);
  const med = firstOf('chromatic-mediant');
  if (med) add('chromatic-mediant', `${chords[med.from]!.symbol} → ${chords[med.to]!.symbol} third shift`);
  const sharp11 = moments.find((m) => relToRoot(m.chord, m.note.midi) === 6 && hasInterval(m.chord, 4) && !isBody(m.chord, 6));
  if (sharp11) add('sharp11-melody', `${pcName(sharp11.note.midi)} rings as #11 over ${sharp11.chord.symbol}`);
  if (bass.smooth) add('smooth-bass', `${bass.avg} st avg bass motion`);
  const allDiatonic = chords.every((c) => isDiatonic(ctx.key, c));
  const popCadence = analysis.devices.some((d) => d.tier === 'radio-safe');
  if (allDiatonic && popCadence && rar.penalty === 0) add('radio-safe', 'Clean diatonic cadence');
  if (total >= 95) add('jazz-trench', `${total}/100 — deep in the trench`);

  return {
    total,
    rarity: rar.rarity,
    melodyColor,
    bassFlow: bass.bassFlow,
    avgBassSemitones: bass.avg,
    percentile,
    percentileLabel: `Top ${percentile}% Spice`,
    overallTier: tierForTotal(total),
    axisSummaries: { rarity: raritySummary, melodyColor: melodySummary, bassFlow: bassSummary },
    unlockedBadges: badges,
    analysis,
    barTiers: analysis.bars.map((b) => b!.tier),
  };
}

// ---------------------------------------------------------------------------
// Extension colouring: the palette builds plain chords; the melody tells us which
// upper extension is actually sounding, so we name and voice it (Db7 + G melody -> Db7#11).
// ---------------------------------------------------------------------------

const COLORIZE: Record<string, (tensions: Set<number>) => string | null> = {
  '7': (t) => (t.has(2) && t.has(6) ? '9#11' : t.has(6) ? '7#11' : t.has(9) ? '13' : t.has(2) ? '9' : null),
  Maj7: (t) => (t.has(2) && t.has(6) ? 'Maj9#11' : t.has(6) ? 'Maj7#11' : t.has(2) ? 'Maj9' : null),
  m7: (t) => (t.has(5) ? 'm11' : t.has(2) ? 'm9' : null),
  '': (t) => (t.has(2) ? 'add9' : null),
  m: (t) => (t.has(2) ? 'madd9' : null),
};

export function colorize(chord: Chord, notes: readonly MelodyNote[]): Chord {
  const rule = COLORIZE[chord.type.suffix];
  if (!rule) return chord;
  const pcs = chordPcs(chord);
  const tensions = new Set(
    notes.filter((n) => n.isAccent || n.durationBeats >= 1).map((n) => relToRoot(chord, n.midi)).filter((r) => !pcs.has(mod12(chord.root + r))),
  );
  const suffix = rule(tensions);
  if (!suffix) return chord;
  const type = chordTypeFor(suffix);
  return type ? makeChord(chord.root, type, chord.bass) : chord;
}

// ---------------------------------------------------------------------------
// Live bar evaluation + constructive clash suggestions
// ---------------------------------------------------------------------------

export interface BarEvaluation {
  state: 'legal' | 'clash';
  tier: SpiceTier;
  deviceLabel?: string;
  clashReason?: string;
  suggestions: string[];
  message: string;
}

const SUGGESTION_SUFFIXES = ['', 'm', 'Maj7', 'm7', '7', '9', 'Maj9', 'm9', '7#11', '13', 'ø7', 'dim7', 'sus4', '6'];

export function suggestFixes(
  ctx: PuzzleContext,
  chords: readonly (Chord | null)[],
  bar: BarIndex,
  rejected: Chord | null,
  max = 3,
): string[] {
  const notes = barNotes(ctx.melody, bar);
  const scored: { chord: Chord; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const suffix of SUGGESTION_SUFFIXES) {
      const cand = makeChord(root, typeBySuffix(suffix));
      if (findClashes(cand, notes).length) continue;
      const trial = chords.map((c, i) => (i === bar ? cand : c));
      const analysis = analyzeProgression(ctx.key, trial);
      const devs = analysis.devices.filter((d) => d.from === bar || d.to === bar);
      const bestTier = devs.reduce((m, d) => Math.max(m, tierRank(d.tier) + 1), 0);
      let score = bestTier * 1.6 - cand.type.rank * 0.4;
      if (rejected && cand.root === rejected.root) score += 4;
      if (isDiatonic(ctx.key, cand)) score += 1.5;
      if (analysis.bars[bar]?.unexplainedChromatic) score -= 5;
      scored.push({ chord: colorize(cand, notes), score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const roots = new Set<number>();
  for (const s of scored) {
    if (out.length >= max) break;
    if (roots.has(s.chord.root) || (rejected && s.chord.symbol === rejected.symbol)) continue;
    roots.add(s.chord.root);
    out.push(s.chord.symbol);
  }
  return out;
}

export function evaluateBar(
  ctx: PuzzleContext,
  chords: readonly (Chord | null)[],
  bar: BarIndex,
  chord: Chord,
): BarEvaluation {
  const notes = barNotes(ctx.melody, bar);
  // Lead with the most prominent rub (longest held note).
  const clashes = findClashes(chord, notes).sort((a, b) => b.note.durationBeats - a.note.durationBeats);
  const trial = chords.map((c, i) => (i === bar ? chord : c));
  const analysis = analyzeProgression(ctx.key, trial);
  const ba = analysis.bars[bar]!;
  if (clashes.length) {
    const suggestions = suggestFixes(ctx, chords, bar, chord);
    const reason = describeClash(bar, chord, clashes[0]!);
    const tip = suggestions.length ? ` Try ${listJoin(suggestions)}.` : '';
    return { state: 'clash', tier: ba.tier, clashReason: reason, suggestions, message: `⚠ ${reason}${tip}` };
  }
  const moments = checkedBarNotes(ctx.melody, bar).map((n) => ({ n, p: colorPoints(chord, n.midi) }));
  const best = moments.sort((a, b) => b.p - a.p)[0];
  const colour = best
    ? best.p >= 4
      ? ` creates ${intervalRole(chord, best.n.midi)} tension over ${pcName(best.n.midi)} melody`
      : ` holds ${pcName(best.n.midi)} melody as the ${intervalRole(chord, best.n.midi)}`
    : '';
  const device = ba.deviceLabel ? ` · ${ba.deviceLabel}${ba.devicePlain ? ` (${ba.devicePlain})` : ''}` : '';
  return {
    state: 'legal',
    tier: ba.tier,
    deviceLabel: ba.deviceLabel,
    suggestions: [],
    message: `✓ Bar ${bar + 1} · ${chord.symbol}${colour}${device}`,
  };
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}
