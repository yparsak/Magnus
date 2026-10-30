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
 * Converts short algebraic notation (SAN) into a short spoken phrase, e.g.
 * "Nf3" -> "Knight f3", "exd5" -> "E pawn takes d5", "O-O" -> "castle king side".
 * @param {string} san
 * @returns {string}
 */
function sanToSpeech(san) {
  if (!san) return '';

  const isCheckmate = san.endsWith('#');
  const isCheck = !isCheckmate && san.endsWith('+');
  const checkText = isCheckmate ? ' check mate' : (isCheck ? ' check' : '');

  const clean = san.replace(/[+#]$/, '');

  if (clean === 'O-O') return 'castle king side' + checkText;
  if (clean === 'O-O-O') return 'castle long side' + checkText;

  const promotionMatch = clean.match(/=([QRBN])$/);
  const body = promotionMatch ? clean.slice(0, -promotionMatch[0].length) : clean;
  const promotionText = promotionMatch ? ` promotes to ${pieceNames[promotionMatch[1].toLowerCase()]}` : '';

  // Destination square is always the last two characters of the SAN body,
  // regardless of any disambiguation characters (e.g. "Nbd7") in between.
  const destination = body.slice(-2);
  const isCapture = body.includes('x');

  const pieceLetterMatch = body.match(/^[NBRQK]/);
  if (pieceLetterMatch) {
    const pieceName = pieceNames[pieceLetterMatch[0].toLowerCase()];
    const capitalized = pieceName.charAt(0).toUpperCase() + pieceName.slice(1);
    return (isCapture ? `${capitalized} takes ${destination}` : `${capitalized} ${destination}`) + promotionText + checkText;
  }

  // No piece letter -- a pawn move. Captures carry the origin file (e.g. "exd5").
  if (isCapture) {
    return `${body[0].toUpperCase()} pawn takes ${destination}${promotionText}${checkText}`;
  }
  return `Pawn ${destination}${promotionText}${checkText}`;
}

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

// `'speechSynthesis' in window` is true in Chrome/Edge on Windows, and in
// Firefox, even when the OS has no installed voices -- Windows N/KN editions,
// Windows Server and locked-down enterprise images all ship without them, as
// do most bare Linux installs. An utterance spoken against an empty voice list
// can finish without ever firing onend *or* onerror, which would wedge every
// caller that awaits speak() (autoplay's intro and side-line narration both
// do). Probing getVoices() is what tells a working engine apart from a
// present-but-dead one.
//
// getVoices() populates asynchronously, so an empty list at load time means
// "not yet" rather than "none" -- VOICE_PROBE_MS is how long we give it before
// concluding there really are no voices and reflecting that in the toolbar.
let voicesUnavailable = false;
const VOICE_PROBE_MS = 2000;

function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function speechAvailable() {
  return ttsSupported() && !voicesUnavailable;
}

function probeVoices() {
  if (!ttsSupported()) {
    voicesUnavailable = true;
    updateSoundButton();
    return;
  }

  const settle = () => {
    const voices = window.speechSynthesis.getVoices();
    const unavailable = !voices || voices.length === 0;
    if (unavailable !== voicesUnavailable) {
      voicesUnavailable = unavailable;
      updateSoundButton();
    }
  };

  window.speechSynthesis.addEventListener('voiceschanged', settle);
  setTimeout(settle, VOICE_PROBE_MS);
}

function updateSoundButton() {
  const btn = document.getElementById('soundToggleBtn');
  if (!btn) return;

  // Matches the toolbar's other nav-tool-btn buttons, which render a
  // single glyph reflecting current state (e.g. play/pause) rather than text.
  if (!speechAvailable()) {
    // Leaving the button live would promise announcements this browser
    // cannot deliver, so say why instead of silently doing nothing.
    btn.textContent = '\u{1F507}';
    btn.disabled = true;
    btn.title = 'Move announcements unavailable -- no text-to-speech voices are installed';
    return;
  }

  btn.disabled = false;
  btn.title = 'Toggle move announcements';
  btn.textContent = soundEnabled ? '\u{1F50A}' : '\u{1F507}';
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('magnus-sound-enabled', soundEnabled);
  updateSoundButton();
  window.dispatchEvent(new CustomEvent('soundToggled', { detail: { soundEnabled } }));
}

// Hard ceiling on how long a single utterance may keep its caller waiting.
// Chrome and Edge can leave an utterance without ever firing onend -- no
// installed voices, the tab being backgrounded mid-speech, or Chrome's
// long-standing bug on utterances past ~15s -- and autoplay blocks on these
// promises, so a non-firing event would freeze it with no way back except
// pause/play. Generous enough that it never truncates a real announcement
// (the longest here is a few seconds).
const SPEECH_TIMEOUT_MS = 8000;

// Utterances are spoken strictly one after another rather than handed to
// speechSynthesis all at once: queued speech is the browser's own black box,
// whereas chaining here means every caller's promise resolves when *its* text
// has actually finished.
let speechChain = Promise.resolve();

function speakNow(text) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, SPEECH_TIMEOUT_MS);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = finish;
    utterance.onerror = finish;

    // cancel() can leave Chrome's synthesizer stuck in a paused state, which
    // swallows everything queued after it.
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Speaks the given text using the browser's SpeechSynthesis API.
 *
 * By default this is a *move* announcement: only the newest one is worth
 * hearing, so anything still in flight is cancelled first -- that's what keeps
 * a mashed arrow key from reading out a pile of squares already navigated past.
 * Pass { queue: true } for narration that must be heard in full (autoplay's
 * intro, the blunder/mate lead-ins), which appends after whatever is speaking
 * instead of talking over it.
 *
 * Always resolves -- never rejects, and never hangs -- so callers can await it
 * as a pacing primitive regardless of whether speech actually happened.
 *
 * @param {string} text
 * @param {{queue?: boolean}} [options]
 * @returns {Promise}
 */
function speak(text, options) {
  if (!text || !soundEnabled || !speechAvailable()) {
    return Promise.resolve();
  }

  if (!(options && options.queue)) {
    window.speechSynthesis.cancel();
  }

  const spoken = speechChain.then(() => speakNow(text));
  speechChain = spoken.catch(() => {});
  return spoken;
}

/**
 * Drops anything currently being spoken or waiting behind it. Pending speak()
 * promises still resolve, since cancelling fires onend/onerror on the live
 * utterance and the chain drains from there.
 */
function cancelSpeech() {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
}

// Initialize button text on load, and start the voice probe that may later
// flip it to the unavailable state.
(function() {
  const init = () => {
    updateSoundButton();
    probeVoices();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
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
