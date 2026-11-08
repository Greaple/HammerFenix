/**
 * Stand-in for MotionTypes' `Log` (not in the original source), used by the dev keys. The
 * original drew its lines on screen; here they go to the browser console. `print` lines are
 * gathered over a tick and written by `flush` at its end, only when they differ from the last
 * written ones (the original redrew them every frame).
 */
export class Log {
  private static lines: string[] = [];
  private static last = '';

  /** `Log.print` */
  static print(msg: string): void {
    Log.lines.push(msg);
  }

  /** `Log.trace` (and `GameManager.warning`): written at once. */
  static trace(msg: string): void {
    console.warn(msg);
  }

  /** `Log.clear` (Backspace): the next lines are written even if they repeat the last ones. */
  static clear(): void {
    Log.last = '';
  }

  /** Writes this tick's lines; called once per tick by `GameSession.update`. */
  static flush(): void {
    const text = Log.lines.join('\n');
    Log.lines = [];
    if (text !== Log.last && text !== '') console.info(text);
    Log.last = text;
  }
}
