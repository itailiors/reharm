import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Emits the social share card at a stable, un-hashed path so og:image can point at it.
 * Ships the JPEG export (~75 KB) of assets/brand/og-image.png (the 851 KB design master):
 * WhatsApp drops preview images over roughly 300–600 KB.
 */
function ogImage(): Plugin {
  return {
    name: 'reharm-og-image',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'og-image.jpg',
        source: readFileSync(fileURLToPath(new URL('./assets/brand/og-image.jpg', import.meta.url))),
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
        '<meta property="og:image" content="og-image.jpg" />',
        `<meta property="og:image" content="${base}og-image.jpg" />\n  <meta property="og:url" content="${base}" />`,
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
