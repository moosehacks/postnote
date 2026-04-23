import { startFixtureServer } from './_server.js';

const TASK = 't2.1';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');

  const res = await fetch(server.url);
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  const body = await res.text();
  if (!body.includes('addEventListener')) {
    throw new Error('fixture body missing addEventListener');
  }

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
}
