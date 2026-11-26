import { describe, expect, it } from 'vitest';
import { labChipHtml, labMoveUrl } from '../src/ui/labChip';

describe('Reharm Lab chip', () => {
  it('links tritone-sub to its Lab move', () => {
    const html = labChipHtml(['smooth-bass', 'tritone-sub']);
    expect(html).toContain('class="daily-lab-chip"');
    expect(html).toContain('href="https://itailiors.github.io/reharm-lab/?move=tritone-sub&amp;from=reharm"');
    expect(html).toContain('Learn Tritone Sub in Reharm Lab');
    expect(html).toContain('Open Lab ↗');
  });

  it('maps modal-borrow to the modal-interchange move', () => {
    const html = labChipHtml(['modal-borrow']);
    expect(html).toContain('?move=modal-interchange&amp;from=reharm');
    expect(html).toContain('Learn Modal Interchange in Reharm Lab');
    expect(labMoveUrl({ slug: 'modal-interchange', label: 'Modal Interchange' })).toBe(
      'https://itailiors.github.io/reharm-lab/?move=modal-interchange&from=reharm',
    );
  });

  it('renders nothing without a Lab move', () => {
    expect(labChipHtml([])).toBe('');
    expect(labChipHtml(['smooth-bass', 'radio-safe', 'sharp11-melody', 'jazz-trench'])).toBe('');
  });
});
