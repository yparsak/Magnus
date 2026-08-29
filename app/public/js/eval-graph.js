// =============================================================================
// eval-graph.js
// Plain <canvas> line graph of engine evaluation (pawns, White's perspective)
// across the plies of the game currently on screen -- no chart library, per
// the analysis page's requirements. Pure rendering module: the host page
// (analysis.chess.js) owns the move tree and just hands over an ordered
// points array on every position change.
//
// Usage:
//   EvalGraph.init(document.getElementById('evalGraphCanvas'));
//   EvalGraph.render([{ ply: 0, eval: 0 }, { ply: 1, eval: 0.3 }, ...]);
//   // on window resize, alongside analysisBoard.resize():
//   EvalGraph.resize();
// =============================================================================

(function () {
  'use strict';

  // Y-axis half-scales never collapse below this many pawns either side of
  // zero -- keeps a flat/all-zero game (or the very first point) from
  // dividing by zero, and keeps tiny wobbles from filling the whole height.
  var MIN_HALF_RANGE = 0.1;

  var ZERO_LINE_COLOR = 'rgba(224, 224, 224, 0.25)';
  var LINE_COLOR = '#2c73b8';
  var LINE_WIDTH = 2;

  var canvas = null;
  var ctx = null;
  var cssWidth = 0;
  var cssHeight = 0;
  var lastPoints = [];

  function init(canvasEl) {
    if (!canvasEl) {
      return;
    }
    canvas = canvasEl;
    measure();
    draw();
  }

  // Re-measures the canvas's CSS box and rebuilds its backing store at
  // devicePixelRatio so strokes stay crisp on high-DPI screens, then scales
  // the drawing context so every subsequent draw() call can keep working in
  // CSS-pixel coordinates.
  function measure() {
    if (!canvas) {
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    cssWidth = rect.width;
    cssHeight = rect.height;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render(points) {
    lastPoints = points || [];
    draw();
  }

  function resize() {
    if (!canvas) {
      return;
    }
    measure();
    draw();
  }

  // Points whose eval has actually resolved, in order, stopping at the first
  // unresolved (null/undefined) entry -- a live move whose engine eval hasn't
  // come back yet just isn't drawn as part of the line yet (0 is a real
  // evaluation here, not a stand-in for "unknown").
  function resolvedPrefix(points) {
    var resolved = [];
    for (var i = 0; i < points.length; i++) {
      if (points[i].eval === null || points[i].eval === undefined) {
        break;
      }
      resolved.push(points[i]);
    }
    return resolved;
  }

  function draw() {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var centerY = cssHeight / 2;
    drawZeroLine(centerY);

    var resolved = resolvedPrefix(lastPoints);
    if (resolved.length < 2) {
      return;
    }

    var totalPoints = lastPoints.length;
    var xStep = totalPoints > 1 ? cssWidth / (totalPoints - 1) : 0;
    var scales = verticalScales(resolved);

    ctx.beginPath();
    resolved.forEach(function (point, index) {
      var x = xStep * index;
      var y = yForEval(point.eval, centerY, scales);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function drawZeroLine(centerY) {
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(cssWidth, centerY);
    ctx.strokeStyle = ZERO_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Two independent half-scales rather than one symmetric scale -- a real
  // game's white/black advantage magnitudes are rarely symmetric, so the
  // positive half is scaled against the highest eval seen and the negative
  // half against the (absolute) lowest, each reaching its own edge.
  function verticalScales(points) {
    var evals = points.map(function (point) { return point.eval; });
    var maxEval = Math.max(MIN_HALF_RANGE, evals.reduce(function (a, b) { return Math.max(a, b); }, 0));
    var minEval = Math.min(-MIN_HALF_RANGE, evals.reduce(function (a, b) { return Math.min(a, b); }, 0));
    return { maxEval: maxEval, minEval: minEval };
  }

  function yForEval(evalValue, centerY, scales) {
    if (evalValue >= 0) {
      return centerY - (evalValue / scales.maxEval) * centerY;
    }
    return centerY + (Math.abs(evalValue) / Math.abs(scales.minEval)) * centerY;
  }

  window.EvalGraph = {
    init: init,
    render: render,
    resize: resize
  };
})();
