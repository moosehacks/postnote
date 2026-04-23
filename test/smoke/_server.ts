import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

/**
 * Starts a local HTTP server rooted at test/fixtures/.
 * @param defaultFile - filename served at GET /. Optional.
 * @returns { url, close }
 */
export async function startFixtureServer(
  defaultFile?: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const rawPath = req.url ?? '/';
      const filePath =
        rawPath === '/' && defaultFile
          ? join(FIXTURE_DIR, defaultFile)
          : join(FIXTURE_DIR, rawPath);

      try {
        const body = readFileSync(filePath);
        const mime = MIME[extname(filePath)] ?? 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });

    server.once('error', reject);
  });
}
