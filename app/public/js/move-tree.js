// =============================================================================
// move-tree.js
// Reusable, framework-agnostic chess move tree: a main line plus side lines
// (variations) branching off any position, the way lichess/chess.com analysis
// boards work. Pure data structure -- no DOM, no jQuery, no chess.js
// dependency -- so it can be reused by any page that needs to browse a game
// with variations (analysis board today; a "review saved game" page or the
// board editor later).
//
// A node looks like:
//   {
//     id: 3,                 // unique within this tree
//     parent: <node|null>,   // null only for the root
//     children: [<node>...], // children[0] is the main-line continuation,
//                             // children[1+] are side lines (variations)
//     move: { san, from, to, promotion, color, eval, mateIn, loss } | null,
//                             // null only for root. `eval` (pawns, White's
//                             // perspective), `mateIn` (signed mate distance,
//                             // White's perspective, set instead of `eval`
//                             // when the position is a forced mate) and
//                             // `loss` (0-3 accuracy category) are optional
//                             // -- null unless this move came from an
//                             // evaluated game_moves row.
//     fen: '...',            // position after this node's move (or the
//                             // starting fen, for the root)
//     ply: 0                 // 0 for root, 1 for white's 1st move, 2 for
//                             // black's 1st move, etc.
//   }
//
// Usage:
//   var tree = MoveTree.createTree(startingFen);
//   tree.addMove(tree.getCurrent(), { san: 'e4', from: 'e2', to: 'e4', fen: '...' });
//   tree.getCurrent();   // the node just added
//   tree.stepBack();     // -> { status: 'moved'|'start', node }
//   tree.stepForward();  // -> { status: 'moved'|'end'|'ambiguous', node, choices? }
// =============================================================================

(function () {
  'use strict';

  function createTree(startFen) {
    var nextId = 1;
    var root = makeNode(null, null, startFen, 0);
    var current = root;

    function makeNode(parent, move, fen, ply) {
      return {
        id: nextId++,
        parent: parent,
        children: [],
        move: move,
        fen: fen,
        ply: ply
      };
    }

    function sameMove(move, candidate) {
      return move.from === candidate.from &&
        move.to === candidate.to &&
        (move.promotion || null) === (candidate.promotion || null);
    }

    function findMatchingChild(node, moveInfo) {
      for (var i = 0; i < node.children.length; i++) {
        if (sameMove(node.children[i].move, moveInfo)) {
          return node.children[i];
        }
      }
      return null;
    }

    // Adds moveInfo ({ san, from, to, promotion, color, fen }) as a
    // continuation from `node`. If `node` already has a child for this exact
    // move, reuses it instead of duplicating. Otherwise the move is appended
    // as a new child -- the sole (main-line) continuation if `node` had none
    // yet, or a new side line alongside the existing ones if it did. Either
    // way, the tree's current pointer moves to the resulting node.
    function addMove(node, moveInfo) {
      var existing = findMatchingChild(node, moveInfo);
      if (existing) {
        current = existing;
        return existing;
      }

      var child = makeNode(node, {
        san: moveInfo.san,
        from: moveInfo.from,
        to: moveInfo.to,
        promotion: moveInfo.promotion || null,
        color: moveInfo.color,
        eval: moveInfo.eval === undefined ? null : moveInfo.eval,
        mateIn: moveInfo.mateIn === undefined ? null : moveInfo.mateIn,
        loss: moveInfo.loss === undefined ? null : moveInfo.loss
      }, moveInfo.fen, node.ply + 1);

      node.children.push(child);
      current = child;
      return child;
    }

    function goToNode(node) {
      if (node) {
        current = node;
      }
      return current;
    }

    function stepBack() {
      if (!current.parent) {
        return { status: 'start', node: current };
      }
      current = current.parent;
      return { status: 'moved', node: current };
    }

    // Advances along the current line. If the current node has more than one
    // child, that's a fork (main line vs. side line diverging going forward)
    // and the caller needs to ask the user which one to follow -- reported
    // back as status 'ambiguous' with the candidate nodes in `choices` rather
    // than guessing.
    function stepForward() {
      var children = current.children;
      if (children.length === 0) {
        return { status: 'end', node: current };
      }
      if (children.length > 1) {
        return { status: 'ambiguous', node: current, choices: children.slice() };
      }
      current = children[0];
      return { status: 'moved', node: current };
    }

    // Root-to-node path, root first, useful for replaying/rendering a line.
    function getPath(node) {
      var target = node || current;
      var path = [];
      while (target) {
        path.unshift(target);
        target = target.parent;
      }
      return path;
    }

    // The line reached by always following the first child from the root.
    function getMainLine() {
      var line = [];
      var node = root;
      while (node.children.length) {
        node = node.children[0];
        line.push(node);
      }
      return line;
    }

    function getChildren(node) {
      return (node || current).children.slice();
    }

    function goToStart() {
      current = root;
      return current;
    }

    // Follows the main continuation from `node` (default: current) forward
    // to the end of that line.
    function goToEnd(node) {
      var target = node || current;
      while (target.children.length) {
        target = target.children[0];
      }
      current = target;
      return current;
    }

    function getRoot() {
      return root;
    }

    function getCurrent() {
      return current;
    }

    return {
      getRoot: getRoot,
      getCurrent: getCurrent,
      addMove: addMove,
      goToNode: goToNode,
      stepBack: stepBack,
      stepForward: stepForward,
      getPath: getPath,
      getMainLine: getMainLine,
      getChildren: getChildren,
      goToStart: goToStart,
      goToEnd: goToEnd
    };
  }

  window.MoveTree = { createTree: createTree };
})();
