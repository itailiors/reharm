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

/**
 * Link-preview crawlers need an absolute og:image URL. When SITE_URL is set (the deploy
 * workflow passes the GitHub Pages base URL), rewrite og:image to it and add og:url.
 * Without SITE_URL the relative path is kept, so local builds still work.
 */
function absoluteOgUrls(siteUrl: string | undefined): Plugin {
  return {
    name: 'reharm-absolute-og',
    apply: 'build',
    transformIndexHtml(html) {
      if (!siteUrl) return html;
      const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
      return html.replace(
        '<meta property="og:image" content="og-image.png" />',
        `<meta property="og:image" content="${base}og-image.png" />\n  <meta property="og:url" content="${base}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [ogImage(), absoluteOgUrls(process.env.SITE_URL)],
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
