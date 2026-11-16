import { Container, Rectangle, type Renderer } from 'pixi.js';
import type { SwfLibrary } from '../../engine/swf/SwfLibrary';

/**
 * An item clip or another clip used as a picture on the site pages: special items below 1000,
 * score items from 1000.
 */
export type Icon = { item: number; twice?: boolean } | { clip: string; frame?: string };

/** The side of the square every picture is drawn in (CSS px; drawn at twice that). */
const BOX = 96;
const RESOLUTION = 2;

/**
 * The game's own drawings as pictures for the HTML pages (UI redesign D.2): a clip from the
 * SWF library drawn once, fitted and centered in a square, and kept as a data URL. The pages
 * size and tint them with CSS (a grey or a silhouette for items not found yet). Drawn the first
 * time a page asks, so the fridge only draws the items of the page showing.
 */
export class ItemArt {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly lib: SwfLibrary,
    private readonly renderer: Renderer,
  ) {}

  /** The picture of `icon`, as a URL for an `<img>`; empty if the clip cannot be drawn. */
  url(icon: Icon): string {
    const key = 'item' in icon ? `i${icon.item}` : `c${icon.clip}:${icon.frame ?? '1'}`;
    let url = this.cache.get(key);
    if (url === undefined) {
      url = this.draw(icon);
      this.cache.set(key, url);
    }
    return url;
  }

  private draw(icon: Icon): string {
    let mc;
    try {
      if ('item' in icon) {
        const id = icon.item;
        mc = this.lib.attach(id >= 1000 ? 'hammer_item_score' : 'hammer_item_special');
        mc.gotoAndStop(String(id >= 1000 ? id - 999 : id + 1));
      } else {
        mc = this.lib.attach(icon.clip);
        mc.gotoAndStop(icon.frame ?? '1');
      }
    } catch {
      return '';
    }
    const holder = new Container();
    holder.addChild(mc);
    try {
      const b = mc.getLocalBounds();
      const fit = Math.min(3.2, (BOX - 4) / Math.max(b.width, b.height, 1));
      mc.scale.set(fit);
      mc.position.set(BOX / 2 - (b.x + b.width / 2) * fit, BOX / 2 - (b.y + b.height / 2) * fit);
      const canvas = this.renderer.extract.canvas({
        target: holder,
        frame: new Rectangle(0, 0, BOX, BOX),
        resolution: RESOLUTION,
        clearColor: [0, 0, 0, 0],
      }) as HTMLCanvasElement;
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    } finally {
      holder.destroy({ children: true });
    }
  }
}
