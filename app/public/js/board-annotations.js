// =============================================================================
// board-annotations.js
// Lichess/chess.com-style annotation drawing on top of a chessboard.js board:
// Shift+click a square draws a circle on it, Shift+drag from one square to
// another draws an arrow between them. Holding Cmd (or Ctrl) together with
// Shift switches the color to blue instead of green. Repeating the same
// Shift+click or Shift+drag on a square/pair that already has a shape on it
// removes that shape instead of adding another (toggle), regardless of what
// color it currently is. Purely visual state that lives only in this
// module's closure -- the host page calls clear() whenever the displayed
// position changes (new move, navigation, etc).
//
// Usage from a page script, after constructing the Chessboard():
//   BoardAnnotations.init(myChessboardInstance);
//   ...
//   BoardAnnotations.clear(); // wherever the displayed position changes
// =============================================================================

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var COLORS = {
    green: 'rgba(21, 120, 26, 0.75)',
    blue: 'rgba(20, 85, 170, 0.8)'
  };

  var board = null;
  var boardEl = null;
  var wrapEl = null;
  var svg = null;
  var shapes = [];
  var pendingDraw = null; // { fromSquare, color }

  function init(boardInstance, options) {
    var opts = options || {};
    boardEl = document.querySelector(opts.boardSelector || '#board');
    wrapEl = document.querySelector(opts.wrapSelector || '.board-wrap');
    if (!boardEl || !wrapEl) {
      return;
    }

    board = boardInstance;
    buildOverlay();
    bindInput();
  }

  function buildOverlay() {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'board-annotations-layer');
    // A fixed 8x8 logical viewBox stretched over the board's actual box means
    // shapes stored in square-grid units reposition/resize automatically
    // whenever the board's box changes -- no resize listener needed.
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.appendChild(buildArrowheadDefs());
    wrapEl.appendChild(svg);
  }

  function buildArrowheadDefs() {
    var defs = document.createElementNS(SVG_NS, 'defs');
    Object.keys(COLORS).forEach(function (color) {
      var marker = document.createElementNS(SVG_NS, 'marker');
      setAttrs(marker, {
        id: markerId(color),
        viewBox: '0 0 10 10',
        refX: '8.5',
        refY: '5',
        markerWidth: '3.2',
        markerHeight: '3.2',
        orient: 'auto-start-reverse'
      });
      var arrowPath = document.createElementNS(SVG_NS, 'path');
      setAttrs(arrowPath, { d: 'M 0 0 L 10 5 L 0 10 z', fill: COLORS[color] });
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
    });
    return defs;
  }

  function markerId(color) {
    return 'board-annotation-arrowhead-' + color;
  }

  function bindInput() {
    // Capture phase so this runs before chessboard.js's own delegated
    // mousedown handler (bound during the bubble phase on the inner
    // .board-b72b1 element) and before its body-level image-drag guard.
    // Calling stopPropagation() here -- only when Shift is held -- keeps
    // normal piece drag-and-drop completely untouched otherwise.
    boardEl.addEventListener('mousedown', onMouseDown, true);
  }

  function onMouseDown(e) {
    if (!e.shiftKey || e.button !== 0) {
      return;
    }
    var squareEl = e.target.closest ? e.target.closest('[data-square]') : null;
    if (!squareEl) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    pendingDraw = {
      fromSquare: squareEl.getAttribute('data-square'),
      color: (e.metaKey || e.ctrlKey) ? 'blue' : 'green'
    };
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseUp(e) {
    document.removeEventListener('mouseup', onMouseUp, true);
    var draw = pendingDraw;
    pendingDraw = null;
    if (!draw) {
      return;
    }

    var targetEl = document.elementFromPoint(e.clientX, e.clientY);
    var squareEl = targetEl && targetEl.closest ? targetEl.closest('[data-square]') : null;
    if (!squareEl) {
      return;
    }

    var toSquare = squareEl.getAttribute('data-square');
    if (toSquare === draw.fromSquare) {
      if (removeMatchingShape('circle', draw.fromSquare, draw.fromSquare)) {
        render();
        return;
      }
      shapes.push({ type: 'circle', color: draw.color, from: draw.fromSquare, to: draw.fromSquare });
    } else {
      if (removeMatchingShape('arrow', draw.fromSquare, toSquare)) {
        render();
        return;
      }
      shapes.push({ type: 'arrow', color: draw.color, from: draw.fromSquare, to: toSquare });
    }
    render();
  }

  // Toggle-off support: a repeat Shift+click/drag over the same square(s)
  // removes the existing shape instead of stacking a new one on top, no
  // matter which color it was drawn with -- geometry alone decides the match.
  function removeMatchingShape(type, from, to) {
    var index = shapes.findIndex(function (shape) {
      return shape.type === type && shape.from === from && shape.to === to;
    });
    if (index === -1) {
      return false;
    }
    shapes.splice(index, 1);
    return true;
  }

  function clear() {
    shapes = [];
    if (svg) {
      render();
    }
  }

  function render() {
    Array.prototype.slice.call(svg.children).forEach(function (child) {
      if (child.tagName.toLowerCase() !== 'defs') {
        svg.removeChild(child);
      }
    });

    var orientation = (board && typeof board.orientation === 'function') ? board.orientation() : 'white';
    shapes.forEach(function (shape) {
      svg.appendChild(shape.type === 'circle' ? buildCircle(shape, orientation) : buildArrow(shape, orientation));
    });
  }

  function buildCircle(shape, orientation) {
    var center = squareCenter(shape.from, orientation);
    var circle = document.createElementNS(SVG_NS, 'circle');
    setAttrs(circle, {
      cx: center.x,
      cy: center.y,
      r: 0.36,
      fill: 'none',
      stroke: COLORS[shape.color],
      'stroke-width': 0.09
    });
    return circle;
  }

  function buildArrow(shape, orientation) {
    var from = squareCenter(shape.from, orientation);
    var to = squareCenter(shape.to, orientation);
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var shortenBy = 0.4; // leave room for the arrowhead marker
    var endX = to.x - (dx / dist) * shortenBy;
    var endY = to.y - (dy / dist) * shortenBy;

    var line = document.createElementNS(SVG_NS, 'line');
    setAttrs(line, {
      x1: from.x,
      y1: from.y,
      x2: endX,
      y2: endY,
      stroke: COLORS[shape.color],
      'stroke-width': 0.18,
      'stroke-linecap': 'round',
      'marker-end': 'url(#' + markerId(shape.color) + ')'
    });
    return line;
  }

  // Generic square -> logical grid coordinate mapping. Reads the board's own
  // orientation() (chessboard.js exposes this) rather than assuming a fixed
  // layout, so this keeps working if orientation is ever made configurable.
  function squareCenter(square, orientation) {
    var file = square.charCodeAt(0) - 97; // 'a' -> 0 .. 'h' -> 7
    var rank = parseInt(square.charAt(1), 10); // 1..8
    var col = orientation === 'black' ? 7 - file : file;
    var row = orientation === 'black' ? rank - 1 : 8 - rank;
    return { x: col + 0.5, y: row + 0.5 };
  }

  function setAttrs(el, attrs) {
    Object.keys(attrs).forEach(function (name) {
      el.setAttribute(name, attrs[name]);
    });
  }

  window.BoardAnnotations = {
    init: init,
    clear: clear
  };
})();
