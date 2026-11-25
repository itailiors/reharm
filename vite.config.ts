import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Emits the social share card at a stable, un-hashed path so og:image can point at it. */
function ogImage(): Plugin {
  return {
    name: 'reharm-og-image',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'og-image.png',
        source: readFileSync(fileURLToPath(new URL('./assets/brand/og-image.png', import.meta.url))),
      });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [ogImage()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
