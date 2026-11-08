import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev server only: `POST /__save?file=name.png` writes the request body to
 * `.cache/level-sheets/name.png`. The level contact sheets (`tools/level-sheets.html`, roadmap
 * 2B.2) save their pictures with it.
 */
export function saveEndpoint(): Plugin {
  const dir = join(import.meta.dirname, '../.cache/level-sheets');
  return {
    name: 'hammerfenix-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const file = new URL(req.url ?? '', 'http://x').searchParams.get('file') ?? '';
        if (req.method !== 'POST' || !/^[\w.-]+\.png$/.test(file)) {
          res.statusCode = 400;
          res.end('POST a .png with ?file=name.png');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, file), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}
