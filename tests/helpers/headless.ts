import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container } from 'pixi.js';
import { AudioEngine } from '../../src/engine/Audio';
import { InputController } from '../../src/engine/Input';
import type { Replay } from '../../src/engine/InputRecording';
import { SwfLibrary } from '../../src/engine/swf/SwfLibrary';
import type { SwfLibraryData } from '../../src/engine/swf/types';
import { GameDataStore } from '../../src/game/Data';
import { GameSession } from '../../src/game/GameSession';

const PUBLIC = join(__dirname, '../../public');

let libData: SwfLibraryData | null = null;

/** A full game session with no rendering, audio or keyboard, reading `public/` from disk. */
export async function createHeadlessSession(set = 'adventure'): Promise<GameSession> {
  libData ??= JSON.parse(readFileSync(join(PUBLIC, 'gfx/library.json'), 'utf-8'));
  const lib = SwfLibrary.headless(libData!);
  const dataStore = await GameDataStore.fromLoader(async (rel) =>
    JSON.parse(await readFile(join(PUBLIC, 'data', rel), 'utf-8')),
  );
  const host = { stage: new Container() };
  const session = await GameSession.create(
    host,
    lib,
    dataStore,
    new AudioEngine({}),
    new InputController(),
    set,
  );
  session.stop();
  return session;
}

/** Plays a replay to its end (or `maxTicks`), calling `onTick` after every tick. */
export async function runReplay(
  session: GameSession,
  replay: Replay,
  onTick?: (tick: number) => void,
  maxTicks = Infinity,
): Promise<number> {
  const player = await session.playReplay(replay);
  const total = Math.min(player.ticks, maxTicks);
  for (let t = 1; t <= total; t++) {
    session.gameLoop.stepSingleFrame();
    onTick?.(t);
  }
  return total;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Compact, comparable state of the game: what a regression snapshot records. */
export function snapshotState(session: GameSession) {
  const p = session.player;
  return {
    level: session.world.currentId,
    dim: session.currentDim,
    gameOver: session.fl_gameOver,
    clear: session.fl_clear,
    player: p
      ? {
          x: r2(p.x),
          y: r2(p.y),
          lives: p.lives,
          score: p.score,
          weapon: p.currentWeapon,
          anim: p.animId,
        }
      : null,
    bads: session.getBads().map((b) => `${b.constructor.name} ${r2(b.x)},${r2(b.y)}`),
    items: session.getItems().map((i) => `${i.id}:${i.subId ?? ''} ${r2(i.x)},${r2(i.y)}`),
    bombs: session.getBombs().length,
  };
}
