'use strict';

/**
 * lib/glicko2.js
 * Minimal self-contained Glicko-2 implementation.
 *
 * All maths follow Mark Glickman's 2012 paper:
 *   http://www.glicko.net/glicko/glicko2.pdf
 *
 * This version handles a single rating period (one puzzle = one period),
 * which is appropriate for a real-time puzzle trainer.
 *
 * Units: ratings and deviations are in the public Glicko-2 scale (same as
 * Lichess), not the internal µ/φ scale.  Conversion is done internally.
 */

const TAU   = 0.5;   // System constant τ — controls volatility change speed.
                      // 0.3–1.2 recommended; 0.5 is Lichess default.
const SCALE = 173.7178; // Conversion factor between public and internal scales.
const EPSILON = 0.000001;

/**
 * Convert a public-scale rating to internal µ.
 */
function toMu(r) { return (r - 1500) / SCALE; }

/**
 * Convert a public-scale RD to internal φ.
 */
function toPhi(rd) { return rd / SCALE; }

/**
 * Convert internal µ back to public scale.
 */
function fromMu(mu) { return Math.round(mu * SCALE + 1500); }

/**
 * Convert internal φ back to public scale.
 */
function fromPhi(phi) { return Math.round(phi * SCALE); }

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Update a player's Glicko-2 rating after one rating period.
 *
 * @param {{ rating: number, deviation: number, volatility: number }} player
 *   Current player state in public scale.
 * @param {Array<{ rating: number, deviation: number, score: number }>} opponents
 *   Array of opponents faced this period. score is 1 (win) or 0 (loss).
 * @returns {{ rating: number, deviation: number, volatility: number }}
 *   Updated player state in public scale.
 */
function glicko2Update(player, opponents) {
  const mu  = toMu(player.rating);
  const phi = toPhi(player.deviation);
  const sigma = player.volatility;

  // Step 3: compute v (estimated variance)
  let v = 0;
  opponents.forEach(opp => {
    const muJ  = toMu(opp.rating);
    const phiJ = toPhi(opp.deviation);
    const gJ   = g(phiJ);
    const EJ   = E(mu, muJ, phiJ);
    v += gJ * gJ * EJ * (1 - EJ);
  });
  v = 1 / v;

  // Step 4: compute delta (estimated improvement)
  let delta = 0;
  opponents.forEach(opp => {
    const muJ  = toMu(opp.rating);
    const phiJ = toPhi(opp.deviation);
    const gJ   = g(phiJ);
    const EJ   = E(mu, muJ, phiJ);
    delta += gJ * (opp.score - EJ);
  });
  delta *= v;

  // Step 5: update volatility via Illinois algorithm
  const a = Math.log(sigma * sigma);
  const deltaSquared = delta * delta;
  const phiSquared   = phi * phi;

  let A = a;
  let B;
  if (deltaSquared > phiSquared + v) {
    B = Math.log(deltaSquared - phiSquared - v);
  } else {
    let k = 1;
    while (f(a - k * TAU, deltaSquared, phiSquared, v, a) < 0) k++;
    B = a - k * TAU;
  }

  function f(x, dSq, phSq, vv, aa) {
    const ex = Math.exp(x);
    const num = ex * (dSq - phSq - vv - ex);
    const den = 2 * Math.pow(phSq + vv + ex, 2);
    return num / den - (x - aa) / (TAU * TAU);
  }

  let fA = f(A, deltaSquared, phiSquared, v, a);
  let fB = f(B, deltaSquared, phiSquared, v, a);

  while (Math.abs(B - A) > EPSILON) {
    const C  = A + (A - B) * fA / (fB - fA);
    const fC = f(C, deltaSquared, phiSquared, v, a);
    if (fC * fB <= 0) { A = B; fA = fB; }
    else              { fA = fA / 2; }
    B  = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);

  // Step 6: update RD to new pre-period value
  const phiStar = Math.sqrt(phiSquared + sigmaPrime * sigmaPrime);

  // Step 7: update rating and RD
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime  = mu + phiPrime * phiPrime * (delta / v);

  return {
    rating:     fromMu(muPrime),
    deviation:  Math.max(fromPhi(phiPrime), 30),  // floor at 30 — prevents over-certainty
    volatility: sigmaPrime
  };
}

module.exports = { glicko2Update };
