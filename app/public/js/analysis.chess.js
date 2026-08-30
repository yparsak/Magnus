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

  // Timer driving autoplay's step-forward loop (see startAutoplay/
  // autoplayStep) -- non-null exactly while autoplay is running, so it also
  // doubles as the "is autoplay active" flag and lets pause/cleanup just
  // clearTimeout it unconditionally. While a blunder demo is being built
  // (see startBlunderDemo) there's no real timer to hold yet, so this is set
  // to a harmless placeholder instead of a setTimeout id -- it just needs to
  // stay truthy so togglePlayPause still reads autoplay as "running".
  var autoplayTimer = null;
  var AUTOPLAY_STEP_DELAY_MS = 3000;

  // Bumped every time autoplay is stopped -- startBlunderDemo captures this
  // before its ~5 sequential engine round-trips begin, and checks it again
  // once they resolve, so a pause clicked mid-build (the only way this can
  // race) is detected and the stale variation is discarded instead of
  // navigating a board the user no longer expects to be autoplaying.
  var autoplayGeneration = 0;

  // Non-null exactly while autoplay is walking a blunder-demo variation (see
  // autoplayStep/startBlunderDemo/stepBlunderDemo): the ordered demo nodes,
  // the index of the one currently on screen, and the real-game node to
  // return to once the demo finishes. Cleared in stopAutoplay so a manual
  // pause mid-demo never leaves stale state for the next Play click to trip
  // over.
  var blunderDemo = null;

  // Single shared Audio instance for the move sound (see completeMove) --
  // reused across every move rather than a fresh Audio() per move so rapid
  // moves don't leak audio elements; calling .play() again just restarts it.
  var moveSound = new Audio('/effects/move.mp3');

  var BEST_MOVES_STORAGE_KEY = 'analysisBestMovesEnabled';
  var bestMovesEnabled = loadBestMovesEnabled();

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
    if (window.EvalGraph) {
      window.EvalGraph.init($('#evalGraphCanvas')[0]);
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
    refreshEvalGraph();
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

    var whiteName = formatPlayerName(gameInfo.white, gameInfo.whiteElo, gameInfo.whiteAccuracy);
    var blackName = formatPlayerName(gameInfo.black, gameInfo.blackElo, gameInfo.blackAccuracy);
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

  function formatPlayerName(name, elo, accuracy) {
    if (!name) {
      return '--';
    }
    var label = elo ? name + ' (' + elo + ')' : name;
    return accuracy != null ? label + ' [%' + accuracy + ']' : label;
  }

  function formatGameDate(date) {
    return date ? new Date(date).toLocaleDateString() : '--';
  }

  // Spoken-friendly date (e.g. "August 18, 2026") for the autoplay intro --
  // forced to UTC since game.date comes back as a UTC-midnight timestamp, so
  // formatting it in the browser's local time zone could shift it a day.
  function formatSpokenDate(date) {
    return date ? new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    }) : null;
  }

  // Intro lines spoken once, in order, before autoplay's first move (see
  // startAutoplay) -- built from the page's originally-loaded gameInfo/opening
  // rather than anything live-detected, so it reflects the game as recorded.
  function buildAutoplayIntroTexts() {
    var pageData = window.MAGNUS_PAGE_DATA || {};
    var gameInfo = pageData.gameInfo;
    var opening = pageData.opening;
    var texts = [];

    if (gameInfo && gameInfo.date) {
      texts.push('This game was played on ' + formatSpokenDate(gameInfo.date) + '.');
    }
    if (opening && opening.eco && opening.eco !== '?') {
      texts.push('The opening line ' + opening.eco + ' dash ' + opening.name + ' was played.');
    }
    return texts;
  }

  // Sequentially awaits each speak() call rather than firing them back to
  // back -- speak()'s 1s throttle (see move2Speech.js) only guards against
  // overlapping utterances by timestamping when one *starts*, so firing the
  // next part before the previous has finished speaking would silently drop
  // it instead of queuing it.
  function speakAutoplayIntro() {
    var texts = buildAutoplayIntroTexts();
    if (!window.speak || texts.length === 0) {
      return Promise.resolve();
    }
    return texts.reduce(function (promise, text) {
      return promise.then(function () { return window.speak(text); });
    }, Promise.resolve());
  }

  // Spoken result for autoplay's end-of-game announcement -- gameInfo.result
  // is 'win'/'draw'/'loss' relative to gameInfo.side (the tracked account's
  // color, 0 = black, non-zero = white; mirrors the orientation derivation in
  // analysisRouter.js's loadGamePageData), not a raw PGN result string.
  function describeGameResult(gameInfo) {
    if (!gameInfo || !gameInfo.result) {
      return '';
    }
    if (gameInfo.result === 'draw') {
      return 'The game ended in a draw.';
    }
    var trackedColor = gameInfo.side === 0 ? 'black' : 'white';
    var winningColor = gameInfo.result === 'win' ? trackedColor : (trackedColor === 'white' ? 'black' : 'white');
    return 'The game ended as a win for ' + (winningColor.charAt(0).toUpperCase() + winningColor.slice(1)) + '.';
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

    // Only present when a stored game was loaded via ?gameid= (see
    // analysis.ejs) -- a fresh analysis board has no fixed move list to
    // autoplay through, so the button simply isn't rendered there.
    $('#playPauseBtn').on('click', togglePlayPause);

    bindBoardTapToMove();
    bindBestMovesToggle();
    bindSoundToggle();

    $(window).on('resize', function () {
      if (analysisBoard) analysisBoard.resize();
      if (window.EvalGraph) window.EvalGraph.resize();
    });

    // Belt-and-suspenders: a same-tab navigation (prev/next game link, or
    // just closing/leaving the tab) already tears down this whole JS
    // context, but explicitly clearing the timer here means autoplay never
    // outlives the page it was scheduled from.
    $(window).on('beforeunload', stopAutoplay);
  }

  // Toggles autoplay on/off -- the button's current label (play vs pause icon)
  // always mirrors whether autoplayTimer is set, so that's the single source
  // of truth for which state we're in.
  function togglePlayPause() {
    if (autoplayTimer) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
  }

  function startAutoplay() {
    setPlayPauseLabel(true);
    // Only announce the intro when starting fresh from the root -- resuming
    // autoplay after a mid-game pause has a parent node.
    if (tree.getCurrent().parent) {
      scheduleAutoplayStep();
      return;
    }

    // Placeholder timer + generation guard while the intro is being spoken,
    // same pattern startBlunderDemo uses for its own async gap -- otherwise
    // a Pause click during the intro would both look like "nothing is
    // running" (autoplayTimer still null) and fail to cancel the deferred
    // scheduleAutoplayStep once the intro finishes.
    var generation = autoplayGeneration;
    autoplayTimer = -1;
    speakAutoplayIntro().then(function () {
      if (generation !== autoplayGeneration) {
        return; // stopAutoplay ran while the intro was being spoken
      }
      scheduleAutoplayStep();
    });
  }

  // Clears the pending timer (if any) and reverts the button to Play, but
  // leaves the board exactly where it is -- a manual pause should not jump
  // back to the start (that only happens when autoplay runs off the end of
  // the game, see autoplayStep).
  function stopAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
    autoplayGeneration++;
    blunderDemo = null;
    setPlayPauseLabel(false);
  }

  function scheduleAutoplayStep() {
    autoplayTimer = setTimeout(autoplayStep, AUTOPLAY_STEP_DELAY_MS);
  }

  // One tick of autoplay. Reuses stepView (the exact same next-move path the
  // toolbar's Next button and the right-arrow key already use) so a played
  // move renders identically either way -- this just keeps calling it on a
  // timer. Once the line runs out of children, the game is over: reset back
  // to the start (same as loading a fresh game would look) and flip the
  // button back to Play rather than scheduling another tick.
  //
  // A move flagged as an actual blunder (game_moves.loss === 3) is still
  // played and announced right here exactly like any other move -- only
  // *after* it's on the board does a short engine-best-line detour kick in
  // (see startBlunderDemo), narrating the blunder and rewinding to show what
  // should have been played instead. nextNode.blunderShown guarantees that
  // detour fires only once per blunder, so pausing/rewinding/replaying over
  // the same spot doesn't rebuild the variation again.
  function autoplayStep() {
    if (blunderDemo) {
      stepBlunderDemo();
      return;
    }

    if (tree.getCurrent().children.length === 0) {
      if (window.speak) {
        window.speak(describeGameResult((window.MAGNUS_PAGE_DATA || {}).gameInfo));
      }
      tree.goToStart();
      renderViewPosition();
      renderMoveList();
      autoplayTimer = null;
      setPlayPauseLabel(false);
      return;
    }

    var node = tree.getCurrent();
    var nextNode = node.children[0];
    advanceAutoplayMainLine(nextNode);

    if (nextNode.move && nextNode.move.loss === 3 && !nextNode.blunderShown) {
      nextNode.blunderShown = true;
      startBlunderDemo(node, nextNode);
      return;
    }

    scheduleAutoplayStep();
  }

  // Autoplay always continues along the main line (children[0]) without ever
  // asking -- once a blunder demo has run, the branch point has more than one
  // child (the demo variation alongside the real move), which would make
  // tree.stepForward()/stepView report 'ambiguous' and pop the "Choose a line"
  // modal (see promptVariationChoice). Bypass that path entirely here.
  function advanceAutoplayMainLine(node) {
    tree.goToNode(node);
    renderViewPosition();
    renderMoveList();
  }

  // Kicks off the post-blunder narration + engine best-line demo once
  // blunderNode (an actual blunder, game_moves.loss === 3) has already been
  // played and announced by autoplayStep like any other move. "This was a
  // blunder" and the name of the move being returned to are chained
  // explicitly off speak()'s returned promise (see speakAutoplayIntro) --
  // firing them back to back would otherwise trip speak()'s 1s throttle and
  // silently drop the second one. Only once both have been spoken does the
  // board rewind to branchNode (the position just before the blunder) and
  // the ~5-ply engine line get built (see buildBlunderVariation).
  // autoplayTimer is set to a placeholder for the whole stretch so a pause
  // click mid-way is still recognized as "stop the running autoplay" rather
  // than mistaken for "nothing is running, so start it".
  function startBlunderDemo(branchNode, blunderNode) {
    var generation = autoplayGeneration;
    autoplayTimer = -1;

    var goBackText = branchNode.move
      ? 'Go back to previous move, ' + window.sanToSpeech(branchNode.move.san) + '.'
      : 'Go back to the previous move.';

    var narrated = window.speak
      ? window.speak('This was a blunder.').then(function () { return window.speak(goBackText); })
      : Promise.resolve();

    narrated.then(function () {
      if (generation !== autoplayGeneration) {
        return; // stopAutoplay ran while the narration was being spoken
      }

      tree.goToNode(branchNode);
      renderViewPosition();
      renderMoveList();

      return buildBlunderVariation(branchNode).then(function (variationNodes) {
        if (generation !== autoplayGeneration) {
          return; // stopAutoplay ran while the engine calls were in flight
        }

        if (variationNodes.length === 0) {
          // Engine hiccup -- resume from the blunder move already played
          // rather than breaking autoplay over a failed demo. Announcement
          // is suppressed since that move was already announced once, back
          // when autoplayStep played it.
          tree.goToNode(blunderNode);
          renderViewPosition(null, true);
          renderMoveList();
          scheduleAutoplayStep();
          return;
        }

        blunderDemo = { nodes: variationNodes, index: 0, resumeNode: blunderNode };
        scheduleAutoplayStep();
      });
    });
  }

  // Builds a short (up to 5-ply) "what the engine considers best" line as a
  // tree variation branching off branchNode, one ply at a time since each
  // engine call needs the position the previous one produced. Runs against
  // a scratch Chess instance rather than the live `game`/board, so the
  // visible position doesn't move until stepBlunderDemo actually navigates
  // into each returned node. Resolves with whatever nodes were built --
  // possibly empty (the very first engine call failing) or shorter than 5
  // (engine ran out of moves, or the line reached game over) -- rather than
  // rejecting, since a partial/failed demo should fall back to normal
  // autoplay, not break it.
  function buildBlunderVariation(branchNode) {
    var scratchGame = new Chess(branchNode.fen);
    var variationNodes = [];

    function nextPly(currentNode, plyIndex) {
      if (plyIndex >= 5 || scratchGame.game_over()) {
        return Promise.resolve(variationNodes);
      }

      return window.ApiClient.getEngineBestMoves({ fen: scratchGame.fen() }).then(function (result) {
        var best = result && result.moves && result.moves[0];
        if (!best) {
          return variationNodes;
        }

        var moveObj = scratchGame.move(best.move);
        if (!moveObj) {
          return variationNodes;
        }

        var childNode = tree.addMove(currentNode, {
          san: moveObj.san,
          from: moveObj.from,
          to: moveObj.to,
          promotion: moveObj.promotion || null,
          color: moveObj.color,
          fen: scratchGame.fen()
        });
        variationNodes.push(childNode);

        return nextPly(childNode, plyIndex + 1);
      }).catch(function () {
        return variationNodes;
      });
    }

    return nextPly(branchNode, 0);
  }

  // One tick of the blunder-demo sub-loop kicked off by startBlunderDemo --
  // walks blunderDemo.nodes one per tick, same cadence and per-move speech
  // as normal autoplay (the "this was a blunder" / "go back to..." narration
  // already happened before the demo started, so each demo ply is just
  // announced like any other move here). Once every demo node has had its
  // tick, one more tick jumps forward to the blunder move already played
  // earlier (blunderDemo.resumeNode) and clears blunderDemo, handing control
  // back to autoplayStep -- landing there rather than replaying it is what
  // avoids re-playing/re-announcing the blunder a second time.
  function stepBlunderDemo() {
    var demo = blunderDemo;

    if (demo.index >= demo.nodes.length) {
      blunderDemo = null;
      tree.goToNode(demo.resumeNode);
      renderViewPosition(null, true);
      renderMoveList();
      scheduleAutoplayStep();
      return;
    }

    var node = demo.nodes[demo.index];
    tree.goToNode(node);
    renderViewPosition();
    renderMoveList();

    demo.index++;
    scheduleAutoplayStep();
  }

  function setPlayPauseLabel(isPlaying) {
    $('#playPauseBtn').html(isPlaying ? '&#9208;' : '&#9654;');
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

  // Restarts the shared move-sound instance from the top rather than just
  // calling .play() on a possibly-still-playing instance, so moves made in
  // quick succession (e.g. autoplay, engine-move clicks) each audibly retrigger
  // it instead of the sound only playing once and then being a no-op.
  function playMoveSound() {
    moveSound.currentTime = 0;
    moveSound.play().catch(function () {});
  }

  // Shared tail end of a completed move, regardless of whether it was played
  // straight from onAnalysisDrop or resolved asynchronously via the
  // promotion picker.
  function completeMove(moveObj) {
    playMoveSound();
    if (window.speak) {
      window.speak(window.sanToSpeech(moveObj.san));
    }

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
    refreshEvalGraph();
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
  //
  // announceOverride lets a caller replace the default "announce this node's
  // own move" speech with a custom message. suppressAnnounce lets a caller
  // (see startBlunderDemo/stepBlunderDemo's resumeNode handling) silence
  // that default speech entirely when re-landing on a node whose move was
  // already announced once, without duplicating any of this function's
  // other side effects.
  function renderViewPosition(announceOverride, suppressAnnounce) {
    var node = tree.getCurrent();
    game.load(node.fen);
    analysisBoard.position(node.fen, false);
    $('#fenInput').val(node.fen);
    if (announceOverride) {
      if (window.speak) window.speak(announceOverride);
    } else if (!suppressAnnounce && window.speak && node.move) {
      // Root node has no move (it's the starting position) -- nothing to announce.
      window.speak(window.sanToSpeech(node.move.san));
    }
    refreshEnginePanel();
    refreshEvalGraph();
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

  // Reads the "Best Moves" toggle's persisted state (see bindBestMovesToggle)
  // -- unset (first visit) defaults to enabled, matching today's behavior.
  function loadBestMovesEnabled() {
    var stored = localStorage.getItem(BEST_MOVES_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  }

  // Mirrors the toggle's checked state into bestMovesEnabled and localStorage.
  // Flipping it on re-fetches immediately (via refreshEnginePanel) so the
  // list populates right away rather than waiting for the next move/nav;
  // flipping it off just blanks the list -- refreshEnginePanel's own gating
  // means no request needs canceling.
  function bindBestMovesToggle() {
    var $toggle = $('#bestMovesToggle').prop('checked', bestMovesEnabled);

    $toggle.on('change', function () {
      bestMovesEnabled = this.checked;
      localStorage.setItem(BEST_MOVES_STORAGE_KEY, bestMovesEnabled);
      if (bestMovesEnabled) {
        refreshEnginePanel();
      } else {
        $('#engineMoveList').empty();
      }
    });
  }

  // Wires the toolbar's speaker button to move2Speech.js's own toggle/state
  // functions -- soundToggleBtn's icon is kept in sync by updateSoundButton
  // itself (called here for the initial render, and again from toggleSound
  // on every click), so this file never touches soundEnabled directly.
  function bindSoundToggle() {
    if (!window.toggleSound) {
      return;
    }
    window.updateSoundButton();
    $('#soundToggleBtn').on('click', window.toggleSound);
  }

  // Fetches eval + top-10 best moves for whatever `game` currently holds and
  // renders them into the left panel. Called on load and from every
  // position-changing path (renderViewPosition, completeMove) so the panel
  // always reflects the position on screen, not just the position at load.
  // The best-moves half is skipped entirely (not just discarded on arrival)
  // while the "Best Moves" toggle is off -- see bindBestMovesToggle.
  function refreshEnginePanel() {
    var requestId = ++engineRequestSeq;
    var fen = game.fen();

    $('#enginePanel').addClass('engine-panel-loading');

    var bestMovesPromise = bestMovesEnabled ?
      window.ApiClient.getEngineBestMoves({ fen: fen }) :
      Promise.resolve({ moves: [] });

    Promise.all([
      window.ApiClient.getEngineEval({ fen: fen }),
      bestMovesPromise
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

    // A fresh/live move has no eval yet (see tree.addMove / completeMove) --
    // now that the engine has resolved one for this exact position, stamp it
    // onto the tree so the eval graph (and any future visit to this node)
    // has it, then redraw the graph so the new point appears immediately.
    var currentMove = tree.getCurrent().move;
    if (currentMove && currentMove.eval === null && evalResult.evaluation) {
      currentMove.eval = evalToPawns(evalResult.evaluation);
      refreshEvalGraph();
    }
  }

  // Mirrors scripts/evaluateGames.js's evalToPawns() so a live-resolved eval
  // matches how final_eval is computed for stored games: 'cp' is centipawns
  // (divide by 100), 'mate' has no meaningful magnitude so a large-magnitude
  // sentinel with the correct sign is stored instead.
  function evalToPawns(evaluation) {
    if (evaluation.type === 'mate') {
      return evaluation.value < 0 ? -100 : 100;
    }
    return evaluation.value / 100;
  }

  // Rebuilds the eval-graph points array from the tree's main line (root's
  // {ply:0, eval:0} plus every main-line move's eval) and redraws. Called
  // alongside refreshEnginePanel from every position-changing path, so the
  // graph always mirrors what the engine panel and move list are showing.
  function refreshEvalGraph() {
    if (!window.EvalGraph) {
      return;
    }
    var points = [{ ply: 0, eval: 0 }].concat(tree.getMainLine().map(function (node) {
      return { ply: node.ply, eval: node.move.eval };
    }));
    window.EvalGraph.render(points);
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
