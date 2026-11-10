import { Container } from 'pixi.js';
import { padLayout } from '../../engine/Gamepad';
import type { PlayerDevice, PlayerKeys } from '../../engine/Input';
import { type SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import type { IGameContext } from '../GameContext';
import { padGlyph } from './PadGlyphs';

/**
 * Port addition (roadmap G.3, not in the original, which had one keyboard for both players):
 * the players of a two-player game choose what they play with. Player 1, then player 2, presses
 * a key of a keyboard side (the keys the mode gave a player: the arrows and Enter, or R F D G
 * and A in the co-op mode) or a button of a controller. The same screen comes back for a player
 * whose controller is unplugged during the game, until it is back or they press another device.
 *
 * It is drawn on the original's two-player pause screen (`hammer_interf_instructions` frame 3,
 * `MultiCoop.onPause`): each player's row shows their keys, or their controller's buttons, and
 * the tip line says who is asked. The game is paused under it (`GameMode.startJoin`).
 */
export class JoinScreen {
  readonly mc: SwfMovieClip;
  /** What each player has chosen so far, by pid; null for a player still asked. */
  readonly devices: (PlayerDevice | null)[];
  private readonly sides: readonly PlayerKeys[];
  /** A controller was unplugged (the text says so), not the start of the game. */
  private readonly fl_lost: boolean;
  private shownFor: number | null = -1;
  private t = 0;
  /** Ticks since every player has a device. */
  private doneTimer = 0;

  constructor(
    private readonly game: IGameContext,
    pids: readonly number[],
    sides: readonly PlayerKeys[],
    fl_lost: boolean,
  ) {
    this.sides = sides;
    this.fl_lost = fl_lost;
    const players = game.getList(Data.PLAYER) as PlayerEntity[];
    this.devices = players.map((p) =>
      pids.includes(p.pid) ? null : game.input.playerDevice(p.pid),
    );

    const mc = game.depthMan.attach('hammer_interf_instructions', Data.DP_INTERF);
    this.mc = mc;
    mc.gotoAndStop('3');
    mc._x = Data.GAME_WIDTH * 0.5;
    mc._y = Data.GAME_HEIGHT * 0.5;
    const setText = (name: string, text: string) => {
      const field = mc.getText(name);
      if (field) field.text = text;
    };
    setText('move', `${game.dataStore.getLangText(29)}`);
    setText('attack', `${game.dataStore.getLangText(42)}`);
    setText('click', '');

    // What is held now (the press that started the game) is not a choice
    game.input.joinPresses(sides);
    this.show();
  }

  /** The first player still asked, or null. */
  get awaited(): number | null {
    const pid = this.devices.indexOf(null);
    return pid < 0 ? null : pid;
  }

  /**
   * One tick: gives each newly pressed free device to the next player asked. True once every
   * player has theirs and lets go of it (so the choosing press does not act in the game).
   */
  update(): boolean {
    this.t++;
    for (const d of this.game.input.joinPresses(this.sides)) {
      const pid = this.awaited;
      if (pid === null) break;
      if (this.devices.some((o) => o !== null && sameDevice(o, d))) continue;
      this.devices[pid] = d;
    }
    this.show();
    if (this.awaited !== null) return false;
    this.doneTimer++;
    if (this.doneTimer < Data.SECOND * 0.5 || this.game.input.joinHolding) return false;
    this.game.input.setPlayerDevices(this.devices, this.sides);
    return true;
  }

  private show(): void {
    const pid = this.awaited;
    if (pid !== this.shownFor) {
      this.shownFor = pid;
      const tip = this.mc.getText('tip');
      if (tip) tip.htmlText = pid === null ? '' : this.message(pid);
      showPlayerDevices(this.game, this.mc, this.devices);
    }
    blinkRow(this.game, this.mc, this.devices, pid, this.t);
  }

  private message(pid: number): string {
    const id = this.game.dataStore.langId;
    const t = TEXT[id === 'en' || id === 'es' ? id : 'fr'];
    const p = (this.game.getList(Data.PLAYER) as PlayerEntity[]).find((o) => o.pid === pid);
    const name = p?.name ?? `${pid + 1}`;
    return (this.fl_lost ? t.lost : t.join).replace('{0}', name);
  }

  destroy(): void {
    this.mc.removeMovieClip();
  }
}

const TEXT: Record<'fr' | 'en' | 'es', { join: string; lost: string }> = {
  fr: {
    join: '<b>{0} :</b> appuyez sur une touche de votre côté du clavier, ou sur un bouton de votre manette.',
    lost: '<b>Manette débranchée. {0} :</b> rebranchez-la, ou appuyez sur une autre manette ou sur le clavier.',
  },
  en: {
    join: '<b>{0}:</b> press a key on your side of the keyboard, or a button on your controller.',
    lost: '<b>Controller unplugged. {0}:</b> plug it back in, or press another controller or the keyboard.',
  },
  es: {
    join: '<b>{0}:</b> pulsa una tecla de tu lado del teclado, o un botón de tu mando.',
    lost: '<b>Mando desconectado. {0}:</b> vuelve a conectarlo, o pulsa otro mando o el teclado.',
  },
};

function sameDevice(a: PlayerDevice, b: PlayerDevice): boolean {
  if (a.kind === 'keys') return b.kind === 'keys' && a.side === b.side;
  return b.kind === 'pad' && a.index === b.index && a.id === b.id;
}

// ------------------------------------------------- The rows of frame 3

/** Distance between player 1's row and player 2's, and the center of each row and column. */
const ROW_PITCH = 55;
const ROW_Y = [-63, -8];
const MOVE_X = -75;
const ATTACK_X = 2;

/** The parts of frame 3 that belong to a player's row. */
interface Rows {
  /** The key pictures of each keyboard side (row 1's arrows and Enter, row 2's letters). */
  keys: { node: Container; y: number }[][];
  /** The row's number and the player's name. */
  labels: Container[][];
  pads: Container | null;
}

const rowsOf = new WeakMap<SwfMovieClip, Rows>();

/** Sorts the children of frame 3 by where they are drawn: the timeline gives them no name. */
function readRows(mc: SwfMovieClip): Rows {
  let rows = rowsOf.get(mc);
  if (rows) return rows;
  rows = { keys: [[], []], labels: [[], []], pads: null };
  for (const node of mc.children) {
    if (node instanceof SwfTextField) continue;
    const b = node.getBounds();
    const p0 = mc.toLocal({ x: b.minX, y: b.minY });
    const p1 = mc.toLocal({ x: b.maxX, y: b.maxY });
    if (p1.x - p0.x > 100 || p1.y - p0.y > 70) continue; // the paper, the grid lines
    const row = (p0.y + p1.y) / 2 < -36 ? 0 : 1;
    if (p0.x >= -125 && p1.x <= 30) rows.keys[row].push({ node, y: node.y });
    else if (p1.x <= -105 || p0.x >= 69) rows.labels[row].push(node);
  }
  rowsOf.set(mc, rows);
  return rows;
}

/**
 * Shows on the two-player pause screen (frame 3 of `hammer_interf_instructions`) what each
 * player plays with: the keys of their keyboard side on their row, their controller's buttons,
 * or nothing for a player who has not chosen yet.
 */
export function showPlayerDevices(
  game: IGameContext,
  mc: SwfMovieClip,
  devices: readonly (PlayerDevice | null)[],
): void {
  if (game.depthMan.lib.headless) return;
  const rows = readRows(mc);
  rows.keys.forEach((nodes, side) => {
    const pid = devices.findIndex((d) => d?.kind === 'keys' && d.side === side);
    for (const { node, y } of nodes) {
      node.visible = pid >= 0 && pid < 2;
      node.y = y + (pid - side) * ROW_PITCH;
    }
  });
  rows.pads?.destroy({ children: true });
  rows.pads = null;
  const layer = new Container();
  devices.slice(0, 2).forEach((d, pid) => {
    if (d?.kind !== 'pad') return;
    const layout = padLayout(d.id);
    const move = [padGlyph('dpad', layout, 30), padGlyph('a', layout, 24)];
    const total = move[0].width + 2 + move[1].width;
    move[0].position.set(MOVE_X - total / 2 + move[0].width / 2, ROW_Y[pid]);
    move[1].position.set(MOVE_X + total / 2 - move[1].width / 2, ROW_Y[pid]);
    const attack = padGlyph('b', layout, 24);
    attack.position.set(ATTACK_X, ROW_Y[pid]);
    layer.addChild(...move, attack);
  });
  layer.zIndex = 1000; // above the clip's timeline depths
  mc.addChild(layer);
  rows.pads = layer;
}

/** The row of the player asked blinks; the rows of those asked after are dim. */
function blinkRow(
  game: IGameContext,
  mc: SwfMovieClip,
  devices: readonly (PlayerDevice | null)[],
  awaited: number | null,
  t: number,
): void {
  if (game.depthMan.lib.headless) return;
  readRows(mc).labels.forEach((nodes, pid) => {
    let alpha = 1;
    if (pid === awaited) alpha = 0.4 + 0.6 * Math.abs(Math.cos(t * 0.12));
    else if (devices[pid] === null) alpha = 0.35;
    for (const n of nodes) n.alpha = alpha;
  });
}
