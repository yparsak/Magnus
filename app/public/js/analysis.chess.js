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

  // Bumped on every engine-panel fetch; a response is only rendered if this
  // still matches the id it was fired with. The engine is slow (~1s+, see
  // stockfish.js) and the user can navigate faster than that, so an older
  // request finishing after a newer one would otherwise clobber the panel
  // with a stale position's data.
  var engineRequestSeq = 0;

  initAnalysis();
  bindControls();

  function initAnalysis() {
    var pageData = window.MAGNUS_PAGE_DATA || {};
    var fen = pageData.fen;
    var moves = pageData.moves;

    if (Array.isArray(moves) && moves.length) {
      // A stored game (?gameid=) -- replay it from the standard starting
      // position into the tree, then park the view at the start (ply 0) so
      // the user steps through it, same as opening a fresh game would feel.
      game = new Chess();
      analysisInitialFen = game.fen();
      tree = window.MoveTree.createTree(analysisInitialFen);
      moves.forEach(function (moveInfo) {
        tree.addMove(tree.getCurrent(), moveInfo);
      });
      tree.goToStart();
      game.load(tree.getCurrent().fen);
    } else {
      // A missing fen means "start a fresh analysis" (e.g. the nav link) --
      // default to the standard starting position instead of bouncing away.
      // A present-but-invalid fen is unexpected, so fall back the same way
      // rather than handing a malformed string to `new Chess(fen)`.
      game = (fen && new Chess().validate_fen(fen).valid) ? new Chess(fen) : new Chess();
      analysisInitialFen = game.fen();
      tree = window.MoveTree.createTree(analysisInitialFen);
    }

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
    refreshEnginePanel();
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
    refreshEnginePanel();

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
    refreshEnginePanel();

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

  // Fetches eval + top-10 best moves for whatever `game` currently holds and
  // renders them into the left panel. Called on load and from every
  // position-changing path (renderViewPosition, completeMove) so the panel
  // always reflects the position on screen, not just the position at load.
  function refreshEnginePanel() {
    var requestId = ++engineRequestSeq;
    var fen = game.fen();

    $('#enginePanel').addClass('engine-panel-loading');

    Promise.all([
      window.ApiClient.getEngineEval({ fen: fen }),
      window.ApiClient.getEngineBestMoves({ fen: fen })
    ]).then(function (results) {
      if (requestId !== engineRequestSeq) {
        return; // a newer request has since been fired -- drop this stale one
      }
      renderEnginePanel(results[0], results[1]);
    }).catch(function () {
      if (requestId !== engineRequestSeq) {
        return;
      }
      renderEnginePanelError();
    });
  }

  function renderEnginePanel(evalResult, bestMovesResult) {
    $('#enginePanel').removeClass('engine-panel-loading');
    renderEngineEval(evalResult);
    renderEngineMoveList(bestMovesResult.moves || []);
  }

  function renderEngineEval(evalResult) {
    var evaluation = evalResult.evaluation || { type: 'cp', value: 0 };
    $('#engineEvalScore').text(formatEngineScore(evaluation));

    var status = evalResult.is_mate ? 'Checkmate' : (evalResult.in_check ? 'Check' : '');
    $('#engineEvalStatus').text(status);
  }

  function renderEngineMoveList(moves) {
    var $list = $('#engineMoveList').empty();

    moves.forEach(function (entry, index) {
      var $item = $('<li>', { class: 'engine-move-item' });
      $item.append($('<span>', { class: 'engine-move-rank', text: (index + 1) + '.' }));

      var $san = $('<span>', { class: 'engine-move-san', text: entry.move });
      $san.data('san', entry.move);
      $item.append($san);

      $item.append($('<span>', { class: 'engine-move-score', text: formatEngineScore(entry.score) }));
      $list.append($item);
    });

    $list.find('.engine-move-san').on('click', function () {
      playEngineMove($(this).data('san'));
    });
  }

  // Score is already normalized to White's perspective server-side (see
  // engineApi.js) -- render it as-is, no sign flipping here.
  function formatEngineScore(score) {
    if (score.type === 'mate') {
      return 'M' + score.value;
    }
    var pawns = (score.value / 100).toFixed(2);
    return (score.value > 0 ? '+' : '') + pawns;
  }

  function renderEnginePanelError() {
    $('#enginePanel').removeClass('engine-panel-loading');
    $('#engineEvalScore').text('--');
    $('#engineEvalStatus').text('Engine unavailable');
    $('#engineMoveList').empty();
  }

  // Reuses the exact same tail end a drag-to-move uses (completeMove), so a
  // best-move click lands in the move tree/move list identically -- chess.js
  // accepts SAN directly, so no from/to/promotion parsing is needed here.
  function playEngineMove(san) {
    var moveObj = game.move(san);
    if (moveObj === null) {
      return;
    }
    completeMove(moveObj);
    analysisBoard.position(game.fen());
  }
});
