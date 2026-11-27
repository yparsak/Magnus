// =============================================================================
// play.chess.js
// Play Engine page only (see views/pages/play_engine.ejs). A single live game
// against the local Stockfish, played from the standard starting position
// with no clock.
//
// Deliberately close to analysis.chess.js in look and plumbing (same board
// setup, same engine/opening panels, same speech and FEN controls) but a
// different animal underneath: there's no move tree to browse here. The
// server owns the game (see lib/playEngine.js) -- it replays the stored
// moves, validates yours, picks the engine's reply and saves both -- so the
// chess.js instance here is a local mirror kept for instant feedback, and
// anything the server rejects is rolled back from the last known-good move
// list rather than argued with.
// =============================================================================

$(function () {
  if (!$('#board').length) {
    return;
  }

  var board = null;

  // Local mirror of the server's position. Authoritative only for deciding
  // what to draw and which drags to allow -- see rebuildFrom().
  var game = new Chess();
  var startFen = game.fen();

  // A MoveTree holding one straight line. The tree/MoveTreeView pair is
  // reused purely for rendering the move list and feeding the eval graph;
  // a real game has no variations, so nothing here ever adds a second child
  // to a node.
  var tree = window.MoveTree.createTree(startFen);

  // The game as the server last confirmed it: an ordered array of
  // { san, from, to, promotion, color, fen }. Every redraw is derived from
  // this, so a rejected move or a failed request can always be undone by
  // rebuilding from it.
  var moves = [];

  var gameId = null;
  var userColor = 'w';
  var playerNames = { white: '', black: '' };
  var finished = false;

  // True while a request the game depends on is in flight (your move plus
  // the engine's reply, a take-back, a resignation). Input is refused for
  // the duration -- the engine takes ~1s+ (see lib/stockfish.js) and a
  // second move arriving mid-think would desync the board from the server.
  var busy = false;

  // Bumped on every engine-panel fetch; a response is only rendered if this
  // still matches the id it was fired with, so a slow evaluation landing
  // after a take-back can't repaint the panel with a stale position's score.
  // Same guard as analysis.chess.js uses, for the same reason.
  var engineRequestSeq = 0;
  var openingRequestSeq = 0;

  var selectedSquare = null;
  var copyFenFeedbackTimer = null;

  var moveSound = new Audio('/effects/move.mp3');

  // Opening detection is capped at the first 10 full moves (20 plies) --
  // matches the server-side cap in openingBook.js/findOpeningMatch.
  var OPENING_BOOK_MAX_PLIES = 20;

  initPlayPage();

  function initPlayPage() {
    var pageData = window.MAGNUS_PAGE_DATA || {};

    board = Chessboard('board', {
      draggable: true,
      position: startFen,
      orientation: 'white',
      pieceTheme: '/imgs/{piece}.png',
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: function () {
        board.position(game.fen());
      }
    });

    if (window.BoardAnnotations) {
      window.BoardAnnotations.init(board);
    }
    if (window.PromotionLayer) {
      window.PromotionLayer.init(board);
    }
    if (window.EvalGraph) {
      window.EvalGraph.init($('#evalGraphCanvas')[0]);
    }

    bindControls();

    if (pageData.game) {
      // Resuming a game (a refresh, or a link back to one still in
      // progress) -- adopt it as-is rather than asking for a side again.
      adoptGame(pageData.game);
    } else {
      promptForSide();
    }
  }

  // The side picker: two kings and an X. Dismissing it in any way (the X,
  // Escape, a click outside) means "I didn't want to start a game", which
  // returns to the main page rather than leaving an unusable empty board.
  function promptForSide() {
    window.ChoiceModal.prompt('Choose your side', [
      { label: 'White', value: 'w', image: '/imgs/wK.png' },
      { label: 'Black', value: 'b', image: '/imgs/bK.png' }
    ], startGame, {
      closable: true,
      onDismiss: function () {
        window.location.href = '/';
      }
    });
  }

  function startGame(side) {
    setBusy(true);
    window.ApiClient.startPlayGame({ side: side }).then(function (created) {
      adoptGame(created);
    }).catch(function (err) {
      showError(err.message || 'Could not start a game.');
    }).then(function () {
      setBusy(false);
    });
  }

  // Single entry point for "here is the game, show it" -- used by a freshly
  // started game, a resumed one, and the result of a take-back.
  function adoptGame(gameState) {
    gameId = gameState.gameId;
    userColor = gameState.userColor;
    playerNames = { white: gameState.white, black: gameState.black };
    finished = Boolean(gameState.finished);

    board.orientation(userColor === 'w' ? 'white' : 'black');
    renderPlayerNames();
    rebuildFrom(gameState.moves || []);

    if (finished) {
      showResultBanner(describeStoredResult(gameState));
    }
    // No evaluation is shown on an untouched board -- it only appears once
    // there's a move to evaluate.
    if (moves.length) {
      refreshEnginePanel();
    }
  }

  // Replays `confirmedMoves` into a fresh chess.js + tree and repaints
  // everything derived from them. This is the only place `moves`, `game`
  // and `tree` are (re)populated, so they can't drift apart.
  function rebuildFrom(confirmedMoves) {
    moves = confirmedMoves.slice();
    game = new Chess();
    tree = window.MoveTree.createTree(startFen);

    moves.forEach(function (move) {
      var moveObj = game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || undefined
      });
      if (!moveObj) {
        return;
      }
      tree.addMove(tree.getCurrent(), {
        san: moveObj.san,
        from: moveObj.from,
        to: moveObj.to,
        promotion: moveObj.promotion || null,
        color: moveObj.color,
        fen: game.fen()
      });
    });

    board.position(game.fen(), false);
    clearSquareSelection();
    if (window.BoardAnnotations) {
      window.BoardAnnotations.clear();
    }
    renderMoveList();
    $('#fenInput').val(game.fen());
    refreshEvalGraph();
    refreshOpeningBook();
    updateControls();
  }

  function renderPlayerNames() {
    var topName = userColor === 'w' ? playerNames.black : playerNames.white;
    var bottomName = userColor === 'w' ? playerNames.white : playerNames.black;
    $('#playerNameTop').text(topName || '');
    $('#playerNameBottom').text(bottomName || '');
  }

  // -- Controls ---------------------------------------------------------

  function bindControls() {
    $('#takeBackBtn').on('click', requestTakeBack);
    $('#resignBtn').on('click', confirmResign);
    $('#newGameBtn').on('click', goToNewGame);
    $('#bannerNewGameBtn').on('click', goToNewGame);
    $('#copyFenBtn').on('click', copyFenToClipboard);

    $('#linkToAnalysis').on('click', function (e) {
      e.preventDefault();
      window.location.href = '/analysis?fen=' + encodeURIComponent(game.fen());
    });

    bindBoardTapToMove();
    bindSoundToggle();

    $(window).on('resize', function () {
      if (board) board.resize();
      if (window.EvalGraph) window.EvalGraph.resize();
    });
  }

  // Keeps every control's enabled state tied to the one question that
  // decides it: can the user act right now?
  function updateControls() {
    var canAct = Boolean(gameId) && !busy && !finished;
    // There's nothing of the user's to take back until they've moved --
    // when they're Black the game opens with the engine's move, which
    // isn't theirs to undo.
    var hasOwnMove = moves.some(function (move) {
      return move.color === userColor;
    });

    $('#takeBackBtn').prop('disabled', !canAct || !hasOwnMove);
    $('#resignBtn').prop('disabled', !canAct || !moves.length);
    $('#newGameBtn').prop('disabled', busy);
  }

  function setBusy(value) {
    busy = value;
    $('#board').toggleClass('board-waiting', value);
    updateControls();
  }

  function goToNewGame() {
    // A plain reload lands on the page with no ?gameid=, which re-opens the
    // side picker -- no separate "abandon" step, the old game simply stays
    // in the archive as a result-less row.
    window.location.href = '/play/engine';
  }

  function confirmResign() {
    if (!gameId || finished || busy) {
      return;
    }
    window.ChoiceModal.prompt('Resign this game?', [
      { label: 'Resign', value: true },
      { label: 'Keep playing', value: false }
    ], function (shouldResign) {
      if (shouldResign) {
        doResign();
      }
    }, { closable: true });
  }

  function doResign() {
    setBusy(true);
    window.ApiClient.resignGame({ gameId: gameId }).then(function (result) {
      finished = true;
      showResultBanner(describeOutcome(result.outcome));
    }).catch(function (err) {
      showError(err.message || 'Could not resign.');
    }).then(function () {
      setBusy(false);
    });
  }

  function requestTakeBack() {
    if (!gameId || finished || busy) {
      return;
    }
    setBusy(true);
    if (window.cancelSpeech) {
      window.cancelSpeech();
    }
    window.ApiClient.takeBackMove({ gameId: gameId }).then(function (result) {
      rebuildFrom(result.moves || []);
      refreshEnginePanel();
    }).catch(function (err) {
      showError(err.message || 'Could not take back that move.');
    }).then(function () {
      setBusy(false);
    });
  }

  // -- Making a move ----------------------------------------------------

  function canMoveNow() {
    return Boolean(gameId) && !busy && !finished && game.turn() === userColor && !game.game_over();
  }

  function onDragStart(source, piece) {
    clearSquareSelection();

    if (!canMoveNow()) {
      return false;
    }
    // Only your own pieces, and only on your turn.
    if (piece.charAt(0) !== userColor) {
      return false;
    }
  }

  function onDrop(source, target) {
    if (!canMoveNow()) {
      return 'snapback';
    }

    if (isPromotionMove(source, target)) {
      // chessboard.js's onDrop has to answer synchronously and the picker
      // can't resolve by then, so the piece is always snapped back here;
      // handlePromotionMove repositions the board itself once a piece is
      // chosen. Same approach as the analysis board.
      handlePromotionMove(source, target);
      return 'snapback';
    }

    var moveObj = game.move({ from: source, to: target, promotion: 'q' });
    if (moveObj === null) {
      return 'snapback';
    }
    submitMove(moveObj);
  }

  // Tap-to-move, delegated on chessboard.js's own per-square class -- the
  // same mechanism the analysis board and the editor use, so taps and drags
  // share one move path.
  function bindBoardTapToMove() {
    $('#board').on('click', '.square-55d63', function () {
      var square = $(this).data('square');
      if (square) {
        handleSquareTap(square);
      }
    });
  }

  function handleSquareTap(square) {
    if (!canMoveNow()) {
      return;
    }

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
      clearSquareSelection();
      trySelectSquare(square);
      return;
    }

    clearSquareSelection();
    board.position(game.fen());
    submitMove(moveObj);
  }

  function trySelectSquare(square) {
    var piece = game.get(square);
    if (!piece || piece.color !== userColor || piece.color !== game.turn()) {
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

  // True when some legal move from `source` to `target` is a promotion --
  // asking chess.js rather than re-deriving "pawn to the back rank" keeps
  // this in step with its own legality rules for free.
  function isPromotionMove(source, target) {
    return game.moves({ square: source, verbose: true }).some(function (move) {
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
      board.position(game.fen());
      submitMove(moveObj);
    });
  }

  // The move has already been applied to the local `game` for immediate
  // feedback; now it goes to the server, which is the one that decides it
  // really happened. A rejection (or a dropped connection) rewinds to the
  // last confirmed move list.
  function submitMove(moveObj) {
    setBusy(true);
    announceMove(moveObj.san);

    var played = {
      san: moveObj.san,
      from: moveObj.from,
      to: moveObj.to,
      promotion: moveObj.promotion || null,
      color: moveObj.color,
      fen: game.fen()
    };

    // Show the user's own move in the list straight away rather than after
    // the engine has finished thinking.
    moves.push(played);
    tree.addMove(tree.getCurrent(), played);
    renderMoveList();
    $('#fenInput').val(game.fen());

    window.ApiClient.playMove({
      gameId: gameId,
      from: moveObj.from,
      to: moveObj.to,
      promotion: moveObj.promotion || null
    }).then(function (result) {
      applyServerResult(result);
    }).catch(function (err) {
      showError(err.message || 'That move could not be played.');
      rebuildFrom(moves.slice(0, moves.length - 1));
    }).then(function () {
      setBusy(false);
      refreshEnginePanel();
    });
  }

  function applyServerResult(result) {
    if (result.engineMove) {
      var engineMoveObj = game.move({
        from: result.engineMove.from,
        to: result.engineMove.to,
        promotion: result.engineMove.promotion || undefined
      });
      if (engineMoveObj) {
        moves.push(result.engineMove);
        tree.addMove(tree.getCurrent(), {
          san: engineMoveObj.san,
          from: engineMoveObj.from,
          to: engineMoveObj.to,
          promotion: engineMoveObj.promotion || null,
          color: engineMoveObj.color,
          fen: game.fen()
        });
        // position() redraws from the FEN, so a promoted pawn comes back as
        // the piece it promoted to rather than a pawn sitting on the back
        // rank.
        board.position(game.fen());
        announceMove(engineMoveObj.san);
      }
    }

    renderMoveList();
    $('#fenInput').val(game.fen());
    refreshEvalGraph();
    refreshOpeningBook();

    if (result.outcome && result.outcome.over) {
      finished = true;
      showResultBanner(describeOutcome(result.outcome));
    }
    updateControls();
  }

  function announceMove(san) {
    playMoveSound();
    if (window.speak && window.sanToSpeech) {
      window.speak(window.sanToSpeech(san));
    }
  }

  function playMoveSound() {
    moveSound.currentTime = 0;
    moveSound.play().catch(function () {});
  }

  // -- Result banner ----------------------------------------------------

  function describeOutcome(outcome) {
    if (!outcome) {
      return 'Game over.';
    }
    var reason = outcome.reason ? ' by ' + outcome.reason : '';
    if (outcome.result === 'win') {
      return 'You won' + reason + '.';
    }
    if (outcome.result === 'loss') {
      return 'You lost' + reason + '.';
    }
    return 'Draw' + (outcome.reason ? ' by ' + outcome.reason : '') + '.';
  }

  // A resumed game only carries what was stored (result + termination), not
  // the live outcome object, so it gets its own phrasing.
  function describeStoredResult(gameState) {
    var termination = gameState.termination ? ' (' + gameState.termination + ')' : '';
    if (gameState.result === 'win') {
      return 'You won' + termination + '.';
    }
    if (gameState.result === 'loss') {
      return 'You lost' + termination + '.';
    }
    if (gameState.result === 'draw') {
      return 'Draw' + termination + '.';
    }
    return 'Game over' + termination + '.';
  }

  function showResultBanner(text) {
    $('#gameResultText').text(text);
    $('#gameResultBanner').removeClass('hidden');
    updateControls();
    if (window.speak) {
      window.speak(text, { queue: true });
    }
  }

  // -- Panels -----------------------------------------------------------

  function renderMoveList() {
    // A live game has nothing to browse to -- the list is a record of what
    // has been played, so clicking a move does nothing.
    window.MoveTreeView.render($('#moveList')[0], tree, tree.getCurrent(), {
      onSelectNode: function () {}
    });
  }

  // Evaluation only -- the Best Moves list is deliberately absent from this
  // page (see play_engine.ejs), so unlike the analysis board there's no
  // bestmove request here at all.
  function refreshEnginePanel() {
    var requestId = ++engineRequestSeq;
    var fen = game.fen();

    if (!moves.length) {
      // Back to the starting position (a take-back of the first move) --
      // blank the panel rather than leaving the previous score on screen.
      $('#enginePanel').removeClass('engine-panel-loading');
      $('#engineEvalScore').text('--');
      $('#engineEvalStatus').text('');
      return;
    }

    $('#enginePanel').addClass('engine-panel-loading');

    window.ApiClient.getEngineEval({ fen: fen }).then(function (evalResult) {
      if (requestId !== engineRequestSeq) {
        return; // a newer request has since been fired -- drop this stale one
      }
      renderEngineEval(evalResult);
    }).catch(function () {
      if (requestId !== engineRequestSeq) {
        return;
      }
      $('#enginePanel').removeClass('engine-panel-loading');
      $('#engineEvalScore').text('--');
      $('#engineEvalStatus').text('Engine unavailable');
    });
  }

  function renderEngineEval(evalResult) {
    $('#enginePanel').removeClass('engine-panel-loading');
    var evaluation = evalResult.evaluation || { type: 'cp', value: 0 };
    $('#engineEvalScore').text(formatEngineScore(evaluation));
    $('#engineEvalStatus').text(evalResult.is_mate ? 'Checkmate' : (evalResult.in_check ? 'Check' : ''));

    // Stamp the eval onto the move that produced this position so the graph
    // has a point for it, the same way analysis.chess.js does for live moves.
    var currentMove = tree.getCurrent().move;
    if (currentMove && currentMove.eval === null) {
      currentMove.eval = evalToPawns(evaluation);
      refreshEvalGraph();
    }
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

  // Mirrors scripts/evaluateGames.js's evalToPawns() so a live-resolved eval
  // matches how final_eval is computed for stored games.
  function evalToPawns(evaluation) {
    if (evaluation.type === 'mate') {
      return evaluation.value < 0 ? -100 : 100;
    }
    return evaluation.value / 100;
  }

  function refreshEvalGraph() {
    if (!window.EvalGraph) {
      return;
    }
    var points = [{ ply: 0, eval: 0 }].concat(tree.getMainLine().map(function (node) {
      return { ply: node.ply, eval: node.move.eval };
    }));
    window.EvalGraph.render(points, tree.getCurrent().ply);
  }

  function refreshOpeningBook() {
    var requestId = ++openingRequestSeq;
    var sanMoves = moves.slice(0, OPENING_BOOK_MAX_PLIES).map(function (move) {
      return move.san;
    });

    if (!sanMoves.length) {
      renderOpeningBook(null);
      return;
    }

    window.ApiClient.detectOpening({ moves: sanMoves }).then(function (result) {
      if (requestId !== openingRequestSeq) {
        return;
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

  // -- Misc -------------------------------------------------------------

  function bindSoundToggle() {
    if (!window.toggleSound) {
      return;
    }
    window.updateSoundButton();
    $('#soundToggleBtn').on('click', window.toggleSound);
  }

  function copyFenToClipboard() {
    navigator.clipboard.writeText($('#fenInput').val()).then(function () {
      var $btn = $('#copyFenBtn');
      clearTimeout(copyFenFeedbackTimer);
      $btn.addClass('copied').text('Copied!');
      copyFenFeedbackTimer = setTimeout(function () {
        $btn.removeClass('copied').text('Copy');
      }, 1500);
    });
  }
});
