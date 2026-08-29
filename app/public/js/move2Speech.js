// Map of piece codes to spoken words
const pieceNames = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king'
};

/**
 * Converts an engine move into spoken English text.
 * @param {string} fen - The current board state in FEN notation
 * @param {string|object} move - The move from the engine (e.g., "e2e4", "g1f3", "e7e8q") or a move object
 * @returns {string} - Spoken text phrase
 */
function move2Speech(fen, move) {
  // Initialize chess.js with the current position
  // In the browser, Chess is usually globally available from chess.js
  const chess = new Chess(fen);

  try {
    let moveDetails;
    // Handle UCI format (e.g., "e2e4")
    if (typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
        moveDetails = chess.move({
            from: move.substring(0, 2),
            to: move.substring(2, 4),
            promotion: move.substring(4, 5) || 'q'
        });
    } else {
        // Fallback to SAN
        moveDetails = chess.move(move);
    }

    if (!moveDetails) return '';

    const piece = pieceNames[moveDetails.piece];
    const toSquare = moveDetails.to;

    // 1. Handle Castling
    if (moveDetails.san === 'O-O') return 'King side castle';
    if (moveDetails.san === 'O-O-O') return 'Queen side castle';

    let speechText = '';

    // 2. Handle Captures vs Regular Moves
    if (moveDetails.captured) {
      const capturedPiece = pieceNames[moveDetails.captured];
      speechText = `${piece} takes ${capturedPiece} on ${toSquare}`;
    } else {
      speechText = `${piece} to ${toSquare}`;
    }

    // 3. Handle Checks and Checkmates
    // browser chess.js uses in_checkmate and in_check
    if (chess.in_checkmate()) {
      speechText += '. Checkmate!';
    } else if (chess.in_check()) {
      speechText += '. Check!';
    }

    return speechText;

  } catch (error) {
    console.error('move2Speech error:', error);
    return '';
  }
}

let soundEnabled = localStorage.getItem('magnus-sound-enabled') !== 'false';

function updateSoundButton() {
  const btn = document.getElementById('soundToggleBtn');
  if (btn) {
    // Matches the toolbar's other nav-tool-btn buttons, which render a
    // single glyph reflecting current state (e.g. play/pause) rather than text.
    btn.textContent = soundEnabled ? '\u{1F50A}' : '\u{1F507}';
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('magnus-sound-enabled', soundEnabled);
  updateSoundButton();
  window.dispatchEvent(new CustomEvent('soundToggled', { detail: { soundEnabled } }));
}

/**
 * Speaks the given text using the browser's SpeechSynthesis API.
 * @param {string} text
 * @returns {Promise}
 */
function speak(text) {
  return new Promise((resolve) => {
    if (!text || !soundEnabled || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

// Initialize button text on load
(function() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateSoundButton);
  } else {
    updateSoundButton();
  }
})();

/**
 * Converts a move to speech and speaks it.
 * @param {string} fen
 * @param {string|object} move
 * @returns {Promise}
 */
function speakMove(fen, move) {
  const text = move2Speech(fen, move);
  return speak(text);
}

/**
 * Converts a Principal Variation (PV) string into spoken English text.
 * @param {string} fen - The starting board state in FEN notation
 * @param {string} pv - The space-separated UCI moves (e.g., "e2e4 e7e5 g1f3")
 * @returns {string} - Spoken text phrase for the sequence of moves
 */
function pvToSpeech(fen, pv) {
  if (!pv) return '';
  const chess = new Chess(fen);
  const moves = pv.split(' ');
  const speechParts = [];

  for (const moveStr of moves) {
    const currentFen = chess.fen();
    const spoken = move2Speech(currentFen, moveStr);
    if (spoken) {
      speechParts.push(spoken);
    }
    // Advance the game state to get the correct context for the next move
    let m;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveStr)) {
      m = chess.move({
        from: moveStr.substring(0, 2),
        to: moveStr.substring(2, 4),
        promotion: moveStr.substring(4, 5) || 'q'
      });
    } else {
      m = chess.move(moveStr);
    }
    if (!m) break;
  }

  return speechParts.join(', ');
}
