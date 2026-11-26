import type { BadgeId, BarIndex, BarTierOrLocked, ScoreBreakdown, SharePayload, SpiceTier } from '../types';
import { BADGE_META } from '../theory';
import { encodeMix } from './codec';

export const TIER_EMOJI: Record<BarTierOrLocked, string> = {
  locked: '🔒',
  'radio-safe': '🟢',
  'jazz-standard': '✨',
  'modal-interchange': '🟣',
  'deep-reharm': '🔥',
};

/** "https://reharm.app/#42:..." -> "reharm.app/#42:..." for compact display. */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '');

export function bassFlowWord(avg: number): { word: string; emoji: string } {
  if (avg <= 2.5) return { word: 'Smooth', emoji: '🧈' };
  if (avg <= 4) return { word: 'Flowing', emoji: '🌊' };
  return { word: 'Leaping', emoji: '🦘' };
}

export function buildSharePayload(args: {
  puzzleNumber: number;
  symbols: readonly string[];
  barTiers: readonly SpiceTier[];
  lockedBarIndex: BarIndex;
  score: Pick<ScoreBreakdown, 'total' | 'percentileLabel' | 'avgBassSemitones'> & { badges: BadgeId[] };
  baseUrl: string;
  senderName?: string | null;
}): SharePayload {
  const { puzzleNumber, symbols, barTiers, lockedBarIndex, score, baseUrl } = args;
  const url = `${baseUrl.replace(/#.*$/, '')}#${encodeMix(puzzleNumber, symbols, args.senderName)}`;
  const tiers = barTiers.map((t, i) => (i === lockedBarIndex ? 'locked' : t)) as SharePayload['barTiers'];
  const bars = tiers.map((t, i) => `Bar ${i + 1} ${TIER_EMOJI[t]}`).join(' | ');
  const badgeLine = score.badges.length
    ? `Badges: ${score.badges.map((b) => `${BADGE_META[b].emoji} ${BADGE_META[b].title}`).join(' · ')}`
    : 'Badges: — (hunting pins tomorrow)';
  const flow = bassFlowWord(score.avgBassSemitones);
  const lines = [
    `🎛️ REHARM #${puzzleNumber} — ${score.total}/100 (${score.percentileLabel})`,
    bars,
    badgeLine,
    `Bassline Flow: ${flow.emoji} ${flow.word} (${score.avgBassSemitones} st avg)`,
    // Full URL: without https:// some chat apps don't make it a link.
    `▶ Hear my mix: ${url}`,
  ];
  return {
    puzzleNumber,
    url,
    emojiCardText: lines.join('\n'),
    score: score.total,
    percentileLabel: score.percentileLabel,
    barTiers: tiers,
    badges: [...score.badges],
  };
}
