import { describe, expect, it } from 'vitest';
import { PersistCodec } from '../src/engine/codec/PersistCodec';
import { resultPicks } from '../src/ui/Shell';

describe('results page items (Shell resultPicks)', () => {
  it('reads $item2 of a game over, score items from 1000', () => {
    const item2: number[] = [];
    item2[13] = 1;
    item2[1007] = 3;
    const picks = resultPicks({
      kind: 'gameOver',
      score: 0,
      runId: null,
      stats: { reachedLevel: 4, item2, data: [] },
      uniqueItems: 2,
    });
    expect(picks).toEqual([
      [13, 1],
      [1007, 3],
    ]);
  });

  it('decodes the picks sent to endGame.html', () => {
    const codec = new PersistCodec();
    const special: number[] = [];
    special[13] = 2;
    const score: number[] = [];
    score[7] = 1;
    const params = codec.encode(codec.encode(special) + ':' + codec.encode(score));
    expect(resultPicks({ kind: 'exitGame', url: 'endGame.html', params })).toEqual([
      [13, 2],
      [1007, 1],
    ]);
  });
});
