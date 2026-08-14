// =============================================================================
// api-client.js
// Thin fetch() wrapper for this app's /api/* endpoints. Kept as its own
// module -- API communication is a cohesive concern, not a page-specific
// utility -- so any page needing the engine endpoints reuses this rather
// than duplicating fetch/JSON boilerplate.
// =============================================================================

(function () {
  'use strict';

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error((data && data.error) || 'Request failed');
        }
        return data;
      });
    });
  }

  // { evaluation: { type, value }, in_check, is_mate }
  function getEngineEval(params) {
    return postJson('/api/engine/eval', params);
  }

  // { moves: [{ move, score: { type, value } }, ...] }
  function getEngineBestMoves(params) {
    return postJson('/api/engine/bestmove', params);
  }

  // { opening: { eco, name } | null }
  function detectOpening(params) {
    return postJson('/api/opening/detect', params);
  }

  window.ApiClient = {
    getEngineEval: getEngineEval,
    getEngineBestMoves: getEngineBestMoves,
    detectOpening: detectOpening
  };
})();
