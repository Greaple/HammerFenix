import type { SwfLibrary } from './swf/SwfLibrary';
import { SwfMovieClip } from './swf/SwfMovieClip';

interface PlanData {
  tbl: (SwfMovieClip | null)[];
  cur: number;
}

/**
 * Port of Motion Twin's `DepthManager` (`mtypes/lib/DepthManager.mt`).
 *
 * Partitions a parent `SwfMovieClip`'s z-order into planes (`plan * 1000 + slot`),
 * matching `Data.DP_*` render layers (`DP_BACK_LAYER`, `DP_PLAYER`, `DP_BADS`, etc.).
 */
export class DepthManager {
  readonly root: SwfMovieClip;
  readonly lib: SwfLibrary;
  private plans: (PlanData | undefined)[] = [];

  constructor(root: SwfMovieClip) {
    this.root = root;
    this.lib = root.lib;
  }

  getMC(): SwfMovieClip {
    return this.root;
  }

  private getPlan(pnb: number): PlanData {
    let p = this.plans[pnb];
    if (!p) {
      p = { tbl: [], cur: 0 };
      this.plans[pnb] = p;
    }
    return p;
  }

  compact(plan: number): void {
    const pd = this.getPlan(plan);
    const p = pd.tbl;
    let cur = 0;
    const base = plan * 1000;
    for (let i = 0; i < pd.cur; i++) {
      const mc = p[i];
      if (mc && mc.parent === this.root) {
        mc.swapDepths(base + cur);
        p[cur] = mc;
        cur++;
      }
    }
    p.length = cur;
    pd.cur = cur;
  }

  attach(linkage: string, plan: number): SwfMovieClip {
    const pd = this.getPlan(plan);
    if (pd.cur >= 1000) {
      this.compact(plan);
      if (pd.cur >= 1000) pd.cur = 999;
    }
    const d = pd.cur;
    const mc = this.lib.attach(linkage);
    const depth = d + plan * 1000;
    mc.mcDepth = depth;
    mc.zIndex = depth;
    this.root.addChild(mc);
    pd.tbl[d] = mc;
    pd.cur++;
    return mc;
  }

  empty(plan: number): SwfMovieClip {
    const pd = this.getPlan(plan);
    if (pd.cur >= 1000) {
      this.compact(plan);
      if (pd.cur >= 1000) pd.cur = 999;
    }
    const d = pd.cur;
    const mc = this.lib.createEmptyClip();
    mc.mcName = `empty_${plan}_${d}`;
    const depth = d + plan * 1000;
    mc.mcDepth = depth;
    mc.zIndex = depth;
    this.root.addChild(mc);
    pd.tbl[d] = mc;
    pd.cur++;
    return mc;
  }

  swap(mc: SwfMovieClip, plan: number): void {
    const srcPlan = Math.floor(mc.getDepth() / 1000);
    if (srcPlan === plan) return;
    const src = this.getPlan(srcPlan);
    for (let i = 0; i < src.cur; i++) {
      if (src.tbl[i] === mc) {
        src.tbl[i] = null;
        break;
      }
    }
    const dst = this.getPlan(plan);
    if (dst.cur >= 1000) this.compact(plan);
    const d = dst.cur++;
    dst.tbl[d] = mc;
    mc.swapDepths(d + plan * 1000);
  }

  over(mc: SwfMovieClip): void {
    const depth = mc.getDepth();
    const plan = Math.floor(depth / 1000);
    const pd = this.getPlan(plan);
    const slot = depth % 1000;
    if (pd.tbl[slot] === mc) {
      pd.tbl[slot] = null;
      if (pd.cur >= 1000) this.compact(plan);
      const d = pd.cur++;
      mc.swapDepths(d + plan * 1000);
      pd.tbl[d] = mc;
    }
  }

  under(mc: SwfMovieClip): void {
    const depth = mc.getDepth();
    const plan = Math.floor(depth / 1000);
    const pd = this.getPlan(plan);
    const slot = depth % 1000;
    if (pd.tbl[slot] === mc) {
      pd.tbl[slot] = null;
      pd.tbl.unshift(mc);
      pd.cur++;
      this.compact(plan);
    }
  }

  clear(plan: number): void {
    const pd = this.plans[plan];
    if (!pd) return;
    for (let i = 0; i < pd.cur; i++) {
      pd.tbl[i]?.removeMovieClip();
    }
    pd.tbl.length = 0;
    pd.cur = 0;
  }

  destroy(): void {
    for (let i = 0; i < this.plans.length; i++) {
      if (this.plans[i]) this.clear(i);
    }
  }
}
