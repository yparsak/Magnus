// =============================================================================
// analysis.chess.js
// Analysis board page only (see views/pages/analysis.ejs). Builds the game
// from the FEN handed down via window.MAGNUS_PAGE_DATA and handles
// drag-to-move, move-tree browsing, and arrow-key stepping. Move-tree/
// variation logic itself lives in the reusable move-tree.js/move-tree-view.js
// modules; this file is just the page-specific glue between chess.js,
// chessboard.js, and those modules.
// =============================================================================

$(function () {
  if (!$('#board').length) {
    return;
  }

  var analysisBoard = null;

  // Authoritative chess.js game -- always kept in sync with the position of
  // whichever node the move tree is currently pointed at (see
  // renderViewPosition), so dragging a move always plays from what's on
  // screen, not just from the tip of the main line.
  var game = null;
  var analysisInitialFen = null;
  var tree = null;

  initAnalysis();
  bindControls();

  function initAnalysis() {
    var pageData = window.MAGNUS_PAGE_DATA || {};
    var fen = pageData.fen;

    // A missing fen means "start a fresh analysis" (e.g. the nav link) --
    // default to the standard starting position instead of bouncing away.
    // A present-but-invalid fen is unexpected, so fall back the same way
    // rather than handing a malformed string to `new Chess(fen)`.
    game = (fen && new Chess().validate_fen(fen).valid) ? new Chess(fen) : new Chess();
    analysisInitialFen = game.fen();
    tree = window.MoveTree.createTree(analysisInitialFen);

    analysisBoard = Chessboard('board', {
      draggable: true,
      position: game.fen(),
      pieceTheme: '/imgs/{piece}.png',
      onDragStart: onAnalysisDragStart,
      onDrop: onAnalysisDrop,
      onSnapEnd: function () {
        analysisBoard.position(game.fen());
      }
    });

    if (window.BoardAnnotations) {
      window.BoardAnnotations.init(analysisBoard);
    }
    if (window.PromotionLayer) {
      window.PromotionLayer.init(analysisBoard);
    }

    renderMoveList();
    $('#fenInput').val(game.fen());
  }

  function bindControls() {
    $('#linkBackToEditor').on('click', function (e) {
      e.preventDefault();
      window.location.href = '/editor?fen=' + encodeURIComponent(game.fen());
    });

    $(document).on('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepView(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepView(1);
      }
    });

    $(window).on('resize', function () {
      if (analysisBoard) analysisBoard.resize();
    });
  }

  function onAnalysisDragStart(source, piece) {
    if (game.game_over()) {
      return false;
    }
    if ((game.turn() === 'w' && piece.charAt(0) === 'b') ||
        (game.turn() === 'b' && piece.charAt(0) === 'w')) {
      return false;
    }
  }

  // Dragging is allowed from any node the user is currently viewing, not
  // just the tip -- `game` mirrors whatever node is current (see
  // renderViewPosition), so a move made here is simply a continuation from
  // that node. tree.addMove takes care of reusing a matching child if one
  // already exists, or otherwise adding this as a new side line alongside
  // any continuation(s) that node already had, without disturbing them.
  function onAnalysisDrop(source, target) {
    if (isPromotionMove(source, target)) {
      // chessboard.js's onDrop has no async return -- the picker can't
      // resolve before this function has to answer, so the drop is always
      // snapped back here. If the user does pick a piece, handlePromotionMove
      // plays it explicitly and repositions the board itself.
      handlePromotionMove(source, target);
      return 'snapback';
    }

    var moveObj = game.move({ from: source, to: target, promotion: 'q' });
    if (moveObj === null) {
      return 'snapback';
    }
    completeMove(moveObj);
  }

  // True when some legal move from `source` to `target` is a promotion --
  // i.e. chess.js would only accept it with a `promotion` field. Asking
  // chess.js this way (rather than re-deriving "pawn moving to the back
  // rank" here) keeps this in sync with its own move legality for free.
  function isPromotionMove(source, target) {
    var candidates = game.moves({ square: source, verbose: true });
    return candidates.some(function (move) {
      return move.to === target && move.promotion;
    });
  }

  function handlePromotionMove(source, target) {
    if (!window.PromotionLayer) {
      return;
    }
    window.PromotionLayer.prompt(target, game.turn(), function (piece) {
      if (!piece) {
        return;
      }
      var moveObj = game.move({ from: source, to: target, promotion: piece });
      if (moveObj === null) {
        return;
      }
      completeMove(moveObj);
      analysisBoard.position(game.fen());
    });
  }

  // Shared tail end of a completed move, regardless of whether it was played
  // straight from onAnalysisDrop or resolved asynchronously via the
  // promotion picker.
  function completeMove(moveObj) {
    tree.addMove(tree.getCurrent(), {
      san: moveObj.san,
      from: moveObj.from,
      to: moveObj.to,
      promotion: moveObj.promotion || null,
      color: moveObj.color,
      fen: game.fen()
    });

    renderMoveList();
    $('#fenInput').val(game.fen());

    if (window.BoardAnnotations) {
      window.BoardAnnotations.clear();
    }
  }

  // Single choke point that syncs the board, the authoritative `game`, and
  // the fen field to whatever node the tree currently points at. Every
  // navigation path (arrow keys, move-tree clicks) funnels through here, so
  // it's also the single place that clears stale drawings.
  function renderViewPosition() {
    var node = tree.getCurrent();
    game.load(node.fen);
    analysisBoard.position(node.fen, false);
    $('#fenInput').val(node.fen);

    if (window.BoardAnnotations) {
      window.BoardAnnotations.clear();
    }
  }

  function stepView(delta) {
    if (delta < 0) {
      applyStepResult(tree.stepBack());
      return;
    }

    var result = tree.stepForward();
    if (result.status === 'ambiguous') {
      promptVariationChoice(result.choices);
      return;
    }
    applyStepResult(result);
  }

  function applyStepResult(result) {
    if (result.status !== 'moved') {
      return;
    }
    renderViewPosition();
    renderMoveList();
  }

  // More than one continuation exists from here (main line vs. side
  // line(s)) -- ask which one to follow rather than guessing.
  function promptVariationChoice(choices) {
    var options = choices.map(function (node, index) {
      return { label: (index === 0 ? 'Main line: ' : 'Variation: ') + describeMove(node), value: node };
    });

    window.ChoiceModal.prompt('Choose a line', options, function (chosenNode) {
      tree.goToNode(chosenNode);
      renderViewPosition();
      renderMoveList();
    });
  }

  function describeMove(node) {
    var moveNumber = Math.ceil(node.ply / 2);
    var isWhiteMove = node.ply % 2 === 1;
    return moveNumber + (isWhiteMove ? '. ' : '... ') + node.move.san;
  }

  function renderMoveList() {
    window.MoveTreeView.render($('#moveList')[0], tree, tree.getCurrent(), {
      onSelectNode: onMoveSelected
    });
  }

  // Clicking a move in the tree jumps straight to it -- no ambiguity here,
  // it's an explicit click on one specific line.
  function onMoveSelected(node) {
    tree.goToNode(node);
    renderViewPosition();
    renderMoveList();
  }
});
