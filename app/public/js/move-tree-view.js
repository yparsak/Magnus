// =============================================================================
// move-tree-view.js
// Renders a MoveTree (see move-tree.js) into a container as a move list: the
// main line as move-number/white/black rows (same shape as the page's
// original flat move list), with side lines rendered as their own indented,
// parenthesized rows directly under the move they branch from -- e.g.
//   12. Nf3 Bc5
//     (12. e4 d5 13. exd5 Qxd5)
//   13. O-O ...
// Nested variations (a side line off a side line) are rendered inline inside
// their parent side line's row, in their own nested parentheses.
//
// Takes the container element as a parameter rather than hardcoding a
// page-specific id, so any future page rendering a MoveTree (saved-game
// review, board editor) can reuse it as-is.
//
// Usage:
//   MoveTreeView.render(document.getElementById('moveList'), tree, tree.getCurrent(), {
//     onSelectNode: function (node) { ... jump the board to `node` ... }
//   });
// =============================================================================

(function () {
  'use strict';

  function isWhiteMove(node) {
    return node.ply % 2 === 1;
  }

  function moveNumberLabel(node) {
    var moveNumber = Math.ceil(node.ply / 2);
    return moveNumber + (isWhiteMove(node) ? '.' : '...');
  }

  function buildMoveSpan(node, currentNode) {
    var $span = $('<span>', { class: 'move-san', text: node.move.san });
    $span.data('node', node);
    if (node === currentNode) {
      $span.addClass('active-move');
    }
    return $span;
  }

  function buildParenSpan(text) {
    return $('<span>', { class: 'variation-paren', text: text });
  }

  // Walks the main-line continuation from `parentNode`, one move-row per
  // full move number. Whenever a node along the way has side lines
  // (parent.children.length > 1, i.e. more than one continuation from that
  // position), each one is rendered immediately below via renderVariation.
  function renderMainLine($container, parentNode, currentNode) {
    var $row = null;
    var parent = parentNode;

    while (parent.children.length) {
      var mainChild = parent.children[0];

      if (!$row || isWhiteMove(mainChild)) {
        $row = $('<div>', { class: 'move-row' });
        $container.append($row);
        $row.append($('<span>', { class: 'move-number', text: moveNumberLabel(mainChild) }));
      }
      $row.append(buildMoveSpan(mainChild, currentNode));

      if (parent.children.length > 1) {
        parent.children.slice(1).forEach(function (variationStart) {
          renderVariation($container, variationStart, currentNode);
        });
      }

      parent = mainChild;
    }
  }

  function renderVariation($container, startNode, currentNode) {
    var $row = $('<div>', { class: 'move-row variation-row' });
    $container.append($row);
    $row.append(buildParenSpan('('));
    renderVariationLine($row, startNode, currentNode);
    $row.append(buildParenSpan(')'));
  }

  // Renders startNode and its own main continuation inline into $row (one
  // wrapping row, not one row per move pair -- variations are usually short
  // enough that this reads fine and keeps nested variations simple: a nested
  // fork just opens another paren in the same row).
  function renderVariationLine($row, startNode, currentNode) {
    var node = startNode;
    var needsLabel = true; // the first move of a line always gets a number,
                            // even on Black's move (e.g. "12...Nc6")

    while (node) {
      if (needsLabel || isWhiteMove(node)) {
        $row.append($('<span>', { class: 'move-number', text: moveNumberLabel(node) }));
      }
      $row.append(buildMoveSpan(node, currentNode));
      needsLabel = false;

      if (node.children.length > 1) {
        node.children.slice(1).forEach(function (nestedStart) {
          $row.append(buildParenSpan('('));
          renderVariationLine($row, nestedStart, currentNode);
          $row.append(buildParenSpan(')'));
        });
        // A nested variation interrupted the flow -- resume the outer line
        // with a fresh move number so it reads as "13...Qxd5" not "Qxd5".
        needsLabel = true;
      }

      node = node.children[0];
    }
  }

  function render(container, tree, currentNode, callbacks) {
    var $container = $(container).empty();
    var opts = callbacks || {};
    var onSelectNode = typeof opts.onSelectNode === 'function' ? opts.onSelectNode : function () {};
    var current = currentNode || tree.getCurrent();

    renderMainLine($container, tree.getRoot(), current);

    $container.find('.move-san').on('click', function () {
      var node = $(this).data('node');
      if (node) {
        onSelectNode(node);
      }
    });
  }

  window.MoveTreeView = { render: render };
})();
