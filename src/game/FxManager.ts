import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';
import { Data } from './Data';
import type { IGameContext } from './GameContext';
import { BaseEntity } from './entity/Entity';
import { Particle } from './entity/Particle';

/**
 * Port of `Animation` (`class/hammer/Animation.mt`):
 * steps a one-shot or looping visual FX MovieClip at 32 Hz and auto-removes it when done.
 */
export class FxAnim {
  readonly game: IGameContext;
  readonly mc: SwfMovieClip;
  fl_kill = false;
  fl_loop = false;
  fl_loopDone = false;
  fl_blink = false;

  private frame = 0;
  lifeTimer = 0;
  private blinkTimer = 0;

  constructor(game: IGameContext, x: number, y: number, link: string, depth: number) {
    this.game = game;
    this.mc = game.depthMan.attach(link, depth);
    this.mc._x = x;
    this.mc._y = y;
    this.mc.stop();
  }

  blink(): void {
    this.fl_blink = true;
  }

  stopBlink(): void {
    this.fl_blink = false;
    this.mc._alpha = 100;
  }

  destroy(): void {
    if (this.fl_kill) return;
    this.mc.removeMovieClip();
    this.fl_kill = true;
  }

  update(): void {
    if (this.fl_kill) return;

    if (this.fl_loopDone) {
      this.lifeTimer -= 1;
      if (this.lifeTimer <= 0) {
        this.destroy();
        return;
      }
    }

    if (this.fl_blink) {
      this.blinkTimer -= 1;
      if (this.blinkTimer <= 0) {
        this.mc._alpha = this.mc._alpha === 100 ? 30 : 100;
        this.blinkTimer = Data.BLINK_DURATION_FAST;
      }
    }

    this.frame += 1;
    while (this.frame >= 1) {
      if (this.mc._totalframes <= 1) {
        this.fl_loopDone = true;
        this.frame = 0;
        break;
      }
      this.mc.nextFrame();
      if (this.mc._currentframe >= this.mc._totalframes) {
        if (this.fl_loop) {
          this.mc.gotoAndStop(1);
        }
        this.fl_loopDone = true;
      }
      this.frame -= 1;
    }
  }
}

/**
 * Port of `FxManager` (`class/hammer/FxManager.mt`).
 */
export class FxManager {
  readonly game: IGameContext;
  private animList: FxAnim[] = [];
  private mcList: SwfMovieClip[] = [];
  private stack: { t: number; link: string; x: number; y: number }[] = [];
  private bgList: { id: number; subId: number | null; timer: number }[] = [];
  private fl_bg = false;

  private lastAlert: SwfMovieClip | null = null;
  /** The level name banner (`attachLevelPop`), null when none shows. */
  levelName: SwfMovieClip | null = null;
  private nameTimer = 0;
  private igMsg: SwfMovieClip | null = null;
  private igMsgTimer = 0;
  mc_exitArrow: SwfMovieClip | null = null;

  constructor(game: IGameContext) {
    this.game = game;
  }

  /** `FxManager.attachLevelPop`: only levels with a name of their own show it (2B.4). */
  attachLevelPop(name: string | null, flLabel: boolean): void {
    if (name === null) return;
    this.levelName?.removeMovieClip();
    const mc = this.game.depthMan.attach('hammer_interf_zone', Data.DP_INTERF);
    mc._x = -this.game.xOffset;
    mc._y = Data.GAME_HEIGHT - 1;
    const field = mc.getText('field');
    if (field) field.text = name;
    const label = mc.getText('label');
    if (label) label.text = flLabel ? this.game.dataStore.getStatic(13) : '';
    this.levelName = mc;
    this.nameTimer = Data.SECOND * 5;
  }

  attachAlert(str: string): SwfMovieClip {
    const mc = this.game.depthMan.attach('hurryUp', Data.DP_INTERF);
    mc._x = Data.GAME_WIDTH * 0.5;
    mc._y = Data.GAME_HEIGHT * 0.5;
    mc.setVariable('label', str);
    this.mcList.push(mc);
    this.lastAlert = mc;
    return mc;
  }

  detachLastAlert(): void {
    if (!this.lastAlert) return;
    this.mcList = this.mcList.filter((m) => m !== this.lastAlert);
    this.lastAlert.removeMovieClip();
    this.lastAlert = null;
  }

  attachHurryUp(): SwfMovieClip {
    return this.attachAlert(this.game.dataStore.getStatic(4) || 'HURRY UP!');
  }

  attachWarning(): SwfMovieClip {
    return this.attachAlert(this.game.dataStore.getStatic(12) || 'WARNING!');
  }

  attachExit(): void {
    this.detachExit();
    const mc = this.game.depthMan.attach('hammer_fx_exit', Data.DP_INTERF);
    mc._x = Data.GAME_WIDTH * 0.5;
    mc._y = Data.GAME_HEIGHT;
    // The "next level" field appears on frame 8 and shows `label`
    mc.setVariable('label', this.game.dataStore.getStatic(3));
    this.mc_exitArrow = mc;
  }

  detachExit(): void {
    this.mc_exitArrow?.removeMovieClip();
    this.mc_exitArrow = null;
  }

  attachEnter(x: number, pid: number): void {
    const mc = this.game.depthMan.attach('hammer_fx_enter', Data.DP_INTERF);
    mc._x = x;
    mc._y = 0;
    const field = mc.getText('field') ?? mc.findFirstText();
    if (field) {
      if (pid === 0) {
        field.text = '';
      } else {
        field.text = `Player ${pid}`;
        field.textColor = Data.BASE_COLORS[pid - 1] ?? 0xffffff;
      }
    }
    this.mcList.push(mc);
  }

  attachScorePop(color: number, _glowColor: number, x: number, y: number, txt: string): void {
    const anim = this.attachFx(x, y, 'popScore');
    if (!anim) return;
    anim.fl_loop = false;
    const formatted = Data.formatNumberStr(txt);
    const tf = anim.mc.getClip('label')?.getText('field');
    if (tf) tf.textColor = color;
    anim.mc.setVariable('value', formatted);
  }

  attachExplodeZone(x: number, y: number, radius: number): FxAnim | null {
    if (this.game.fl_lock) return null;
    const a = this.attachFx(x, y, 'explodeZone');
    if (a) {
      a.mc._width = radius * 2;
      a.mc._height = radius * 2;
    }
    return a;
  }

  /**
   * `FxManager.attachExplosion`: the explosion zone. The original blends it with `OVERLAY`; not
   * ported (Pixi's overlay drew it shifted and banded), so it shows as a pale disc (2C.6).
   */
  attachExplosion(x: number, y: number, radius: number): FxAnim | null {
    if (this.game.fl_lock) return null;
    const a = this.attachFx(x, y, 'explodeZone');
    if (a) {
      a.mc._width = radius * 2;
      a.mc._height = radius * 2;
    }
    return a;
  }

  attachShine(x: number, y: number): FxAnim | null {
    if (this.game.fl_lock) return null;
    const fx = this.attachFx(x, y, 'shine');
    if (fx) {
      fx.mc._xscale *= 1.5;
      fx.mc._yscale = fx.mc._xscale;
      fx.mc._xscale *= this.game.rand.random(2) * 2 - 1;
    }
    return fx;
  }

  keyRequired(kid: number): void {
    this.igMsg?.removeMovieClip();
    const mc = this.game.depthMan.attach('hammer_interf_inGameMsg', Data.DP_TOP);
    const label = mc.getText('label');
    if (label) label.text = this.game.dataStore.getStatic(40);
    const field = mc.getText('field');
    if (field) field.text = this.game.dataStore.lang.keys[kid] ?? `#${kid}`;
    this.igMsg = mc;
    this.igMsgTimer = Data.SECOND * 2;
  }

  keyUsed(kid: number): void {
    this.igMsg?.removeMovieClip();
    const mc = this.game.depthMan.attach('hammer_interf_inGameMsg', Data.DP_TOP);
    const label = mc.getText('label');
    if (label) label.text = this.game.dataStore.getStatic(41);
    const field = mc.getText('field');
    if (field) field.text = this.game.dataStore.lang.keys[kid] ?? `#${kid}`;
    this.igMsg = mc;
    this.igMsgTimer = Data.SECOND * 3;
  }

  attachFx(x: number, y: number, link: string, depth: number = Data.DP_FX): FxAnim | null {
    if (this.game.fl_lock) return null;
    const a = new FxAnim(this.game, x, y, link, depth);
    this.animList.push(a);
    return a;
  }

  /**
   * `FxManager.dust`: dust falling from a slab, skipped in low details. The draws happen even
   * when `attachFx` returns null (AS2 evaluates them, then sets nothing).
   */
  dust(cx: number, cy: number): void {
    if (!this.game.config.fl_detail) {
      return;
    }

    const rand = this.game.rand;
    const x = BaseEntity.x_ctr(cx);
    const y = BaseEntity.y_ctr(cy);
    const n = 7;
    let xMin = x - Data.CASE_WIDTH * 0.5;
    let xMax = x + Data.CASE_WIDTH * 0.5;
    if (this.game.world.getCase(cx - 1, cy) === Data.GROUND) {
      xMin -= Data.CASE_WIDTH;
    }
    if (this.game.world.getCase(cx + 1, cy) === Data.GROUND) {
      xMax += Data.CASE_WIDTH;
    }
    const wid = Math.round(xMax - xMin);
    for (let i = 0; i < n; i++) {
      const fx = this.attachFx(xMin + rand.random(wid), y, 'hammer_fx_dust');
      // `Std.random(50)+50*(...)`: the sign applies to the 50 only, as the original reads
      const xscale = rand.random(50) + 50 * (rand.random(2) * 2 - 1);
      const yscale = rand.random(80) + 10;
      const alpha = rand.random(50) + 50;
      const frame = rand.random(5) + 5;
      if (fx) {
        fx.mc._xscale = xscale;
        fx.mc._yscale = yscale;
        fx.mc._alpha = alpha;
        fx.mc.gotoAndStop(String(frame));
      }
    }
  }

  inGameParticles(id: number, x: number, y: number, n: number): void {
    this.inGameParticlesDir(id, x, y, n, null);
  }

  /**
   * `n` particles of type `id` (`PARTICLE_*`), thrown left and right in turn, or all towards
   * `dir` (its sign) when given. At most `MAX_FX` at once: past it, half as many are thrown and
   * random old ones removed. None in low details (`MAX_FX` is halved there too).
   */
  inGameParticlesDir(id: number, x: number, y: number, n: number, dir: number | null): void {
    if (this.game.fl_lock) {
      return;
    }
    if (!this.game.config.fl_detail) {
      return;
    }

    // Cleanup of the fx
    const maxFx = this.game.config.MAX_FX;
    const l = this.game.getList(Data.FX);
    if (l.length + n > maxFx) {
      n = Math.ceil(n * 0.5);
      this.game.destroySome(Data.FX, n + l.length - maxFx);
    }

    let fl_left = this.game.rand.random(2) === 0;
    for (let i = 0; i < n; i++) {
      const mc = Particle.attach(this.game, id, x, y);
      if (x <= Data.CASE_WIDTH) {
        fl_left = false;
      }
      if (x >= Data.GAME_WIDTH - Data.CASE_WIDTH) {
        fl_left = true;
      }
      fl_left = dir !== null ? dir < 0 : fl_left;

      // Rain and bubbles have no next move
      if (mc.next) {
        mc.next.dx = fl_left ? -Math.abs(mc.next.dx) : Math.abs(mc.next.dx);
      }
      fl_left = !fl_left;
    }
  }

  delayFx(t: number, x: number, y: number, link: string): void {
    this.stack.push({ t, x, y, link });
  }

  /**
   * Queues a special background shown in place of the level's for `timer` cycles (15 by
   * default). Queued backgrounds show one after the other.
   */
  attachBg(id: number, subId: number | null, timer: number | null = null): void {
    if (timer === null) {
      timer = 15;
    }
    this.bgList.push({ id, subId, timer });
  }

  detachBg(): void {
    this.fl_bg = false;
    this.game.view.detachSpecialBg();
  }

  /** Drops the queued special backgrounds and the one showing. */
  clearBg(): void {
    this.bgList = [];
    this.detachBg();
  }

  clear(): void {
    this.detachExit();
    this.levelName?.removeMovieClip();
    this.levelName = null;
    this.clearBg();
    this.igMsg?.removeMovieClip();
    this.igMsg = null;
    this.game.destroyList(Data.FX);

    for (const a of this.animList) a.destroy();
    this.animList = [];

    for (const m of this.mcList) m.removeMovieClip();
    this.mcList = [];
    this.lastAlert = null;
  }

  onNextLevel(): void {
    this.stack = [];
    this.clear();
  }

  update(): void {
    // Special backgrounds
    if (this.bgList.length > 0) {
      const b = this.bgList[0];
      if (!this.fl_bg) {
        this.fl_bg = true;
        this.game.view.attachSpecialBg(b.id, b.subId);
      }
      b.timer -= 1;
      if (b.timer <= 0) {
        this.bgList.splice(0, 1);
        this.detachBg();
      }
    }

    if (this.levelName) {
      this.nameTimer -= 1;
      if (this.nameTimer <= 0) {
        this.levelName._y += 0.7;
        if (this.levelName._y >= Data.GAME_HEIGHT + 30) {
          this.levelName.removeMovieClip();
          this.levelName = null;
        }
      }
    }

    for (let i = 0; i < this.stack.length; i++) {
      this.stack[i].t -= 1;
      if (this.stack[i].t <= 0) {
        this.attachFx(this.stack[i].x, this.stack[i].y, this.stack[i].link);
        this.stack.splice(i, 1);
        i--;
      }
    }

    for (let i = 0; i < this.animList.length; i++) {
      const a = this.animList[i];
      a.update();
      if (a.fl_kill) {
        this.animList.splice(i, 1);
        i--;
      }
    }

    if (this.igMsg) {
      this.igMsgTimer -= 1;
      if (this.igMsgTimer <= 0) {
        this.igMsg._alpha -= 2;
        if (this.igMsg._alpha <= 2) {
          this.igMsg.removeMovieClip();
          this.igMsg = null;
        }
      }
    }
  }
}
