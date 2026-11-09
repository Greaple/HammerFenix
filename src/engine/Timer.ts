/**
 * `Timer` of Motion Twin's `mtypes` library (not in this repo): `tmod`, how much game time the
 * current frame moves, which the game multiplies into its moves and timers. Flash recomputed it
 * each frame from the real frame time; the port runs fixed logic ticks of 1, so `tmod` is 1
 * except where the game sets it for one tick: bullet time and the dev keys Shift and Home
 * (`GameMode.main`, 0.3 and 1.0).
 */
export const Timer = {
  tmod: 1,
};
