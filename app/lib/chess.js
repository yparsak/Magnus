'use strict';

// Validate FEN
function isValidFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) {
    return false;
  }

  var parts = fen.trim().split(/\s+/);
  if (parts.length > 6) {
    return false;
  }

  var ranks = parts[0].split('/');
  if (ranks.length !== 8) {
    return false;
  }
  for (var i = 0; i < ranks.length; i++) {
    if (!/^[pnbrqkPNBRQK1-8]+$/.test(ranks[i])) {
      return false;
    }
    var squares = 0;
    for (var c = 0; c < ranks[i].length; c++) {
      var ch = ranks[i].charAt(c);
      squares += /[1-8]/.test(ch) ? Number(ch) : 1;
    }
    if (squares !== 8) {
      return false;
    }
  }

  if (parts[1] !== undefined && parts[1] !== 'w' && parts[1] !== 'b') {
    return false;
  }
  if (parts[2] !== undefined && parts[2] !== '-' && !/^[KQkq]+$/.test(parts[2])) {
    return false;
  }
  if (parts[3] !== undefined && parts[3] !== '-' && !/^[a-h][36]$/.test(parts[3])) {
    return false;
  }
  if (parts[4] !== undefined && !/^\d+$/.test(parts[4])) {
    return false;
  }
  if (parts[5] !== undefined && !/^\d+$/.test(parts[5])) {
    return false;
  }
  return true;
}

module.exports = { isValidFen };

