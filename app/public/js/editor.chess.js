// =============================================================================
// editor.chess.js
// Board editor page only (see views/pages/board_editor.ejs). Handles the
// editable board, spare pieces, erase tool, and FEN/turn/castling/en-passant
// controls. Navigates to the analysis page via a full page redirect.
// =============================================================================

$(function () {
  if (!$('#board').length) {
    return;
  }

  var eraseMode = false;
  var editorBoard = null;

  initEditor();
  bindControls();

  function initEditor() {
    editorBoard = createEditorBoard();
    populateEnPassantOptions();

    var pageData = window.MAGNUS_PAGE_DATA || {};
    if (pageData.fen) {
      applyFenString(pageData.fen);
    } else {
      syncFenField();
    }
  }

  function createEditorBoard() {
    return Chessboard('board', {
      draggable: true,
      dropOffBoard: "trash",
      sparePieces: true,
      position: 'start',
      pieceTheme: '/imgs/{piece}.png',
      onChange: onEditorBoardChange
    });
  }

  // chessboard.js fires onChange(oldPos, newPos) *before* it commits newPos
  // internally, so board.fen()/board.position() still report the stale
  // position here -- must build the FEN from the newPos argument instead.
  function onEditorBoardChange(oldPos, newPos) {
    $('#fenInput').val(buildFenFromPlacement(Chessboard.objToFen(newPos)));
  }

  function getCastlingString() {
    var castling = '';
    if ($('#castleWK').is(':checked')) castling += 'K';
    if ($('#castleWQ').is(':checked')) castling += 'Q';
    if ($('#castleBK').is(':checked')) castling += 'k';
    if ($('#castleBQ').is(':checked')) castling += 'q';
    return castling || '-';
  }

  function populateEnPassantOptions() {
    var rank = $('#turnSelect').val() === 'w' ? '6' : '3';
    var current = $('#epSelect').val();
    var $select = $('#epSelect').empty();

    $select.append($('<option>', { value: '-', text: '-' }));
    for (var file = 0; file < 8; file++) {
      var square = String.fromCharCode(97 + file) + rank;
      $select.append($('<option>', { value: square, text: square }));
    }

    if (current && $select.find('option[value="' + current + '"]').length) {
      $select.val(current);
    } else {
      $select.val('-');
    }
  }

  function buildFenFromPlacement(placement) {
    var turn = $('#turnSelect').val();
    var castling = getCastlingString();
    var ep = $('#epSelect').val() || '-';
    return [placement, turn, castling, ep, '0', '1'].join(' ');
  }

  function buildFenFromEditor() {
    return buildFenFromPlacement(editorBoard.fen());
  }

  function syncFenField() {
    $('#fenInput').val(buildFenFromEditor());
  }

  function normalizeFenInput(rawFen) {
    var parts = $.trim(rawFen || '').split(/\s+/);
    if (!parts[0]) {
      return null;
    }
    return [
      parts[0],
      parts[1] || 'w',
      parts[2] || '-',
      parts[3] || '-',
      parts[4] || '0',
      parts[5] || '1'
    ].join(' ');
  }

  function applyFenString(rawFen) {
    var normalized = normalizeFenInput(rawFen);
    if (!normalized) {
      showError('Please enter a FEN string.');
      return false;
    }

    var validation = new Chess().validate_fen(normalized);
    if (!validation.valid) {
      showError('Invalid FEN: ' + validation.error);
      return false;
    }

    var parts = normalized.split(' ');
    editorBoard.position(parts[0], false);
    $('#turnSelect').val(parts[1] === 'b' ? 'b' : 'w');
    $('#castleWK').prop('checked', parts[2].indexOf('K') !== -1);
    $('#castleWQ').prop('checked', parts[2].indexOf('Q') !== -1);
    $('#castleBK').prop('checked', parts[2].indexOf('k') !== -1);
    $('#castleBQ').prop('checked', parts[2].indexOf('q') !== -1);

    populateEnPassantOptions();
    if (parts[3] !== '-' && $('#epSelect option[value="' + parts[3] + '"]').length) {
      $('#epSelect').val(parts[3]);
    }

    syncFenField();
    return true;
  }

  function bindControls() {
    $('#turnSelect').on('change', function () {
      populateEnPassantOptions();
      syncFenField();
    });

    $('#castleWK, #castleWQ, #castleBK, #castleBQ, #epSelect').on('change', syncFenField);

    $('#fenInput').on('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFenString($(this).val());
      }
    });
    $('#fenInput').on('blur', function () {
      applyFenString($(this).val());
    });

    $('#setBoardApply').on('click', function () {
      applyFenString($('#setBoardInput').val());
    });
    $('#setBoardInput').on('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFenString($(this).val());
      }
    });

    $('#linkStartPos').on('click', function (e) {
      e.preventDefault();
      editorBoard.start(false);
      $('#turnSelect').val('w');
      $('#castleWK, #castleWQ, #castleBK, #castleBQ').prop('checked', true);
      populateEnPassantOptions();
      syncFenField();
    });

    $('#linkClearBoard').on('click', function (e) {
      e.preventDefault();
      editorBoard.clear(false);
      syncFenField();
    });

    $('#linkAnalysisBoard').on('click', function (e) {
      e.preventDefault();
      goToAnalysis();
    });

    $('#toolPointerBtn').on('click', function () {
      eraseMode = false;
      $('#toolPointerBtn').addClass('active');
      $('#toolTrashBtn').removeClass('active');
    });

    $('#toolTrashBtn').on('click', function () {
      eraseMode = true;
      $('#toolTrashBtn').addClass('active');
      $('#toolPointerBtn').removeClass('active');
    });

    $('#toolRotateBtn').on('click', function () {
      editorBoard.flip();
    });

    $('#board').on('click', '.square-55d63', function () {
      if (!eraseMode) {
        return;
      }
      var square = $(this).data('square');
      var position = editorBoard.position();
      if (square && position[square]) {
        delete position[square];
        editorBoard.position(position, false);
      }
    });

    $(window).on('resize', function () {
      if (editorBoard) editorBoard.resize();
    });
  }

  function goToAnalysis() {
    var fen = buildFenFromEditor();
    var validation = new Chess().validate_fen(fen);
    if (!validation.valid) {
      showError('Invalid position: ' + validation.error);
      return;
    }
    window.location.href = '/analysis?fen=' + encodeURIComponent(fen);
  }
});
