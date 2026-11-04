import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Finding, scanAllSets } from '../tools/lib/scriptScan';

/**
 * Every level script of every set, checked against what the script engine reads
 * (`tools/scan-scripts.ts` prints the same report).
 */
describe('level scripts', async () => {
  const findings = await scanAllSets(join(__dirname, '..'));
  const details = (kind: Finding['kind']) => [
    ...new Set(findings.filter((f) => f.kind === kind).map((f) => f.detail)),
  ];

  it('are well formed and use only known nodes, attributes and ids', () => {
    expect(findings.filter((f) => f.kind === 'error')).toEqual([]);
  });

  it('only need what the port has, apart from the known missing parts', () => {
    expect(details('unported')).toEqual(['code trigger #6: SoccerBall (task 2.2)']);
  });

  it('report matches its snapshot', () => {
    const report = findings.map((f) => `${f.kind} ${f.set}:${f.level} ${f.detail}`);
    expect(report).toMatchSnapshot();
  });
});
