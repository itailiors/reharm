/**
 * "Learn <move> in Reharm Lab" chip (ReharmLab-Dailys/design/bridge-spec.md §3).
 * Deliberately wears Reharm Lab's parchment-and-ink look in every REHARM theme, so players read
 * it as "this opens the practice notebook".
 */
import { type LabMove, labMoveFor } from '../share/daily';
import { esc } from './dom';

export const LAB_BASE_URL = 'https://itailiors.github.io/reharm-lab/';

export function labMoveUrl(move: LabMove): string {
  return `${LAB_BASE_URL}?move=${encodeURIComponent(move.slug)}&from=reharm`;
}

/** Chip markup for the badges a result unlocked, or '' when none maps to a Lab move. */
export function labChipHtml(badges: readonly string[]): string {
  const move = labMoveFor(badges);
  if (!move) return '';
  return `<a class="daily-lab-chip" href="${esc(labMoveUrl(move))}" aria-label="Learn ${esc(move.label)} in Reharm Lab (opens Reharm Lab)">
      <span class="daily-lab-mark" aria-hidden="true">RL</span>
      <span class="daily-lab-title">Learn ${esc(move.label)} in Reharm Lab</span>
      <span class="daily-lab-action" aria-hidden="true">Open Lab ↗</span>
    </a>`;
}
