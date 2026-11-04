import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { LevelData } from '../data/types';
import { SoccerBall } from '../entity/Bomb';
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

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

function decodeEntities(v: string): string {
  return v.replace(/&(lt|gt|quot|apos|amp);/g, (e) => ENTITIES[e]);
}

/**
 * Parses a level script like Flash's `XML` class does. An end tag that does not close the open
 * node stops the parse, and the nodes read so far are kept (Flash sets status -10). Problems are
 * pushed to `errors` when given.
 */
export function parseScriptXml(xml: string, errors?: string[]): ScriptNode[] {
  const root: ScriptNode = { name: 'root', attrs: {}, children: [], text: '' };
  const stack: ScriptNode[] = [root];
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(xml)) !== null) {
    const [, isClose, tagName, attrStr, isSelfClose, text] = match;
    if (text) {
      const trimmed = text.trim();
      if (trimmed) {
        const top = stack[stack.length - 1];
        if (top === root) errors?.push(`text outside any node: "${trimmed}"`);
        top.text += (top.text ? ' ' : '') + decodeEntities(trimmed);
      }
      continue;
    }

    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].name === tagName) {
        stack.pop();
        continue;
      }
      errors?.push(`mismatched end tag </${tagName}>: the rest of the script is not read`);
      return root.children;
    }

    const attrs: Record<string, string> = {};
    if (attrStr) {
      ATTR_REGEX.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = ATTR_REGEX.exec(attrStr)) !== null) {
        attrs[am[1]] = decodeEntities(am[2] ?? am[3] ?? am[4] ?? '');
      }
    }

    const node: ScriptNode = { name: tagName, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!isSelfClose) {
      stack.push(node);
    }
  }

  if (stack.length > 1) {
    errors?.push(`unclosed node <${stack[stack.length - 1].name}>`);
  }
  return root.children;
}

/** `XMLNode.toString()`: writes nodes back as XML. */
export function serializeScript(nodes: ScriptNode[]): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return nodes
    .map((n) => {
      const attrs = Object.entries(n.attrs)
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join('');
      const inner = esc(n.text) + serializeScript(n.children);
      return inner ? `<${n.name}${attrs}>${inner}</${n.name}>` : `<${n.name}${attrs} />`;
    })
    .join('');
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

  /** Code triggers (`codeTrigger`) the port does not run yet, with the task that adds them. */
  static readonly UNPORTED_CODE_TRIGGERS: Readonly<Record<number, string>> = {};

  readonly game: IGameContext;
  readonly data: LevelData;

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

  history: string[] = [];
  /**
   * The compiled script: the root's child nodes, each one a trigger. Null until `compile()` and
   * after `destroy()` / `clearScript()`.
   */
  script: ScriptNode[] | null = null;
  private baseScript: string;
  private extraScript = '';
  /** Script attached MCs. */
  private readonly mcList: { sid: number | null; mc: SwfMovieClip }[] = [];
  private recentExp: { x: number; y: number; r: number }[] = [];
  private entries: { cx: number; cy: number }[] = [];

  constructor(game: IGameContext, data: LevelData) {
    this.game = game;
    this.data = data;
    this.baseScript = data.script;
  }

  destroy(): void {
    this.script = null;
    this.fl_compile = false;
  }

  traceHistory(str: string): void {
    this.history.push(`@${Math.round(this.cycle * 10) / 10}\t: ${str}`);
  }

  // *** EVENTS ***

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

  isVerbose(t: string): boolean {
    return ScriptRunner.VERBOSE_TRIGGERS.includes(t);
  }

  // *** ACCESSEURS ***

  /**
   * `getInt`: null when the attribute is missing. The original returns NaN for a value that is
   * not a number (`$si=""`); every place that reads one treats NaN like null (`Item.initItem`,
   * `hasKey`, the `$repeat` count), so the port returns null for both. `$e_bad`'s `$sys` is the
   * exception and reads the attribute itself.
   */
  getInt(node: ScriptNode, name: string): number | null {
    const val = node.attrs[name];
    if (val === undefined) return null;
    const n = Math.floor(parseInt(val, 10));
    return Number.isNaN(n) ? null : n;
  }

  /** `getFloat`: the original also parses an integer (`Std.parseInt`). */
  getFloat(node: ScriptNode, name: string): number | null {
    return this.getInt(node, name);
  }

  getString(node: ScriptNode, name: string): string | null {
    return node.attrs[name] ?? null;
  }

  // *** GESTION DU SCRIPT ***

  /** Adds script code: to the compiled script, or to the code compiled next. */
  addScript(str: string): void {
    if (this.fl_compile) {
      // `script.appendChild(xml.firstChild)`: only the first node is added
      const first = parseScriptXml(str)[0];
      if (first && this.script) this.script.push(first);
    } else {
      this.extraScript += ' ' + str;
    }
  }

  addNode(name: string, att: string, inner: string): void {
    this.addScript(`<${name} ${att}>${inner}</${name}>`);
  }

  addShortNode(name: string, att: string): void {
    this.addScript(`<${name} ${att}/>`);
  }

  executeEvent(event: ScriptNode): void {
    if (!event.name) return;
    this.traceHistory(` |--${event.name}`);
    const game = this.game;

    switch (event.name) {
      case ScriptRunner.E_SCORE: {
        // score item
        const x = game.flipCoordReal(BaseEntity.x_ctr(this.getInt(event, '$x') ?? 0));
        const y = BaseEntity.y_ctr(this.getInt(event, '$y') ?? 0);
        const id = this.getInt(event, '$i') ?? 0;
        const subId = this.getInt(event, '$si');
        const mc = ScoreItem.attach(game, x, y, id, subId);
        if (this.getInt(event, '$inf') === 1) {
          mc.setLifeTimer(-1);
        }
        const scriptId = this.getInt(event, '$sid');
        this.killById(scriptId);
        mc.scriptId = scriptId;
        break;
      }

      case ScriptRunner.E_SPECIAL: {
        // special item
        if (game.canAddItem() && !this.fl_safe) {
          const x = game.flipCoordReal(BaseEntity.x_ctr(this.getInt(event, '$x') ?? 0));
          const y = BaseEntity.y_ctr(this.getInt(event, '$y') ?? 0);
          const id = this.getInt(event, '$i') ?? 0;
          const subId = this.getInt(event, '$si');
          // `SpecialItem.attach` returns null for an extend on a cleared level; the original then
          // writes to a null clip, which does nothing
          const mc = SpecialItem.attach(game, x, y, id, subId);
          if (mc && this.getInt(event, '$inf') === 1) {
            mc.setLifeTimer(-1);
          }
          const scriptId = this.getInt(event, '$sid');
          this.killById(scriptId);
          if (mc) mc.scriptId = scriptId;
        }
        break;
      }

      case ScriptRunner.E_EXTEND: {
        // extend (`statsMan.attachExtend`, task 2.10)
        if (game.canAddItem() && !this.fl_safe) {
          game.spawnExtend();
        }
        break;
      }

      case ScriptRunner.E_BAD: {
        if (!this.fl_safe) {
          const x =
            BaseEntity.x_ctr(game.flipCoordCase(this.getInt(event, '$x') ?? 0)) -
            Data.CASE_WIDTH * 0.5;
          const y = BaseEntity.y_ctr((this.getInt(event, '$y') ?? 0) - 1);
          const id = this.getInt(event, '$i') ?? 0;
          // `getInt(event,"$sys")!=0 && getInt(event,"$sys")!=null`: NaN counts as true
          const sys = event.attrs['$sys'];
          const fl_sys = sys !== undefined && parseInt(sys, 10) !== 0;
          const mc = game.attachBad(id, x, y);
          if (mc.isType(Data.BAD_CLEAR)) {
            if (fl_sys && game.world.isVisited()) {
              mc.destroy();
              game.badCount--;
              break;
            } else {
              this.bads++;
              game.fl_clear = false;
            }
          }
          const scriptId = this.getInt(event, '$sid');
          this.killById(scriptId);
          mc.scriptId = scriptId;
        }
        break;
      }

      case ScriptRunner.E_KILL:
        this.killById(this.getInt(event, '$sid'));
        break;

      case ScriptRunner.E_TUTORIAL:
      case ScriptRunner.E_MESSAGE: {
        // `$id` is a `Lang` text; old scripts write the text inline
        const id = this.getInt(event, '$id');
        const msg = id === null ? event.text : game.dataStore.getLangText(id);
        if (msg != null) {
          game.attachPop('\n' + msg, event.name === ScriptRunner.E_TUTORIAL);
        }
        break;
      }

      case ScriptRunner.E_KILLMSG:
        game.killPop();
        break;

      case ScriptRunner.E_POINTER: {
        const p = game.getOne(Data.PLAYER) as PlayerEntity | null;
        const cx = game.flipCoordCase(this.getInt(event, '$x') ?? 0);
        const cy = this.getInt(event, '$y') ?? 0;
        game.attachPointer(cx, cy, p ? p.cx : 0, p ? p.cy : 0);
        break;
      }

      case ScriptRunner.E_KILLPTR:
        game.killPointer();
        break;

      case ScriptRunner.E_MC: {
        const cx = this.getInt(event, '$x');
        const cy = this.getInt(event, '$y');
        const xr = this.getInt(event, '$xr');
        const yr = this.getInt(event, '$yr');
        const sid = this.getInt(event, '$sid');
        const back = this.getInt(event, '$back');
        // Linkage names are "$"-escaped in the scripts ("$torch")
        const name = this.getString(event, '$n') ?? '';
        const p = this.getInt(event, '$p');
        this.killById(sid);
        let x: number;
        let y: number;
        if (xr === null) {
          x = BaseEntity.x_ctr(cx ?? 0);
          y = BaseEntity.y_ctr(cy ?? 0);
        } else {
          x = xr;
          y = yr ?? 0;
        }
        x = game.flipCoordReal(x);
        if (game.fl_mirror) {
          x += Data.CASE_WIDTH;
        }
        const mc = game.view.attachSprite(name, x, y, back === 1);
        if (game.fl_mirror) {
          mc._xscale *= -1;
        }
        if ((p ?? 0) > 0) {
          mc.play();
        } else {
          mc.stop();
        }
        mc.getClip('sub')?.stop();
        if (name === '$torch') {
          if (!this.fl_firstTorch) {
            game.clearExtraHoles();
          }
          game.addHole(x + Data.CASE_WIDTH * 0.5, y - Data.CASE_HEIGHT * 0.5, 180);
          game.updateDarkness();
          this.fl_firstTorch = true;
        }
        this.mcList.push({ sid, mc });
        break;
      }

      case ScriptRunner.E_PLAYMC:
        this.playById(this.getInt(event, '$sid'));
        break;

      case ScriptRunner.E_MUSIC: {
        const id = this.getInt(event, '$id');
        if (id !== null) game.playMusicTrack(id);
        break;
      }

      case ScriptRunner.E_ADDTILE:
      case ScriptRunner.E_REMTILE: {
        let cx1 = game.flipCoordCase(this.getInt(event, '$x1') ?? 0);
        let cy1 = this.getInt(event, '$y1') ?? 0;
        const cx2 = game.flipCoordCase(this.getInt(event, '$x2') ?? 0);
        const cy2 = this.getInt(event, '$y2') ?? 0;
        let id = 0;
        if (event.name === ScriptRunner.E_ADDTILE) {
          id = this.getInt(event, '$type') ?? 0;
          id = id > 0 ? -id : Data.GROUND;
        }
        while (cx1 !== cx2 || cy1 !== cy2) {
          game.world.forceCase(cx1, cy1, id);
          if (cx1 < cx2) cx1++;
          if (cx1 > cx2) cx1--;
          if (cy1 < cy2) cy1++;
          if (cy1 > cy2) cy1--;
        }
        game.world.forceCase(cx1, cy1, id);
        this.fl_redraw = true;
        break;
      }

      case ScriptRunner.E_ITEMLINE: {
        let cx1 = this.getInt(event, '$x1') ?? 0;
        const cx2 = this.getInt(event, '$x2') ?? 0;
        const cy = this.getInt(event, '$y');
        const id = this.getInt(event, '$i');
        const subId = this.getInt(event, '$si');
        const time = this.getInt(event, '$t') ?? 0;
        let i = 0;
        let fl_done = false;
        while (!fl_done) {
          // The original closes the timer with `</$$t_timer>`; Flash stops reading at that tag
          // and keeps the nodes, so the timer is added all the same.
          this.addScript(
            `<${ScriptRunner.T_TIMER} $t="${this.cycle + i * time}">` +
              `<${ScriptRunner.E_SCORE} $i="${id}" $si="${subId}" $x="${cx1}" $y="${cy}" $inf="1" />` +
              `</$${ScriptRunner.T_TIMER}>`,
          );
          if (cx1 === cx2) fl_done = true;
          if (cx1 < cx2) cx1++;
          if (cx1 > cx2) cx1--;
          i++;
        }
        break;
      }

      case ScriptRunner.E_GOTO: {
        const id = this.getInt(event, '$id');
        if (id !== null) game.forcedGoto(id);
        break;
      }

      case ScriptRunner.E_HIDE:
      case ScriptRunner.E_HIDEBORDERS: {
        const view = game.view;
        if (event.name === ScriptRunner.E_HIDE) {
          view.fl_hideTiles = this.getInt(event, '$tiles') === 1;
          view.fl_hideBorders = this.getInt(event, '$borders') === 1;
        } else {
          view.fl_hideTiles = true;
        }
        // `detach` also removes the sprites attached by the script
        view.detach();
        view.attach();
        view.moveToPreviousPos();
        break;
      }

      case ScriptRunner.E_CODETRIGGER: {
        const id = this.getInt(event, '$id');
        if (id !== null) this.codeTrigger(id);
        break;
      }

      case ScriptRunner.E_PORTAL: {
        if (game.fl_clear && this.cycle > 10) {
          game.usePortal(this.getInt(event, '$pid') ?? 0, null);
        }
        break;
      }

      case ScriptRunner.E_SETVAR: {
        const name = this.getString(event, '$var');
        const value = this.getString(event, '$value');
        if (name !== null && value !== null) game.setDynamicVar(name, value);
        break;
      }

      case ScriptRunner.E_OPENPORTAL: {
        const cx = this.getInt(event, '$x');
        const cy = this.getInt(event, '$y');
        const pid = this.getInt(event, '$pid');
        if (cx !== null && cy !== null && pid !== null) game.openPortal(cx, cy, pid);
        break;
      }

      case ScriptRunner.E_DARKNESS:
        game.forcedDarkness = this.getInt(event, '$v');
        game.updateDarkness();
        break;

      case ScriptRunner.E_FAKELID: {
        const lid = this.getInt(event, '$lid');
        if (lid === null) {
          game.fakeLevelId = null;
          game.hud.hideLevel();
        } else {
          game.fakeLevelId = lid;
          game.hud.setLevel(lid);
        }
        break;
      }

      default:
        // Unknown event? Maybe a trigger: it moves to the end of the script
        if (this.isTrigger(event.name)) {
          this.script?.push(event);
        } else {
          console.warn(`unknown event: ${event.name} (not a trigger)`);
        }
        break;
    }
  }

  isTrigger(n: string): boolean {
    return (
      n === ScriptRunner.T_TIMER ||
      n === ScriptRunner.T_POS ||
      n === ScriptRunner.T_ATTACH ||
      n === ScriptRunner.T_DO ||
      n === ScriptRunner.T_END ||
      n === ScriptRunner.T_BIRTH ||
      n === ScriptRunner.T_DEATH ||
      n === ScriptRunner.T_EXPLODE ||
      n === ScriptRunner.T_ENTER ||
      n === ScriptRunner.T_NIGHTMARE ||
      n === ScriptRunner.T_MIRROR ||
      n === ScriptRunner.T_MULTI ||
      n === ScriptRunner.T_NINJA
    );
  }

  checkTrigger(trigger: ScriptNode): boolean {
    if (!trigger.name) return false;
    const game = this.game;

    switch (trigger.name) {
      case ScriptRunner.T_TIMER: {
        const t = this.getInt(trigger, '$t');
        return t !== null && this.cycle >= t;
      }

      case ScriptRunner.T_POS: {
        // player position
        const x = game.flipCoordCase(this.getInt(trigger, '$x') ?? 0);
        const y = this.getInt(trigger, '$y') ?? 0;
        const dist = this.getInt(trigger, '$d') ?? 0;
        for (const p of game.getList(Data.PLAYER)) {
          if (!p.fl_kill && !p.fl_destroy) {
            const d = p.distanceCase(x, y);
            if (d <= dist && !Number.isNaN(d)) return true;
          }
        }
        return false;
      }

      case ScriptRunner.T_ATTACH:
        return this.fl_onAttach;

      case ScriptRunner.T_DO:
        return true;

      case ScriptRunner.T_END:
        return game.fl_clear && this.cycle > 10;

      case ScriptRunner.T_BIRTH:
        return this.fl_birth;

      case ScriptRunner.T_DEATH:
        return this.fl_death;

      case ScriptRunner.T_EXPLODE: {
        const x = game.flipCoordReal(BaseEntity.x_ctr(this.getInt(trigger, '$x') ?? 0));
        const y = BaseEntity.y_ctr(this.getInt(trigger, '$y') ?? 0);
        for (const expl of this.recentExp) {
          const sqrDist = Math.pow(x - expl.x, 2) + Math.pow(y - expl.y, 2);
          if (sqrDist <= Math.pow(expl.r, 2)) {
            if (Math.sqrt(sqrDist) <= expl.r) return true;
          }
        }
        return false;
      }

      case ScriptRunner.T_ENTER: {
        const cx = game.flipCoordCase(this.getInt(trigger, '$x') ?? 0);
        const cy = this.getInt(trigger, '$y') ?? 0;
        for (const e of this.entries) {
          if (e.cx === cx && e.cy === cy) return true;
        }
        return false;
      }

      case ScriptRunner.T_NIGHTMARE:
        return game.fl_nightmare;

      case ScriptRunner.T_MIRROR:
        return game.fl_mirror;

      case ScriptRunner.T_MULTI:
        return game.countList(Data.PLAYER) > 1;

      case ScriptRunner.T_NINJA:
        return game.fl_ninja;

      default:
        console.warn(`unknown trigger ${trigger.name}`);
        return false;
    }
  }

  /** `trigger.removeNode()` */
  private removeTrigger(trigger: ScriptNode): void {
    const i = this.script?.indexOf(trigger) ?? -1;
    if (i >= 0) this.script!.splice(i, 1);
  }

  executeTrigger(trigger: ScriptNode): void {
    this.traceHistory(trigger.name);

    const events = trigger.children;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      this.executeEvent(event);
      if (this.script?.includes(event)) {
        // A nested trigger was appended to the script: `appendChild` takes it out of this
        // trigger, and as the script's last node its nextSibling is null, so the events after
        // it in this trigger are skipped.
        events.splice(i, 1);
        break;
      }
    }

    // Repeat count
    const total = this.getInt(trigger, '$repeat');
    if (total !== null) {
      const left = total - 1;
      this.traceHistory(`R ${trigger.name}: ${left}`);
      trigger.attrs['$repeat'] = String(left);
      if (left === 0) {
        // End of repeat
        this.removeTrigger(trigger);
      } else if (trigger.name === ScriptRunner.T_TIMER) {
        let str = trigger.attrs['$base'];
        if (str === undefined) {
          str = trigger.attrs['$t'];
          trigger.attrs['$base'] = str;
        }
        const timer = parseInt(str, 10) + this.cycle;
        trigger.attrs['$t'] = String(timer);
      }
    } else {
      this.traceHistory(`X ${trigger.name}`);
      this.removeTrigger(trigger);
    }
  }

  /** Inserts the level's bad list into the script. */
  insertBads(): number {
    let str = `<${ScriptRunner.T_DO}>`;
    for (const b of this.data.badList) {
      str += `<${ScriptRunner.E_BAD} $i="${b.id}" $x="${b.x}" $y="${b.y}" $sys="1"/>`;
    }
    str += `</${ScriptRunner.T_DO}>`;
    this.addScript(str);
    return this.data.badList.length;
  }

  insertItem(
    event: string,
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
      `<${ScriptRunner.T_TIMER} $t="${this.cycle + t}" ${doStr} $endClear="${fl_clearAtEnd ? '1' : '0'}">` +
        `<${event} $x="${x}" $y="${y}" $i="${id}" $si="${subStr}" $inf="${fl_inf ? '1' : ''}" $sys="1"/>` +
        `</${ScriptRunner.T_TIMER}>`,
    );
  }

  insertSpecialItem(
    id: number,
    sid: number | null,
    x: number,
    y: number,
    t: number,
    repeat: number | null,
    fl_inf: boolean,
    fl_clearAtEnd: boolean,
  ): void {
    this.insertItem(ScriptRunner.E_SPECIAL, id, sid, x, y, t, repeat, fl_inf, fl_clearAtEnd);
  }

  insertScoreItem(
    id: number,
    sid: number | null,
    x: number,
    y: number,
    t: number,
    repeat: number | null,
    fl_inf: boolean,
    fl_clearAtEnd: boolean,
  ): void {
    this.insertItem(ScriptRunner.E_SCORE, id, sid, x, y, t, repeat, fl_inf, fl_clearAtEnd);
  }

  /** Inserts the regular extends. */
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

  /** Runs the level script. */
  runScript(): void {
    if (this.script === null) return;
    const game = this.game;

    let i = 0;
    while (i < this.script.length) {
      const trigger = this.script[i];
      if (this.checkTrigger(trigger)) {
        // World keys
        const kid = this.getInt(trigger, '$key');
        if (kid !== null && !game.hasKey(kid)) {
          if (this.isVerbose(trigger.name)) {
            game.fxMan.keyRequired(kid);
          }
        } else {
          if (kid !== null) {
            game.fxMan.keyUsed(kid);
          }
          this.executeTrigger(trigger);
          // A removed node's nextSibling is null: the scan ends at the first trigger removed,
          // and the triggers after it wait for the next cycle.
          const at = this.script?.indexOf(trigger) ?? -1;
          if (at < 0) break;
          i = at;
        }
      }
      i++;
    }
    this.fl_birth = false;
    this.fl_death = false;
    this.fl_onAttach = false;
    this.recentExp = [];
    this.entries = [];
  }

  /** Builds the script tree and reads its first cycle. */
  compile(): void {
    this.history = [];
    this.traceHistory(this.baseScript);
    this.script = parseScriptXml(`${this.baseScript} ${this.extraScript}`);
    this.normalMode();
    this.fl_compile = true;
    this.traceHistory(`first=${this.cycle}`);
    this.runScript(); // first cycle of the script
  }

  /** `script.toString()`, as `GameMechanics.suspend` saves it into the level data. */
  scriptToString(): string | null {
    return this.script === null ? null : serializeScript(this.script);
  }

  clearScript(): void {
    this.script = null;
    this.baseScript = '';
    this.extraScript = '';
    this.cycle = 0;
    this.fl_compile = false;
  }

  /** Removes every trigger flagged `$endClear`. */
  clearEndTriggers(): void {
    if (this.script === null) return;
    for (let i = 0; i < this.script.length; i++) {
      if (this.script[i].attrs['$endClear'] === '1') {
        this.traceHistory(`eX ${this.script[i].name}`);
        this.script.splice(i, 1);
        i--;
      }
    }
  }

  reset(): void {
    this.cycle = 0;
    this.traceHistory('(r)');
  }

  /** Destroys an entity or MC created by the script. */
  killById(id: number | null): void {
    if (id === null) return;
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

  /** Plays an MC created by the script. */
  playById(id: number | null): void {
    if (id === null) return;
    for (const item of this.mcList) {
      if (item.sid === id) {
        item.mc.play();
        item.mc.getClip('sub')?.play();
      }
    }
  }

  /** Specific codes the scripts cannot express. */
  codeTrigger(id: number): void {
    const game = this.game;
    switch (id) {
      case 0: // bucket, first level
        game.setWarpStart();
        break;

      case 1: // long hurry up
        game.huTimer -= 0.5;
        break;

      case 2: // no exit arrow
        game.fxMan.detachExit();
        break;

      case 3: {
        // fruits released
        this.playById(101);
        this.fl_elevatorOpen = true;
        for (const p of game.getList(Data.PLAYER) as PlayerEntity[]) {
          p.lockControls(Data.SECOND * 12.5);
          p.dx = 0;
        }
        game.huTimer = 0;
        break;
      }

      case 4: {
        // exit by the elevator
        if (this.fl_elevatorOpen) {
          const l = game.getList(Data.PLAYER) as PlayerEntity[];
          for (const p of l) {
            p.hide();
            p.lockControls(99999);
            game.huTimer = 0;
          }
          for (const item of this.mcList) {
            if (item.sid === 101) {
              item.mc.avmSet('head', l[0]?.head);
            }
          }
          this.playById(101);
          game.endModeTimer = Data.SECOND * 14;
          this.fl_elevatorOpen = false;
        }
        break;
      }

      case 5: {
        // exit after Tuberculoz
        const boss = game.getOne(Data.BOSS) as { fl_defeated?: boolean } | null;
        if (boss?.fl_defeated) {
          this.bossDoorTimer -= 1;
          if (this.bossDoorTimer <= 0) {
            game.destroyList(Data.BOSS);
            // The original destroys the View; the port keeps one View, which goto() redraws
            game.view.detach();
            game.forcedGoto(102);
          }
        }
        break;
      }

      case 6: {
        // soccer balls on the special slots
        const slots = game.world.current.specialSlots;
        const sl = slots[game.rand.random(slots.length)];
        const b = SoccerBall.attach(game, BaseEntity.x_ctr(sl.x), BaseEntity.y_ctr(sl.y));
        b.dx = (10 + game.rand.random(10)) * (game.rand.random(2) * 2 - 1);
        b.dy = -game.rand.random(5) - 5;
        break;
      }

      case 7: // Igor cries
        for (const p of game.getList(Data.PLAYER) as PlayerEntity[]) {
          p.setBaseAnims(Data.ANIM_PLAYER_WALK, Data.ANIM_PLAYER_STOP_L);
        }
        break;

      case 8: // Igor is happy
        for (const p of game.getList(Data.PLAYER) as PlayerEntity[]) {
          p.setBaseAnims(Data.ANIM_PLAYER_WALK_V, Data.ANIM_PLAYER_STOP_V);
        }
        break;

      case 9: // Tuberculoz laughs
        game.audio.playSound('sound_boss_laugh', Data.CHAN_BAD);
        break;

      case 10: // no jump down for the bads
        for (const b of game.getList(Data.BAD)) {
          (b as { setJumpDown?: (v: number | null) => void }).setJumpDown?.(null);
        }
        break;

      case 11: // kills every bad (clear only)
        for (const b of [...game.getList(Data.BAD_CLEAR)]) {
          game.fxMan.attachFx(b.x, b.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          b.destroy();
        }
        break;

      case 12: // forces the hurry up
        while (game.huState < 2) {
          const mc = game.onHurryUp();
          if (game.huState < 2) {
            mc?.removeMovieClip();
          }
        }
        break;

      case 13: // destroys every item (score & special)
        for (const it of [...game.getList(Data.ITEM)] as ItemEntity[]) {
          game.fxMan.attachFx(it.x, it.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          it.destroy();
        }
        break;

      case 14: // clears the torch lights
        game.clearExtraHoles();
        break;

      case 15: // reset hurry
        game.resetHurry();
        break;

      default:
        console.warn(
          id in ScriptRunner.UNPORTED_CODE_TRIGGERS
            ? `code trigger #${id} not ported: ${ScriptRunner.UNPORTED_CODE_TRIGGERS[id]}`
            : `code trigger #${id} not found!`,
        );
        break;
    }
  }

  /** Main loop. */
  update(): void {
    if (this.fl_compile) {
      this.cycle += 1;
      this.runScript();
    }

    if (this.fl_redraw) {
      this.fl_redraw = false;
      const view = this.game.view;
      view.detachLevel();
      view.displayCurrent();
      view.moveToPreviousPos();
    }
    this.fl_firstTorch = false;
  }
}
