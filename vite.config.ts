import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** dist path → source path. Emitted un-hashed because crawlers and the manifest need stable URLs. */
const STATIC_FILES: Record<string, string> = {
  // JPEG export (~75 KB) of assets/brand/og-image.png (851 KB master): WhatsApp drops previews over ~300–600 KB.
  'og-image.jpg': './assets/brand/og-image.jpg',
  'manifest.webmanifest': './assets/brand/manifest.webmanifest',
  'icons/icon-192.png': './assets/brand/icons/icon-192.png',
  'icons/icon-512.png': './assets/brand/icons/icon-512.png',
  'icons/icon-maskable-512.png': './assets/brand/icons/icon-maskable-512.png',
};

function staticFiles(): Plugin {
  return {
    name: 'reharm-static-files',
    apply: 'build',
    generateBundle() {
      for (const [fileName, src] of Object.entries(STATIC_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(fileURLToPath(new URL(src, import.meta.url))) });
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nAllow: /\n' });
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
      return html
        .replace(
          '<meta property="og:image" content="og-image.jpg" />',
          `<meta property="og:image" content="${base}og-image.jpg" />\n  <meta property="og:url" content="${base}" />`,
        )
        .replace('<meta name="twitter:image" content="og-image.jpg" />', `<meta name="twitter:image" content="${base}og-image.jpg" />`);
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [staticFiles(), absoluteOgUrls(process.env.SITE_URL)],
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
