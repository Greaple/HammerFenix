import { beforeAll, describe, expect, it } from 'vitest';
import type { GameSession } from '../src/game/GameSession';
import { ScriptRunner } from '../src/game/levels/ScriptRunner';
import { createHeadlessSession } from './helpers/headless';

/** `$e_setVar` leaves a visible mark: the order the script ran events in. */
const mark = (name: string) => `<$e_setVar $var="${name}" $value="1"/>`;

describe('ScriptRunner (levels.ScriptEngine)', () => {
  let session: GameSession;

  beforeAll(async () => {
    session = await createHeadlessSession();
  });

  function run(script: string): ScriptRunner {
    for (const v of ['A', 'B', 'C']) session.setDynamicVar(v, '');
    const runner = new ScriptRunner(session, { ...session.world.current, script });
    runner.compile();
    return runner;
  }
  const marked = () => ['A', 'B', 'C'].filter((v) => session.getDynamicVar(v) === '1');

  it('stops scanning the triggers at the first one removed in a cycle', () => {
    const runner = run(`<$do>${mark('A')}</$do><$do>${mark('B')}</$do>`);
    expect(marked()).toEqual(['A']);
    runner.update();
    expect(marked()).toEqual(['A', 'B']);
  });

  it('keeps scanning after a trigger that repeats', () => {
    run(`<$do $repeat="2">${mark('A')}</$do><$do>${mark('B')}</$do>`);
    expect(marked()).toEqual(['A', 'B']);
  });

  it('moves a nested trigger to the end and skips the events after it', () => {
    const runner = run(`<$do>${mark('A')}<$do>${mark('B')}</$do>${mark('C')}</$do>`);
    expect(marked()).toEqual(['A']);
    runner.update();
    expect(marked()).toEqual(['A', 'B']);
    runner.update();
    expect(marked()).toEqual(['A', 'B']);
  });

  it('repeats a timer from the cycle it fired at', () => {
    const runner = run(`<$t_timer $t="2" $repeat="2">${mark('A')}</$t_timer>`);
    runner.update();
    runner.update();
    expect(runner.script![0].attrs).toMatchObject({ $t: '4', $base: '2', $repeat: '1' });
    session.setDynamicVar('A', '');
    runner.update();
    runner.update();
    expect(marked()).toEqual(['A']);
    expect(runner.script).toEqual([]);
  });

  it('saves the script left as XML, and reads it back', () => {
    const runner = run(`<$do>${mark('A')}</$do><$t_timer $t="50">${mark('B')}</$t_timer>`);
    const saved = runner.scriptToString()!;
    expect(saved).toBe('<$t_timer $t="50"><$e_setVar $var="B" $value="1" /></$t_timer>');
    const again = new ScriptRunner(session, { ...session.world.current, script: saved });
    again.compile();
    expect(again.scriptToString()).toBe(saved);
  });
});
