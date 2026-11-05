import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import { PhysicsEntity } from './Entity';
import type { PlayerEntity } from './Player';

/**
 * Port of `entity.Item` (`class/hammer/entity/Item.mt`).
 *
 * Score and special items disable the 2-level character `Animator` and lock their
 * outer frame (`id + 1`) and optional nested `sub` frame (`subId + 1`).
 */
export class ItemEntity extends PhysicsEntity {
  id = 0;
  subId: number | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.disableAnimator();
    this.fl_alphaBlink = true;
    this.fl_largeTrigger = true;
    this.fl_strictGravity = false;
    this.minAlpha = 0;
    this.setLifeTimer(Data.ITEM_LIFE_TIME);
    this.register(Data.ITEM);
  }

  initItem(x: number, y: number, id: number, subId: number | null): void {
    this.moveTo(x, y);
    this.id = id;
    this.subId = subId;
    const frame = id >= 1000 ? id - 1000 + 1 : id + 1;
    this.mc.gotoAndStop(String(frame));
    this.sub?.gotoAndStop(String((subId ?? 0) + 1));
    this.game.fxMan.attachFx(x, y - Data.CASE_HEIGHT, 'hammer_fx_shine');
    this.endUpdate();
  }

  execute(_player: PlayerEntity): void {
    this.destroy();
  }

  override onDeathLine(): void {
    super.onDeathLine();
    this.moveTo(this.x, -30);
    this.dy = 0;
  }

  override onLifeTimer(): void {
    super.onLifeTimer();
    this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT * 0.5, 'hammer_fx_pop');
    this.game.audio.playSound('sound_pop', Data.CHAN_ITEM);
  }
}

/**
 * Port of `entity.item.ScoreItem` (`class/hammer/entity/item/ScoreItem.mt`).
 */
export class ScoreItem extends ItemEntity {
  static attach(
    game: IGameContext,
    x: number,
    y: number,
    rawId: number,
    subId: number | null,
  ): ScoreItem {
    const mc = game.depthMan.attach('hammer_item_score', Data.DP_ITEMS);
    const id = rawId >= 1000 ? rawId - 1000 : rawId;
    const item = new ScoreItem(game, mc);
    item.initItem(x, y, id, subId);
    return item;
  }

  override initItem(x: number, y: number, id: number, subId: number | null): void {
    super.initItem(x, y, id, subId);
    if (this.id === Data.CONVERT_DIAMANT) {
      this.register(Data.PERFECT_ITEM);
    }
  }

  override execute(player: PlayerEntity): void {
    let value = this.game.dataStore.scoreValues.get(this.id + 1000) ?? 0;
    this.game.audio.playSound('sound_item_score', Data.CHAN_ITEM);

    if (!value) {
      switch (this.id) {
        case 0:
          value = Data.getCrystalValue(this.subId ?? 0);
          break;
        case Data.DIAMANT:
          value = 2000;
          break;
        case Data.CONVERT_DIAMANT:
          value = Math.round(Math.min(10000, 75 * Math.pow((this.subId ?? 0) + 1, 4)));
          break;
        default:
          value = 500;
          break;
      }
    }

    player.getScore(this, value);
    this.game.pickUpScore(this.id, this.subId);

    // Display item banner when rarity > 0
    const fullId = this.id + 1000;
    let rarity = 0;
    for (const fam of this.game.dataStore.items.score) {
      const found = fam.items.find((it) => it.id === fullId);
      if (found) {
        rarity = found.rarity;
        break;
      }
    }
    if (rarity > 0) {
      this.game.attachItemName(fullId);
    }

    super.execute(player);
  }
}

/**
 * Port of `entity.item.SpecialItem` (`class/hammer/entity/item/SpecialItem.mt`).
 */
export class SpecialItem extends ItemEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.register(Data.SPECIAL_ITEM);
  }

  static attach(
    game: IGameContext,
    x: number,
    y: number,
    id: number,
    subId: number | null,
  ): SpecialItem | null {
    if (game.fl_clear && id === 0) {
      return null;
    }
    const mc = game.depthMan.attach('hammer_item_special', Data.DP_ITEMS);
    const item = new SpecialItem(game, mc);
    item.initItem(x, y, id, subId);
    return item;
  }

  override execute(player: PlayerEntity): void {
    if (this.id > 0) {
      this.game.logAction('$S' + this.id);
    }
    this.game.pickUpSpecial(this.id);
    player.executeSpecialItem(this);
    this.game.audio.playSound('sound_item_special', Data.CHAN_ITEM);
    if (this.id > 0) {
      this.game.attachItemName(this.id);
    }
    super.execute(player);
  }

  override update(): void {
    super.update();
    if (this.id !== 0 && this.game.rand.random(4) === 0) {
      const ox = this.game.rand.random(15) * (this.game.rand.random(2) * 2 - 1);
      const oy = -this.game.rand.random(10);
      const fx = this.game.fxMan.attachFx(this.x + ox, this.y + oy, 'hammer_fx_star');
      if (fx) {
        const s = 30 + this.game.rand.random(70);
        fx.mc._xscale = s;
        fx.mc._yscale = s;
      }
    }
  }
}
