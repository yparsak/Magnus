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

  // Bumped on every opening-book fetch; same stale-response guard as
  // engineRequestSeq above, for the same reason (fast navigation vs. an
  // in-flight request).
  var openingRequestSeq = 0;

  // The square a tap-to-move interaction has currently picked up, or null if
  // none -- see bindBoardTapToMove/handleSquareTap. Touch-only convenience;
  // drag-and-drop (onAnalysisDrop) doesn't use this at all.
  var selectedSquare = null;

  // Timer for reverting the Copy FEN button's "Copied!" feedback state (see
  // copyFenToClipboard) -- kept so a rapid second click resets the timeout
  // instead of stacking multiple reverts.
  var copyFenFeedbackTimer = null;

  initAnalysis();
  bindControls();

  function initAnalysis() {
    var pageData = window.MAGNUS_PAGE_DATA || {};
    var fen = pageData.fen;
    var moves = pageData.moves;
    var gameInfo = pageData.gameInfo;
    var orientation = pageData.orientation || 'white';

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
      orientation: orientation,
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

    renderGameInfo(gameInfo, orientation);
    if (pageData.opening) {
      // A stored game already has its opening resolved server-side (see
      // analysisRouter.js, which persists book_id from the game's actual
      // recorded moves) -- that's authoritative for the game as played, so
      // paint it directly and skip the live-detection round trip below. It
      // still kicks in the moment the user navigates (completeMove /
      // renderViewPosition), e.g. into a side line.
      renderOpeningBook(pageData.opening);
    } else {
      // A fresh analysis board (no stored game, or no opening resolved) --
      // nothing to show yet until moves are played.
      refreshOpeningBook();
    }
    renderMoveList();
    $('#fenInput').val(game.fen());
    refreshEnginePanel();
  }

  // Single choke point for "is this an archive game or a fresh analysis" --
  // populates the below-board game summary and the above/below-board player
  // labels when gameInfo is present (a loaded ?gameid=), or clears/hides them
  // otherwise so a fresh analysis board only shows the Opening Book section.
  function renderGameInfo(gameInfo, orientation) {
    var $details = $('#gameInfoDetails');
    var $top = $('#playerNameTop');
    var $bottom = $('#playerNameBottom');

    if (!gameInfo) {
      $details.empty().removeClass('visible');
      $top.empty();
      $bottom.empty();
      return;
    }

    $details.empty();
    appendGameInfoRow($details, 'Date',  formatGameDate(gameInfo.date),
                                'Time control', gameInfo.timeControl || '--');
//    appendGameInfoRow($details, 'White', formatPlayerName(gameInfo.white, gameInfo.whiteElo),
//                                'Black', formatPlayerName(gameInfo.black, gameInfo.blackElo));
    appendGameInfoRow($details, 'Result', gameInfo.result || '--',
                                'Termination', gameInfo.termination || '--');
    $details.addClass('visible');

    var whiteName = formatPlayerName(gameInfo.white, gameInfo.whiteElo);
    var blackName = formatPlayerName(gameInfo.black, gameInfo.blackElo);
    var bottomName = orientation === 'black' ? blackName : whiteName;
    var topName = orientation === 'black' ? whiteName : blackName;
    $top.text(topName);
    $bottom.text(bottomName);
  }

  function appendGameInfoRow($container, label1, value1, label2, value2) {
    var $row = $('<div>', { class: 'game-info-row' });

    var $column1 = $('<div>', { class: 'game-info-column' });
    $column1.append($('<span>', {
        class: 'game-info-label',
        text: label1
    }));
    $column1.append($('<span>', {
        class: 'game-info-value',
        text: value1
    }));

    var $column2 = $('<div>', { class: 'game-info-column' });
    $column2.append($('<span>', {
        class: 'game-info-label',
        text: label2
    }));
    $column2.append($('<span>', {
        class: 'game-info-value',
        text: value2
    }));

    $row.append($column1);
    $row.append($column2);

    $container.append($row);
  }

  function formatPlayerName(name, elo) {
    if (!name) {
      return '--';
    }
    return elo ? name + ' (' + elo + ')' : name;
  }

  function formatGameDate(date) {
    return date ? new Date(date).toLocaleDateString() : '--';
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

    // Same navigation the move list already uses when a move is clicked
    // (stepView -> tree.stepBack/stepForward) -- the toolbar buttons are
    // just another entry point into it, not a separate nav implementation.
    $('#prevMoveBtn').on('click', function () {
      stepView(-1);
    });
    $('#nextMoveBtn').on('click', function () {
      stepView(1);
    });

    $('#copyFenBtn').on('click', copyFenToClipboard);

    bindBoardTapToMove();

    $(window).on('resize', function () {
      if (analysisBoard) analysisBoard.resize();
    });
  }

  // Enables/disables the Previous/Next toolbar buttons to match whether the
  // node the tree is currently pointed at has a parent/child to step to.
  // Called from renderMoveList's single choke point, so it stays correct
  // after every navigation path (arrow keys, toolbar buttons, move-list
  // clicks, a completed drag/tap move, loading a stored game).
  function updateNavButtons() {
    var node = tree.getCurrent();
    $('#prevMoveBtn').prop('disabled', !node.parent);
    $('#nextMoveBtn').prop('disabled', node.children.length === 0);
  }

  function copyFenToClipboard() {
    var fen = $('#fenInput').val();
    navigator.clipboard.writeText(fen).then(function () {
      showCopyFenFeedback();
    });
  }

  function showCopyFenFeedback() {
    var $btn = $('#copyFenBtn');
    clearTimeout(copyFenFeedbackTimer);
    $btn.addClass('copied').text('Copied!');
    copyFenFeedbackTimer = setTimeout(function () {
      $btn.removeClass('copied').text('Copy');
    }, 1500);
  }

  // Tap-to-move: tapping a piece selects it (and highlights its legal
  // destinations), then tapping a second square attempts that move. Reuses
  // the exact same move-legality/completion path as drag-and-drop
  // (isPromotionMove/handlePromotionMove/completeMove) so tapped moves land
  // in the move tree identically to a dragged one. Delegated on '.square-
  // 55d63' -- the same stable per-square class the board-editor's erase-mode
  // click handler already relies on, so this coexists with chessboard.js's
  // own drag handling without any extra wiring.
  function bindBoardTapToMove() {
    $('#board').on('click', '.square-55d63', function () {
      var square = $(this).data('square');
      if (square) {
        handleSquareTap(square);
      }
    });
  }

  function handleSquareTap(square) {
    if (!selectedSquare) {
      trySelectSquare(square);
      return;
    }

    if (square === selectedSquare) {
      clearSquareSelection();
      return;
    }

    if (isPromotionMove(selectedSquare, square)) {
      var source = selectedSquare;
      clearSquareSelection();
      handlePromotionMove(source, square);
      return;
    }

    var moveObj = game.move({ from: selectedSquare, to: square, promotion: 'q' });
    if (moveObj === null) {
      // Not a legal destination for the selected piece -- if the tapped
      // square holds another piece of the side to move, treat this as
      // switching the selection to it rather than just canceling.
      clearSquareSelection();
      trySelectSquare(square);
      return;
    }

    clearSquareSelection();
    completeMove(moveObj);
    analysisBoard.position(game.fen());
  }

  function trySelectSquare(square) {
    var piece = game.get(square);
    if (game.game_over() || !piece || piece.color !== game.turn()) {
      return;
    }
    selectedSquare = square;
    highlightSelection(square);
  }

  function highlightSelection(square) {
    $('#board .square-' + square).addClass('square-selected');
    game.moves({ square: square, verbose: true }).forEach(function (move) {
      $('#board .square-' + move.to).addClass('square-legal-target');
    });
  }

  function clearSquareSelection() {
    if (!selectedSquare) {
      return;
    }
    $('#board .square-selected').removeClass('square-selected');
    $('#board .square-legal-target').removeClass('square-legal-target');
    selectedSquare = null;
  }

  function onAnalysisDragStart(source, piece) {
    // A tap-to-move selection may already be active (e.g. the user tapped a
    // piece, then switched to dragging instead) -- clear it so its
    // highlight doesn't linger through the drag.
    clearSquareSelection();

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
    refreshOpeningBook();

    clearSquareSelection();
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
    refreshOpeningBook();

    clearSquareSelection();
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
    updateNavButtons();
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

  // Opening detection is capped at the first 10 full moves (20 plies) --
  // matches the server-side cap in openingBook.js/findOpeningMatch.
  var OPENING_BOOK_MAX_PLIES = 20;

  // Ancestor moves (the branch actually being viewed, from tree.getPath) plus
  // whatever continues forward from the cursor along that line's own main
  // continuation. Without the forward half, parking the cursor early in a
  // stored game (e.g. ply 0, or just after move 1) would only see that many
  // moves and report a shallow match (e.g. "King's Pawn" for 1.e4) instead of
  // the deepest opening the line actually reaches within the first 10 moves.
  function collectOpeningSanMoves() {
    var sanMoves = tree.getPath(tree.getCurrent())
      .filter(function (node) { return node.move !== null; })
      .map(function (node) { return node.move.san; });

    var node = tree.getCurrent();
    while (sanMoves.length < OPENING_BOOK_MAX_PLIES && node.children.length) {
      node = node.children[0];
      sanMoves.push(node.move.san);
    }

    return sanMoves.slice(0, OPENING_BOOK_MAX_PLIES);
  }

  // Looks up the opening for the line currently being viewed, not just the
  // main line -- browsing into a side line within the first 10 moves updates
  // the display to that branch's opening. Called on load and from every
  // position-changing path (renderViewPosition, completeMove), same as
  // refreshEnginePanel.
  function refreshOpeningBook() {
    var requestId = ++openingRequestSeq;
    var sanMoves = collectOpeningSanMoves();

    window.ApiClient.detectOpening({ moves: sanMoves }).then(function (result) {
      if (requestId !== openingRequestSeq) {
        return; // a newer request has since been fired -- drop this stale one
      }
      renderOpeningBook(result.opening);
    }).catch(function () {
      if (requestId !== openingRequestSeq) {
        return;
      }
      renderOpeningBook(null);
    });
  }

  function renderOpeningBook(opening) {
    var $info = $('#openingBookInfo');
    if (!opening) {
      $info.text('Not yet available');
    } else if (opening.eco === '?') {
      $info.text('Unrecognized opening');
    } else {
      $info.text(opening.eco + ' – ' + opening.name);
    }
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
