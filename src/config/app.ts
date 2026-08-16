/**
 * Product-level constants shared by more than one surface.
 *
 * Each value here used to be declared independently in two or more components,
 * which meant a change to the campaign goal or the polling cadence could land
 * in one place and silently miss the other. One module, one number.
 */

/** The public testnet-signup goal shown on /join and /metrics. */
export const SIGNUP_GOAL = 50;

/**
 * How often live panels re-read chain and API state, in milliseconds.
 *
 * Matched to Stellar's ~6s ledger close so polling faster would only re-read
 * the same ledger. Used by the action feed and the funding watcher.
 */
export const LIVE_POLL_MS = 6000;
