// =============================================================================
// promotion-layer.js
// On-board pawn-promotion piece picker for chessboard.js boards: when a pawn
// drop needs a promotion choice, the host page calls prompt() with the
// target square and the mover's color, and this module overlays four
// clickable squares (queen/rook/bishop/knight, using the same piece image
// assets chessboard.js itself uses) on top of the board, stacked from the
// target square in toward the center -- the usual lichess/chess.com
// promotion UI. Purely visual/interaction state that lives only in this
// module's closure; the host page never sees any DOM it creates.
//
// Usage from a page script, after constructing the Chessboard():
//   PromotionLayer.init(myChessboardInstance);
//   ...
//   PromotionLayer.prompt('e8', 'w', function (piece) {
//     // piece is 'q' | 'r' | 'b' | 'n', or null if the picker was dismissed
//     // without a choice (e.g. clicked elsewhere, pressed Escape).
//   });
// =============================================================================

(function () {
  'use strict';

  var PIECES = ['q', 'r', 'b', 'n'];

  var board = null;
  var wrapEl = null;
  var cancelActive = null; // set while a picker is open

  function init(boardInstance, options) {
    var opts = options || {};
    wrapEl = document.querySelector(opts.wrapSelector || '.board-wrap');
    board = boardInstance;
  }

  function prompt(square, color, onChoose) {
    // Only one picker makes sense at a time -- a stray leftover from a prior
    // drop (there shouldn't be one, but defensively) is dismissed first
    // rather than letting two overlays stack.
    if (cancelActive) {
      cancelActive();
    }
    if (!wrapEl) {
      onChoose(null);
      return;
    }

    var $layer = buildLayer(square, color, finish);
    $(wrapEl).append($layer);

    function finish(piece) {
      teardown();
      onChoose(piece);
    }

    function cancel() {
      finish(null);
    }

    function teardown() {
      $layer.remove();
      $(document).off('mousedown.promotionLayer keydown.promotionLayer');
      cancelActive = null;
    }

    // Any interaction outside the four choice squares -- another click on
    // the board, or anywhere else on the page -- dismisses the picker rather
    // than leaving it stuck open.
    $(document).on('mousedown.promotionLayer', function (e) {
      if (!$(e.target).closest('.promotion-layer').length) {
        cancel();
      }
    });
    $(document).on('keydown.promotionLayer', function (e) {
      if (e.key === 'Escape') {
        cancel();
      }
    });

    cancelActive = cancel;
  }

  // Lays the four choices out along the promotion file, starting at the
  // target square and extending toward the center of the board. The target
  // rank is always a board edge (row 0 or row 7) regardless of board
  // orientation -- that's what makes it a promotion in the first place --
  // so `direction` alone decides which way the stack grows.
  function buildLayer(square, color, onPick) {
    var orientation = (board && typeof board.orientation === 'function') ? board.orientation() : 'white';
    var file = square.charCodeAt(0) - 97; // 'a' -> 0 .. 'h' -> 7
    var rank = parseInt(square.charAt(1), 10); // 1..8
    var col = orientation === 'black' ? 7 - file : file;
    var row = orientation === 'black' ? rank - 1 : 8 - rank;
    var direction = row === 0 ? 1 : -1;

    var $layer = $('<div>', { class: 'promotion-layer' });
    PIECES.forEach(function (piece, index) {
      var $choice = $('<div>', { class: 'promotion-layer-choice' });
      $choice.css({
        left: (col * 12.5) + '%',
        top: ((row + direction * index) * 12.5) + '%'
      });
      $choice.append($('<img>', { src: '/imgs/' + color + piece.toUpperCase() + '.png', alt: piece }));
      $choice.on('click', function (e) {
        e.stopPropagation();
        onPick(piece);
      });
      $layer.append($choice);
    });
    return $layer;
  }

  window.PromotionLayer = { init: init, prompt: prompt };
})();
