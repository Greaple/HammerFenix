import { Data } from './Data';
import type { IGameContext } from './GameContext';
import { BaseEntity } from './entity/Entity';
import { SpecialItem } from './entity/Item';

/** Port of `Stat` (`class/hammer/Stat.mt`): a per-level counter and its running total. */
export class Stat {
  current = 0;
  total = 0;

  inc(n: number): void {
    this.current += n;
  }

  reset(): void {
    this.total += this.current;
    this.current = 0;
  }
}

/**
 * Port of `StatsManager` (`class/hammer/StatsManager.mt`): per-level stats (`Data.STAT_*`),
 * reset when each level starts. Only `STAT_MAX_COMBO` changes the game: the best combo of the
 * level just left sets how many extend letters the next level with special slots can drop.
 */
export class StatsManager {
  private readonly game: IGameContext;
  readonly stats: Stat[] = [];
  /** Letters the current level can drop. Set by `spreadExtend`, kept until the next call. */
  extendList: number[] = [];

  constructor(game: IGameContext) {
    this.game = game;
    for (let i = 0; i < 50; i++) {
      this.stats[i] = new Stat();
    }
  }

  // Reading

  read(id: number): number {
    return this.stats[id].current;
  }

  getTotal(id: number): number {
    return this.stats[id].total;
  }

  // Writing

  write(id: number, n: number): void {
    this.stats[id].current = n;
  }

  inc(id: number, n: number): void {
    this.stats[id].inc(n);
  }

  /** Adds each current value to its total and sets it back to 0. */
  reset(): void {
    for (let i = 0; i < this.stats.length; i++) {
      this.stats[i].reset();
    }
  }

  /** Number of distinct letters for the current level: 1, plus 1 per combo step above 1, max 7. */
  countExtend(): number {
    let nb = 1;
    // The original's bonus letter for a super item (`STAT_SUPAITEM`) is commented out.
    if (this.read(Data.STAT_MAX_COMBO) >= 2) {
      nb += this.read(Data.STAT_MAX_COMBO) - 1;
    }
    return Math.min(7, nb);
  }

  /** Adds the extend timer to the level script and draws its distinct letters. */
  spreadExtend(): void {
    const nb = this.countExtend();

    if (nb > 0) {
      this.game.scriptRunner?.insertExtend();

      this.extendList = [];
      const l: boolean[] = [];

      for (let i = 0; i < nb; i++) {
        let id: number;
        do {
          id = this.game.randMan.draw(Data.RAND_EXTENDS_ID) ?? 0;
        } while (l[id] === true);
        l[id] = true;
        this.extendList.push(id);
      }
    }
  }

  /** Drops one of the level's letters on a random ground spot (script event `$e_ext`). */
  attachExtend(): SpecialItem | null {
    if (this.game.fl_clear) {
      return null;
    }
    const pt = this.game.world.getGround(
      this.game.rand.random(Data.LEVEL_WIDTH),
      this.game.rand.random(Data.LEVEL_HEIGHT),
    );
    const x = BaseEntity.x_ctr(pt.x);
    const y = BaseEntity.y_ctr(pt.y);
    const id = this.extendList[this.game.rand.random(this.extendList.length)];
    return SpecialItem.attach(this.game, x, y, 0, id);
  }
}
