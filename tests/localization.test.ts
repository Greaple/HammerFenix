import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Replay } from '../src/engine/InputRecording';
import { type SwfMovieClip, SwfTextField } from '../src/engine/swf/SwfMovieClip';
import type { SwfLibraryData } from '../src/engine/swf/types';
import { Data } from '../src/game/Data';
import { createHeadlessSession, runReplay } from './helpers/headless';
import { pickLang } from '../src/ui/Language';
import { SHELL_TEXT_KEYS, TITLE_FILE } from '../src/ui/Shell';

const PUBLIC = join(__dirname, '../public');
const lib = JSON.parse(readFileSync(join(PUBLIC, 'gfx/library.json'), 'utf-8')) as SwfLibraryData;

/**
 * The words the SWF text fields hold before the code sets them: French texts ("niveau suivant",
 * "Apprentissage") and placeholders ("pauseLabel", "click label"). The original sets every field
 * it shows from `Lang`, so none should be on screen.
 */
const DEFAULTS = new Set(
  Object.values(lib.characters)
    .filter((c) => c.kind === 'text')
    .map((c) => (c.html ? c.text.replace(/<[^>]+>/g, '') : c.text).trim())
    .filter((t) => /[a-z]/i.test(t)),
);

/** The texts of the visible text fields under `root`. */
function visibleTexts(root: Container, out: string[] = []): string[] {
  if (!root.visible) return out;
  if (root instanceof SwfTextField) out.push(root.text.trim());
  for (const c of root.children) visibleTexts(c as Container, out);
  return out;
}

describe('localization (3.4)', () => {
  it('shows no SWF default text in play or on the pause screen', async () => {
    const files = readdirSync(join(__dirname, 'replays')).filter((f) => f.endsWith('.json'));
    const seen = new Set<string>();
    for (const file of files) {
      const replay = JSON.parse(readFileSync(join(__dirname, 'replays', file), 'utf-8')) as Replay;
      const session = await createHeadlessSession(replay.set);
      expect(session.dataStore.langId).toBe('en');
      await runReplay(session, replay, (t) => {
        if (t % 10 === 0) for (const s of visibleTexts(session.gameRoot)) seen.add(s);
        if (t === 300) {
          session.onPause();
          for (const s of visibleTexts(session.gameRoot)) seen.add(s);
          session.onUnpause();
        }
      });
    }
    expect([...seen].filter((s) => DEFAULTS.has(s))).toEqual([]);
  }, 120000);

  it('fills the pause screen from the lang file and cycles its tips', async () => {
    const session = await createHeadlessSession();
    session.restartLevel();
    for (let i = 0; i < 80; i++) session.gameLoop.stepSingleFrame();
    const tips: string[] = [];
    for (let i = 0; i < 14; i++) {
      session.onPause();
      const mc = (session as unknown as { pauseMC: SwfMovieClip }).pauseMC;
      expect(mc._currentframe).toBe(1);
      if (i === 0) {
        expect(mc.getText('title')?.text).toBe('Instructions');
        expect(mc.getText('pause')?.text).toBe('Pause');
        expect(mc.getText('space')?.text).toBe('SPACE');
        expect(mc.getText('click')?.text).toBe('');
        expect(mc.getText('sector')?.text).toBe('Land:«The Village of Hammerfest»');
      }
      tips.push(mc.getText('tip')!.text);
      session.onUnpause();
    }
    // `Lang` tips 301 to 313, then back to the first
    expect(tips[0]).toBe(`Tip:${session.dataStore.getStatic(301)}`);
    expect(tips[12]).toBe(`Tip:${session.dataStore.getStatic(313)}`);
    expect(tips[13]).toBe(tips[0]);
  });

  it('shows the variables bound to text fields, also on fields placed later', async () => {
    const session = await createHeadlessSession();
    session.restartLevel();
    for (let i = 0; i < 80; i++) session.gameLoop.stepSingleFrame();
    const fx = session.fxMan;
    const texts = (mc: SwfMovieClip) => visibleTexts(mc);

    // `FxManager.attachExit`: the field appears on frame 8
    fx.attachExit();
    const exit = fx.mc_exitArrow!;
    // `FxManager.attachAlert`: the field is in a child clip, bound to `_parent.label`
    const alert = fx.attachAlert('Hurry up!');
    // `SpecialManager.onPerfect`: `_parent.label` and `_parent.bonus`
    const perfect = session.depthMan.attach('hammer_fx_perfect', Data.DP_INTERF);
    perfect.setVariable('label', session.dataStore.getStatic(11));
    perfect.setVariable('bonus', '50000');
    for (let i = 0; i < 10; i++) session.gameLoop.stepSingleFrame();

    expect(texts(exit)).toContain('next level');
    expect(texts(alert)).toContain('Hurry up!');
    expect(texts(perfect)).toEqual(expect.arrayContaining(['PERFECT!', '50000']));
  });

  it('starts in the saved language, else the browser one, else English', () => {
    expect(pickLang('es', ['fr-FR'])).toBe('es');
    expect(pickLang(null, ['de-DE', 'fr-BE', 'en'])).toBe('fr');
    expect(pickLang('xx', ['ES'])).toBe('es');
    expect(pickLang(undefined, ['de', 'it'])).toBe('en');
  });

  it('has the title logo and every menu text in each language', () => {
    expect(() => readFileSync(join(PUBLIC, TITLE_FILE))).not.toThrow();
    const fr = [...SHELL_TEXT_KEYS.fr].sort();
    for (const l of ['en', 'es'] as const) expect([...SHELL_TEXT_KEYS[l]].sort()).toEqual(fr);
  });

  it('has the game fonts extracted from the SWF', () => {
    for (const f of ['franklin-gothic-heavy.otf', 'satans.otf', 'impact.otf']) {
      expect(readFileSync(join(PUBLIC, 'fonts', f)).length).toBeGreaterThan(10000);
    }
  });
});
