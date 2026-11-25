/**
 * Zero-backend share fragment: `#42:CMaj7.AbMaj7.Db7s11.CMaj9` (optionally `@Name`).
 * Chord roots are always flat-spelled, so `#` only appears in extensions (always followed by a digit)
 * and can be written as `s` without colliding with `sus`.
 */
import { type Chord, parseChord } from '../theory';

export interface DecodedMix {
  puzzleNumber: number;
  symbols: [string, string, string, string];
  chords: [Chord, Chord, Chord, Chord];
  senderName: string | null;
}

const MAX_NAME = 24;

export function encodeSymbol(symbol: string): string {
  return symbol.replace(/#/g, 's').replace(/ø/g, 'h').replace(/\//g, '_');
}

export function decodeSymbol(token: string): string {
  // "sus4"/"sus2" end in s+digit too, so never decode an s that closes "sus".
  return token.replace(/(?<!su)s(?=\d)/g, '#').replace(/h/g, 'ø').replace(/_/g, '/');
}

export function sanitizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, MAX_NAME);
  return clean || null;
}

/** Build the fragment (without the leading '#'). */
export function encodeMix(puzzleNumber: number, symbols: readonly string[], senderName?: string | null): string {
  if (symbols.length !== 4) throw new Error('A mix has exactly 4 bars');
  const body = `${Math.floor(puzzleNumber)}:${symbols.map(encodeSymbol).join('.')}`;
  const name = sanitizeName(senderName);
  return name ? `${body}@${encodeURIComponent(name)}` : body;
}

/** Parse a location hash. Returns null for anything that is not a valid 4-chord mix. */
export function decodeMix(hash: string): DecodedMix | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const m = /^(\d{1,6}):([A-Za-z0-9._\-]+)(?:@(.{1,120}))?$/.exec(raw);
  if (!m) return null;
  const puzzleNumber = Number(m[1]);
  if (!Number.isInteger(puzzleNumber) || puzzleNumber < 1) return null;
  const tokens = m[2]!.split('.');
  if (tokens.length !== 4) return null;
  const chords: Chord[] = [];
  for (const t of tokens) {
    const c = parseChord(decodeSymbol(t));
    if (!c) return null;
    chords.push(c);
  }
  let senderName: string | null = null;
  if (m[3]) {
    try {
      senderName = sanitizeName(decodeURIComponent(m[3]));
    } catch {
      senderName = null;
    }
  }
  return {
    puzzleNumber,
    symbols: chords.map((c) => c.symbol) as DecodedMix['symbols'],
    chords: chords as DecodedMix['chords'],
    senderName,
  };
}
