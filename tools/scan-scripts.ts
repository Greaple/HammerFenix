/**
 * Lists what the level scripts of every set use that the engine does not handle.
 *
 *   npx tsx tools/scan-scripts.ts [--all]
 *
 * Without `--all`, `note` findings are left out. See `tools/lib/scriptScan.ts` for the kinds.
 */
import { scanAllSets, type FindingKind } from './lib/scriptScan';

const ROOT = new URL('..', import.meta.url).pathname;
const all = process.argv.includes('--all');
const findings = (await scanAllSets(ROOT)).filter((f) => all || f.kind !== 'note');

const order: FindingKind[] = ['error', 'unported', 'ignored', 'note'];
for (const kind of order) {
  const list = findings.filter((f) => f.kind === kind);
  if (list.length === 0) continue;
  console.log(`\n${kind} (${list.length})`);
  // Same detail in many levels: one line, with the levels
  const byDetail = new Map<string, string[]>();
  for (const f of list) {
    const at = byDetail.get(f.detail) ?? [];
    at.push(`${f.set}:${f.level}`);
    byDetail.set(f.detail, at);
  }
  for (const [detail, at] of byDetail) {
    const where = at.length > 6 ? `${at.slice(0, 6).join(' ')} (+${at.length - 6})` : at.join(' ');
    console.log(`  ${detail}  @ ${where}`);
  }
}
if (findings.length === 0) console.log('No findings.');
