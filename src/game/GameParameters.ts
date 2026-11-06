/**
 * Port of the item families and game options of `GameParameters`
 * (`class/hammer/GameParameters.mt`): the `$families` and `$options` the site gave the game.
 * Not ported yet: the player's settings (`$volume`, `$sound`, `$music`, `$detail`, `$shake`,
 * the site's "Paramètres" page).
 */
export class GameParameters {
  /** The families as received, comma separated (`families`). */
  readonly families: string[];
  readonly specialItemFamilies: number[] = [];
  readonly scoreItemFamilies: number[] = [];
  private readonly options = new Map<string, boolean>();
  /** For `toString()` and the replays only. */
  readonly optionList: string[] = [];

  constructor(f: string, opt: string) {
    // Game options (mirror, nightmare...)
    if (opt.length > 0) {
      this.optionList = opt.split(',');
      for (const o of this.optionList) this.options.set(o, true);
    }

    // Families
    this.families = f.split(',');
    for (const s of this.families) {
      const id = parseInt(s, 10);
      if (id >= 1000) this.scoreItemFamilies.push(id);
      else this.specialItemFamilies.push(id);
    }
  }

  /** True if the family `id` is unlocked. */
  hasFamily(id: number): boolean {
    return this.specialItemFamilies.includes(id) || this.scoreItemFamilies.includes(id);
  }

  /** True if the option is on. */
  hasOption(oid: string): boolean {
    return this.options.get(oid) === true;
  }

  toString(): string {
    return `fam=${this.families.join(', ')}\nopt=${this.optionList.join('\n  ')}\n`;
  }
}

/**
 * `GameManager` constructor: the families of the tutorial and of a game started with no site
 * (`Loader.BASE_SCRIPT_URL == null`), logged as "using sysfam". The Ruffle side-by-side runs the
 * original this way.
 */
export const SYSTEM_FAMILIES = '0,7,1000,18';
