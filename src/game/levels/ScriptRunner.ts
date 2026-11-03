import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { LevelData } from '../data/types';
import { BaseEntity } from '../entity/Entity';
import { ItemEntity, ScoreItem, SpecialItem } from '../entity/Item';
import type { PlayerEntity } from '../entity/Player';
import type { IGameContext } from '../GameContext';

export interface ScriptNode {
  name: string;
  attrs: Record<string, string>;
  children: ScriptNode[];
  text: string;
}

const TAG_REGEX =
  /<(\/?)([\w$]+)((?:\s+[\w$]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
const ATTR_REGEX = /([\w$]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseScriptXml(xml: string): ScriptNode[] {
  const root: ScriptNode = { name: 'root', attrs: {}, children: [], text: '' };
  const stack: ScriptNode[] = [root];
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(xml)) !== null) {
    const [, isClose, tagName, attrStr, isSelfClose, text] = match;
    if (text) {
      const trimmed = text.trim();
      if (trimmed && stack.length > 0) {
        const top = stack[stack.length - 1];
        top.text += (top.text ? ' ' : '') + trimmed;
      }
      continue;
    }

    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].name === tagName) {
        stack.pop();
      }
      continue;
    }

    const attrs: Record<string, string> = {};
    if (attrStr) {
      ATTR_REGEX.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = ATTR_REGEX.exec(attrStr)) !== null) {
        attrs[am[1]] = am[2] ?? am[3] ?? am[4] ?? '';
      }
    }

    const node: ScriptNode = { name: tagName, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!isSelfClose) {
      stack.push(node);
    }
  }

  return root.children;
}

/**
 * Port of `levels.ScriptEngine` (`class/hammer/levels/ScriptEngine.mt`).
 *
 * Drives level script execution (timed events, trigger areas, spawns, tiles, and portals)
 * and manages script-attached decorative MovieClips.
 */
export class ScriptRunner {
  static readonly T_TIMER = '$t_timer';
  static readonly T_POS = '$t_pos';
  static readonly T_ATTACH = '$attach';
  static readonly T_DO = '$do';
  static readonly T_END = '$end';
  static readonly T_BIRTH = '$birth';
  static readonly T_DEATH = '$death';
  static readonly T_EXPLODE = '$exp';
  static readonly T_ENTER = '$enter';
  static readonly T_NIGHTMARE = '$night';
  static readonly T_MIRROR = '$mirror';
  static readonly T_MULTI = '$multi';
  static readonly T_NINJA = '$ninja';

  static readonly E_SCORE = '$e_score';
  static readonly E_SPECIAL = '$e_spec';
  static readonly E_EXTEND = '$e_ext';
  static readonly E_BAD = '$e_bad';
  static readonly E_KILL = '$e_kill';
  static readonly E_TUTORIAL = '$e_tuto';
  static readonly E_MESSAGE = '$e_msg';
  static readonly E_KILLMSG = '$e_killMsg';
  static readonly E_POINTER = '$e_pointer';
  static readonly E_KILLPTR = '$e_killPt';
  static readonly E_MC = '$e_mc';
  static readonly E_PLAYMC = '$e_pmc';
  static readonly E_MUSIC = '$e_music';
  static readonly E_ADDTILE = '$e_add';
  static readonly E_REMTILE = '$e_rem';
  static readonly E_ITEMLINE = '$e_itemLine';
  static readonly E_GOTO = '$e_goto';
  static readonly E_HIDE = '$e_hide';
  static readonly E_HIDEBORDERS = '$e_hideBorders';
  static readonly E_CODETRIGGER = '$e_ctrigger';
  static readonly E_PORTAL = '$e_portal';
  static readonly E_SETVAR = '$e_setVar';
  static readonly E_OPENPORTAL = '$e_openPortal';
  static readonly E_DARKNESS = '$e_darkness';
  static readonly E_FAKELID = '$e_fakelid';

  static readonly VERBOSE_TRIGGERS: readonly string[] = [
    ScriptRunner.T_POS,
    ScriptRunner.T_EXPLODE,
    ScriptRunner.T_ENTER,
  ];

  readonly game: IGameContext;
  readonly level: LevelData;

  cycle = 0;
  bads = 0;
  fl_compile = false;
  fl_birth = false;
  fl_death = false;
  fl_safe = false;
  fl_redraw = false;
  fl_elevatorOpen = false;
  fl_firstTorch = false;
  fl_onAttach = false;
  bossDoorTimer = Data.SECOND * 1.2;

  readonly history: string[] = [];
  private baseScript: string;
  private extraScript = '';
  private activeNodes: ScriptNode[] = [];
  private readonly mcList: { sid: number; mc: SwfMovieClip }[] = [];
  private recentExp: { x: number; y: number; r: number }[] = [];
  private entries: { cx: number; cy: number }[] = [];

  constructor(game: IGameContext, level: LevelData) {
    this.game = game;
    this.level = level;
    this.baseScript = level.script || '';
  }

  destroy(): void {
    this.activeNodes = [];
    this.fl_compile = false;
    for (const item of this.mcList) {
      item.mc.removeMovieClip();
    }
    this.mcList.length = 0;
  }

  traceHistory(str: string): void {
    this.history.push(`@${Math.round(this.cycle * 10) / 10}\t: ${str}`);
  }

  onPlayerBirth(): void {
    this.fl_birth = true;
  }

  onPlayerDeath(): void {
    this.fl_death = true;
  }

  onExplode(x: number, y: number, radius: number): void {
    this.recentExp.push({ x, y, r: radius });
  }

  onEnterCase(cx: number, cy: number): void {
    this.entries.push({ cx, cy });
  }

  onLevelAttach(): void {
    this.fl_onAttach = true;
  }

  safeMode(): void {
    this.fl_safe = true;
  }

  normalMode(): void {
    this.fl_safe = false;
  }

  isVerbose(tagName: string): boolean {
    return ScriptRunner.VERBOSE_TRIGGERS.includes(tagName);
  }

  getInt(node: ScriptNode, name: string): number | null {
    const val = node.attrs[name];
    if (val === undefined || val === null || val === '') return null;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? null : n;
  }

  getString(node: ScriptNode, name: string): string | null {
    const val = node.attrs[name];
    return val === undefined || val === null || val === '' ? null : val;
  }

  addScript(xmlStr: string): void {
    const nodes = parseScriptXml(xmlStr);
    if (this.fl_compile) {
      for (const node of nodes) {
        this.activeNodes.push(node);
      }
    } else {
      this.extraScript += ' ' + xmlStr;
    }
  }

  addNode(node: ScriptNode): void {
    if (this.fl_compile) {
      this.activeNodes.push(node);
    }
  }

  isTrigger(name: string): boolean {
    return (
      name === ScriptRunner.T_TIMER ||
      name === ScriptRunner.T_POS ||
      name === ScriptRunner.T_ATTACH ||
      name === ScriptRunner.T_DO ||
      name === ScriptRunner.T_END ||
      name === ScriptRunner.T_BIRTH ||
      name === ScriptRunner.T_DEATH ||
      name === ScriptRunner.T_EXPLODE ||
      name === ScriptRunner.T_ENTER ||
      name === ScriptRunner.T_NIGHTMARE ||
      name === ScriptRunner.T_MIRROR ||
      name === ScriptRunner.T_MULTI ||
      name === ScriptRunner.T_NINJA
    );
  }

  checkTrigger(trigger: ScriptNode): boolean {
    if (!trigger.name) return false;

    switch (trigger.name) {
      case ScriptRunner.T_TIMER: {
        const t = this.getInt(trigger, '$t');
        return t !== null && this.cycle >= t;
      }

      case ScriptRunner.T_POS: {
        const x = this.getInt(trigger, '$x');
        const y = this.getInt(trigger, '$y');
        const d = this.getInt(trigger, '$d');
        if (x === null || y === null || d === null) return false;
        const fx = this.game.flipCoordCase(x);
        const players = this.game.getList(Data.PLAYER);
        for (const p of players) {
          if (!p.fl_kill && !p.fl_destroy) {
            const dist = p.distanceCase(fx, y);
            if (!Number.isNaN(dist) && dist <= d) return true;
          }
        }
        return false;
      }

      case ScriptRunner.T_ATTACH:
        return this.fl_onAttach;

      case ScriptRunner.T_DO:
        return true;

      case ScriptRunner.T_END:
        return this.game.fl_clear && this.cycle > 10;

      case ScriptRunner.T_BIRTH:
        return this.fl_birth;

      case ScriptRunner.T_DEATH:
        return this.fl_death;

      case ScriptRunner.T_EXPLODE: {
        const rawX = this.getInt(trigger, '$x');
        const rawY = this.getInt(trigger, '$y');
        if (rawX === null || rawY === null) return false;
        const x = this.game.flipCoordReal(BaseEntity.x_ctr(rawX));
        const y = BaseEntity.y_ctr(rawY);
        for (const expl of this.recentExp) {
          const sqrDist = Math.pow(x - expl.x, 2) + Math.pow(y - expl.y, 2);
          if (sqrDist <= Math.pow(expl.r, 2)) return true;
        }
        return false;
      }

      case ScriptRunner.T_ENTER: {
        const rawX = this.getInt(trigger, '$x');
        const rawY = this.getInt(trigger, '$y');
        if (rawX === null || rawY === null) return false;
        const cx = this.game.flipCoordCase(rawX);
        for (const entry of this.entries) {
          if (entry.cx === cx && entry.cy === rawY) return true;
        }
        return false;
      }

      case ScriptRunner.T_NIGHTMARE:
        return this.game.fl_nightmare;

      case ScriptRunner.T_MIRROR:
        return this.game.fl_mirror;

      case ScriptRunner.T_MULTI:
        return this.game.countList(Data.PLAYER) > 1;

      case ScriptRunner.T_NINJA:
        return this.game.fl_ninja;

      default:
        return false;
    }
  }

  executeTrigger(trigger: ScriptNode): boolean {
    this.traceHistory(trigger.name);
    for (const event of trigger.children) {
      this.executeEvent(event);
    }

    const rawRepeat = trigger.attrs['$repeat'];
    if (rawRepeat !== undefined && rawRepeat !== '') {
      let total = parseInt(rawRepeat, 10);
      if (!Number.isNaN(total)) {
        total--;
        this.traceHistory(`R ${trigger.name}: ${total}`);
        trigger.attrs['$repeat'] = String(total);

        if (total === 0) {
          return true; // remove
        }

        if (trigger.name === ScriptRunner.T_TIMER) {
          let base = trigger.attrs['$base'];
          if (!base) {
            base = trigger.attrs['$t'] ?? '0';
            trigger.attrs['$base'] = base;
          }
          const timer = parseInt(base, 10) + this.cycle;
          trigger.attrs['$t'] = String(timer);
        }
        return false; // keep
      }
    }

    this.traceHistory(`X ${trigger.name}`);
    return true; // remove by default
  }

  executeEvent(event: ScriptNode): void {
    if (!event.name) return;
    this.traceHistory(` |--${event.name}`);

    switch (event.name) {
      case ScriptRunner.E_SCORE: {
        const rawX = this.getInt(event, '$x');
        const rawY = this.getInt(event, '$y');
        if (rawX === null || rawY === null) break;
        const x = this.game.flipCoordReal(BaseEntity.x_ctr(rawX));
        const y = BaseEntity.y_ctr(rawY);
        const id = this.getInt(event, '$i') ?? 0;
        const subId = this.getInt(event, '$si');
        const mc = ScoreItem.attach(this.game, x, y, id, subId);
        if (this.getInt(event, '$inf') === 1) {
          mc.setLifeTimer(-1);
        }
        const sid = this.getInt(event, '$sid');
        if (sid !== null) {
          this.killById(sid);
          mc.scriptId = sid;
        }
        break;
      }

      case ScriptRunner.E_SPECIAL: {
        if (this.game.canAddItem() && !this.fl_safe) {
          const rawX = this.getInt(event, '$x');
          const rawY = this.getInt(event, '$y');
          if (rawX === null || rawY === null) break;
          const x = this.game.flipCoordReal(BaseEntity.x_ctr(rawX));
          const y = BaseEntity.y_ctr(rawY);
          const id = this.getInt(event, '$i') ?? 0;
          const subId = this.getInt(event, '$si');
          const mc = SpecialItem.attach(this.game, x, y, id, subId);
          if (mc) {
            if (this.getInt(event, '$inf') === 1) {
              mc.setLifeTimer(-1);
            }
            const sid = this.getInt(event, '$sid');
            if (sid !== null) {
              this.killById(sid);
              mc.scriptId = sid;
            }
          }
        }
        break;
      }

      case ScriptRunner.E_EXTEND: {
        if (this.game.canAddItem() && !this.fl_safe) {
          this.game.spawnExtend();
        }
        break;
      }

      case ScriptRunner.E_BAD: {
        if (!this.fl_safe) {
          const rawX = this.getInt(event, '$x');
          const rawY = this.getInt(event, '$y');
          if (rawX === null || rawY === null) break;
          const x = BaseEntity.x_ctr(this.game.flipCoordCase(rawX)) - Data.CASE_WIDTH * 0.5;
          const y = BaseEntity.y_ctr(rawY - 1);
          const id = this.getInt(event, '$i') ?? 0;
          const flSys = (this.getInt(event, '$sys') ?? 0) !== 0;
          const mc = this.game.attachBad(id, x, y);

          if (mc.isType(Data.BAD_CLEAR)) {
            if (flSys && this.game.world.isVisited()) {
              mc.destroy();
            } else {
              this.bads++;
              this.game.fl_clear = false;
            }
          }
          const sid = this.getInt(event, '$sid');
          if (sid !== null) {
            this.killById(sid);
            mc.scriptId = sid;
          }
        }
        break;
      }

      case ScriptRunner.E_KILL: {
        const sid = this.getInt(event, '$sid');
        this.killById(sid);
        break;
      }

      case ScriptRunner.E_TUTORIAL: {
        const id = this.getInt(event, '$id');
        const msg = id !== null ? this.game.dataStore.getStatic(id) : event.text;
        if (msg) {
          this.game.attachPop('\n' + msg, true);
        }
        break;
      }

      case ScriptRunner.E_MESSAGE: {
        const id = this.getInt(event, '$id');
        const msg = id !== null ? this.game.dataStore.getStatic(id) : event.text;
        if (msg) {
          this.game.attachPop('\n' + msg, false);
        }
        break;
      }

      case ScriptRunner.E_KILLMSG:
        this.game.killPop();
        break;

      case ScriptRunner.E_POINTER: {
        const p = this.game.getOne(Data.PLAYER) as PlayerEntity | null;
        const rawX = this.getInt(event, '$x') ?? 0;
        const cy = this.getInt(event, '$y') ?? 0;
        const cx = this.game.flipCoordCase(rawX);
        this.game.attachPointer(cx, cy, p ? p.cx : 0, p ? p.cy : 0);
        break;
      }

      case ScriptRunner.E_KILLPTR:
        this.game.killPointer();
        break;

      case ScriptRunner.E_MC: {
        const cx = this.getInt(event, '$x');
        const cy = this.getInt(event, '$y');
        const xr = this.getInt(event, '$xr');
        const yr = this.getInt(event, '$yr');
        const sid = this.getInt(event, '$sid');
        const back = this.getInt(event, '$back');
        const rawName = this.getString(event, '$n') ?? '';
        const name = rawName.startsWith('$') ? rawName.slice(1) : rawName;
        const p = this.getInt(event, '$p');

        if (sid !== null) this.killById(sid);

        let x = xr !== null ? xr : BaseEntity.x_ctr(cx ?? 0);
        let y = yr !== null ? yr : BaseEntity.y_ctr(cy ?? 0);
        x = this.game.flipCoordReal(x);
        if (this.game.fl_mirror) {
          x += Data.CASE_WIDTH;
        }

        const mc = this.game.view.attachSprite(name, x, y, back === 1);
        if (this.game.fl_mirror) {
          mc._xscale *= -1;
        }
        if ((p ?? 0) > 0) mc.play();
        else mc.stop();

        mc.getClip('sub')?.stop();

        if (name === 'torch') {
          if (!this.fl_firstTorch) {
            this.game.clearExtraHoles();
          }
          this.game.addHole(x + Data.CASE_WIDTH * 0.5, y - Data.CASE_HEIGHT * 0.5, 180);
          this.game.updateDarkness();
          this.fl_firstTorch = true;
        }

        if (sid !== null) {
          this.mcList.push({ sid, mc });
        }
        break;
      }

      case ScriptRunner.E_PLAYMC: {
        const sid = this.getInt(event, '$sid');
        this.playById(sid);
        break;
      }

      case ScriptRunner.E_MUSIC: {
        const id = this.getInt(event, '$id');
        if (id !== null) {
          this.game.playMusicTrack(id);
        }
        break;
      }

      case ScriptRunner.E_ADDTILE: {
        let cx1 = this.game.flipCoordCase(this.getInt(event, '$x1') ?? 0);
        let cy1 = this.getInt(event, '$y1') ?? 0;
        const cx2 = this.game.flipCoordCase(this.getInt(event, '$x2') ?? 0);
        const cy2 = this.getInt(event, '$y2') ?? 0;
        const rawType = this.getInt(event, '$type');
        const id = rawType !== null && rawType > 0 ? -rawType : Data.GROUND;

        while (cx1 !== cx2 || cy1 !== cy2) {
          this.game.world.forceCase(cx1, cy1, id);
          if (cx1 < cx2) cx1++;
          else if (cx1 > cx2) cx1--;
          if (cy1 < cy2) cy1++;
          else if (cy1 > cy2) cy1--;
        }
        this.game.world.forceCase(cx1, cy1, id);
        this.fl_redraw = true;
        break;
      }

      case ScriptRunner.E_REMTILE: {
        let cx1 = this.game.flipCoordCase(this.getInt(event, '$x1') ?? 0);
        let cy1 = this.getInt(event, '$y1') ?? 0;
        const cx2 = this.game.flipCoordCase(this.getInt(event, '$x2') ?? 0);
        const cy2 = this.getInt(event, '$y2') ?? 0;

        while (cx1 !== cx2 || cy1 !== cy2) {
          this.game.world.forceCase(cx1, cy1, 0);
          if (cx1 < cx2) cx1++;
          else if (cx1 > cx2) cx1--;
          if (cy1 < cy2) cy1++;
          else if (cy1 > cy2) cy1--;
        }
        this.game.world.forceCase(cx1, cy1, 0);
        this.fl_redraw = true;
        break;
      }

      case ScriptRunner.E_ITEMLINE: {
        let cx1 = this.getInt(event, '$x1') ?? 0;
        const cx2 = this.getInt(event, '$x2') ?? 0;
        const cy = this.getInt(event, '$y') ?? 0;
        const id = this.getInt(event, '$i') ?? 0;
        const subId = this.getInt(event, '$si');
        const time = this.getInt(event, '$t') ?? 1;

        let i = 0;
        let done = false;
        while (!done) {
          this.addNode({
            name: ScriptRunner.T_TIMER,
            attrs: { $t: String(this.cycle + i * time) },
            children: [
              {
                name: ScriptRunner.E_SCORE,
                attrs: {
                  $i: String(id),
                  $si: subId !== null ? String(subId) : '',
                  $x: String(cx1),
                  $y: String(cy),
                  $inf: '1',
                },
                children: [],
                text: '',
              },
            ],
            text: '',
          });

          if (cx1 === cx2) done = true;
          if (cx1 < cx2) cx1++;
          else if (cx1 > cx2) cx1--;
          i++;
        }
        break;
      }

      case ScriptRunner.E_GOTO: {
        const id = this.getInt(event, '$id');
        if (id !== null) {
          this.game.forcedGoto(id);
        }
        break;
      }

      case ScriptRunner.E_HIDE: {
        this.game.view.fl_hideTiles = this.getInt(event, '$tiles') === 1;
        this.game.view.fl_hideBorders = this.getInt(event, '$borders') === 1;
        this.game.view.redrawLevelOnly();
        break;
      }

      case ScriptRunner.E_HIDEBORDERS: {
        this.game.view.fl_hideTiles = true;
        this.game.view.redrawLevelOnly();
        break;
      }

      case ScriptRunner.E_CODETRIGGER: {
        const id = this.getInt(event, '$id');
        if (id !== null) {
          this.codeTrigger(id);
        }
        break;
      }

      case ScriptRunner.E_PORTAL: {
        if (this.game.fl_clear && this.cycle > 10) {
          const pid = this.getInt(event, '$pid') ?? 0;
          this.game.usePortal(pid, null);
        }
        break;
      }

      case ScriptRunner.E_SETVAR: {
        const name = this.getString(event, '$var');
        const value = this.getString(event, '$value');
        if (name && value !== null) {
          this.game.setDynamicVar(name, value);
        }
        break;
      }

      case ScriptRunner.E_OPENPORTAL: {
        const cx = this.getInt(event, '$x');
        const cy = this.getInt(event, '$y');
        const pid = this.getInt(event, '$pid');
        if (cx !== null && cy !== null && pid !== null) {
          this.game.openPortal(cx, cy, pid);
        }
        break;
      }

      case ScriptRunner.E_DARKNESS: {
        const v = this.getInt(event, '$v');
        this.game.forcedDarkness = v;
        this.game.updateDarkness();
        break;
      }

      case ScriptRunner.E_FAKELID: {
        const lid = this.getInt(event, '$lid');
        if (lid === null || Number.isNaN(lid)) {
          this.game.fakeLevelId = null;
          this.game.hud.hideLevel();
        } else {
          this.game.fakeLevelId = lid;
          this.game.hud.setLevel(lid);
        }
        break;
      }

      default: {
        if (this.isTrigger(event.name)) {
          this.activeNodes.push(event);
        }
        break;
      }
    }
  }

  runScript(): void {
    for (let i = 0; i < this.activeNodes.length; i++) {
      const trigger = this.activeNodes[i];
      if (this.checkTrigger(trigger)) {
        const kid = this.getInt(trigger, '$key');
        if (kid !== null && !this.game.hasKey(kid)) {
          if (this.isVerbose(trigger.name)) {
            this.game.fxMan.keyRequired(kid);
          }
        } else {
          if (kid !== null) {
            this.game.fxMan.keyUsed(kid);
          }
          const shouldRemove = this.executeTrigger(trigger);
          if (shouldRemove) {
            this.activeNodes.splice(i, 1);
            i--;
          }
        }
      }
    }

    this.fl_birth = false;
    this.fl_death = false;
    this.fl_onAttach = false;
    this.recentExp = [];
    this.entries = [];
  }

  insertBads(): number {
    let str = `<${ScriptRunner.T_DO}>`;
    for (const b of this.level.badList) {
      str += `<${ScriptRunner.E_BAD} $i="${b.id}" $x="${b.x}" $y="${b.y}" $sys="1"/>`;
    }
    str += `</${ScriptRunner.T_DO}>`;
    this.addScript(str);
    return this.level.badList.length;
  }

  insertSpecialItem(
    id: number,
    subId: number | null,
    x: number,
    y: number,
    t: number,
    repeat: number | null,
    fl_inf: boolean,
    fl_clearAtEnd: boolean,
  ): void {
    const subStr = subId === null ? '' : String(subId);
    const doStr = repeat !== null ? ` $repeat="${repeat}"` : '';
    this.addScript(
      `<${ScriptRunner.T_TIMER} $t="${this.cycle + t}"${doStr} $endClear="${fl_clearAtEnd ? '1' : '0'}">` +
        `<${ScriptRunner.E_SPECIAL} $x="${x}" $y="${y}" $i="${id}" $si="${subStr}" $inf="${fl_inf ? '1' : ''}" $sys="1"/>` +
        `</${ScriptRunner.T_TIMER}>`,
    );
  }

  insertScoreItem(
    id: number,
    subId: number | null,
    x: number,
    y: number,
    t: number,
    repeat: number | null,
    fl_inf: boolean,
    fl_clearAtEnd: boolean,
  ): void {
    const subStr = subId === null ? '' : String(subId);
    const doStr = repeat !== null ? ` $repeat="${repeat}"` : '';
    this.addScript(
      `<${ScriptRunner.T_TIMER} $t="${this.cycle + t}"${doStr} $endClear="${fl_clearAtEnd ? '1' : '0'}">` +
        `<${ScriptRunner.E_SCORE} $x="${x}" $y="${y}" $i="${id}" $si="${subStr}" $inf="${fl_inf ? '1' : ''}" $sys="1"/>` +
        `</${ScriptRunner.T_TIMER}>`,
    );
  }

  insertExtend(): void {
    this.addScript(
      `<${ScriptRunner.T_TIMER} $t="${Data.EXTEND_TIMER}" $repeat="-1" $endClear="1">` +
        `<${ScriptRunner.E_EXTEND}/>` +
        `</${ScriptRunner.T_TIMER}>`,
    );
  }

  insertPortal(cx: number, cy: number, pid: number): void {
    this.addScript(
      `<${ScriptRunner.T_POS} $x="${cx}" $y="${cy}" $d="1" $repeat="-1">` +
        `<${ScriptRunner.E_PORTAL} $pid="${pid}"/>` +
        `</${ScriptRunner.T_POS}>`,
    );
  }

  compile(): void {
    this.history.length = 0;
    this.activeNodes = parseScriptXml(`${this.baseScript} ${this.extraScript}`);
    this.normalMode();
    this.fl_compile = true;
    this.traceHistory(`first=${this.cycle}`);
    this.runScript();
  }

  clearScript(): void {
    this.activeNodes = [];
    this.baseScript = '';
    this.extraScript = '';
    this.cycle = 0;
    this.fl_compile = false;
  }

  clearEndTriggers(): void {
    for (let i = 0; i < this.activeNodes.length; i++) {
      if (this.activeNodes[i].attrs['$endClear'] === '1') {
        this.traceHistory(`eX ${this.activeNodes[i].name}`);
        this.activeNodes.splice(i, 1);
        i--;
      }
    }
  }

  reset(): void {
    this.cycle = 0;
    this.traceHistory('(r)');
  }

  killById(id: number | null): void {
    if (id === null || Number.isNaN(id)) return;
    for (const e of this.game.getList(Data.ENTITY)) {
      if (e.scriptId === id) {
        e.destroy();
      }
    }

    for (let i = 0; i < this.mcList.length; i++) {
      if (this.mcList[i].sid === id) {
        this.mcList[i].mc.removeMovieClip();
        this.mcList.splice(i, 1);
        i--;
      }
    }
  }

  playById(id: number | null): void {
    if (id === null || Number.isNaN(id)) return;
    for (const item of this.mcList) {
      if (item.sid === id) {
        item.mc.play();
        item.mc.getClip('sub')?.play();
      }
    }
  }

  codeTrigger(id: number): void {
    switch (id) {
      case 0:
        this.game.setWarpStart();
        break;

      case 1:
        this.game.huTimer -= 0.5;
        break;

      case 2:
        this.game.fxMan.detachExit();
        break;

      case 3: {
        this.playById(101);
        this.fl_elevatorOpen = true;
        const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
        for (const p of players) {
          p.lockControls(Data.SECOND * 12.5);
          p.dx = 0;
        }
        this.game.huTimer = 0;
        break;
      }

      case 4: {
        if (this.fl_elevatorOpen) {
          const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
          for (const p of players) {
            p.hide();
            p.lockControls(99999);
            this.game.huTimer = 0;
          }
          this.playById(101);
          (this.game as any).endModeTimer = Data.SECOND * 14;
          this.fl_elevatorOpen = false;
        }
        break;
      }

      case 7: {
        const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
        for (const p of players) {
          p.baseWalkAnim = Data.ANIM_PLAYER_WALK;
          p.baseStopAnim = Data.ANIM_PLAYER_STOP_L;
          p.playAnim(Data.ANIM_PLAYER_STOP_L);
        }
        break;
      }

      case 8: {
        const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
        for (const p of players) {
          p.baseWalkAnim = Data.ANIM_PLAYER_WALK_V;
          p.baseStopAnim = Data.ANIM_PLAYER_STOP_V;
          p.playAnim(Data.ANIM_PLAYER_STOP_V);
        }
        break;
      }

      case 9:
        this.game.audio.playSound('sound_boss_laugh', Data.CHAN_BAD);
        break;

      case 10: {
        const bads = this.game.getList(Data.BAD);
        for (const b of bads) {
          (b as any).setJumpDown?.(null);
        }
        break;
      }

      case 11: {
        const bads = [...this.game.getList(Data.BAD_CLEAR)];
        for (const b of bads) {
          this.game.fxMan.attachFx(b.x, b.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          b.destroy();
        }
        break;
      }

      case 12: {
        while (this.game.huState < 2) {
          const mc = this.game.onHurryUp();
          if (this.game.huState < 2) {
            mc?.removeMovieClip();
          }
        }
        break;
      }

      case 13: {
        const items = [...this.game.getList(Data.ITEM)] as ItemEntity[];
        for (const it of items) {
          this.game.fxMan.attachFx(it.x, it.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          it.destroy();
        }
        break;
      }

      case 14:
        this.game.clearExtraHoles();
        break;

      case 15:
        this.game.resetHurry();
        break;
    }
  }

  update(): void {
    if (this.fl_compile) {
      this.cycle += 1;
      this.runScript();
    }

    if (this.fl_redraw) {
      this.fl_redraw = false;
      this.game.view.redrawLevelOnly();
    }
    this.fl_firstTorch = false;
  }
}
