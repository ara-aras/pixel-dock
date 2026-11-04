/**
 * Material 3 Expressive motion springs, converted to Motion's stiffness/damping.
 *
 * M3 specifies springs as (damping ratio, stiffness) with mass 1. Motion wants an
 * absolute damping coefficient: damping = ratio * 2 * sqrt(stiffness * mass).
 * "Spatial" springs move things (size, position) and may overshoot a little;
 * "effects" springs fade colour/opacity and never overshoot (ratio 1).
 */
function m3Spring(dampingRatio: number, stiffness: number) {
  return {
    type: "spring" as const,
    stiffness,
    damping: dampingRatio * 2 * Math.sqrt(stiffness),
    mass: 1,
  };
}

export const MATERIAL_SPRINGS = {
  spatialFast: m3Spring(0.6, 800),
  spatialDefault: m3Spring(0.8, 380),
  spatialSlow: m3Spring(0.8, 200),
  effectsFast: m3Spring(1, 3800),
  effectsDefault: m3Spring(1, 1600),
  effectsSlow: m3Spring(1, 800),
} as const;
