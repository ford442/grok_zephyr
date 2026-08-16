/** Inter-satellite optical links (space laser mesh). */

/** Hard cap — 128k segments × 32 B = 4 MiB. */
export const MAX_ISL_LINKS = 131072;

/** Directed edges written per participating satellite (same-plane +, next-plane). */
export const ISL_LINKS_PER_SAT = 2;

export const ISL_MAX_RANGE_KM = 5500;

export const ISL_PARAM_BYTES = 32;
