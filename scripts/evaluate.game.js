const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const { Chess } = require('chess.js');
const path = require('path');
require('dotenv').config();

const ENGINE_PATH = path.join(process.env.SF_PATH, 'stockfish');

async function runEvaluation() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        const [games] = await connection.execute(
            'SELECT id, player_id FROM player_games WHERE analyzed = false LIMIT 1'
        );

        if (games.length === 0) return;
        const game = games[0];

        const [moves] = await connection.execute(
            'SELECT id, fen, short_notation FROM game_moves WHERE game_id = ? ORDER BY id ASC',
            [game.id]
        );

        // 1. Spawn with error handling
        const stockfish = spawn(ENGINE_PATH);
        
        stockfish.on('error', (err) => {
            console.error(`Failed to start Stockfish at ${ENGINE_PATH}:`, err.message);
            process.exit(1);
        });

        // 2. Initial Handshake
        console.log("Initializing Stockfish...");
        await sendCommand(stockfish, 'uci', 'uciok');
        await sendCommand(stockfish, 'isready', 'readyok');
        await sendCommand(stockfish, 'ucinewgame');

        const chess = new Chess();
        const moveHistory = [];

        for (const moveData of moves) {
            const moveResult = chess.move(moveData.short_notation);
            if (!moveResult) continue;
            
            moveHistory.push(moveResult.lan);
            const movesString = moveHistory.join(' ');

            await sendCommand(stockfish, `position startpos moves ${movesString}`, null); // No wait needed here
            await sendCommand(stockfish, 'isready', 'readyok'); // Ensure board is set

            const searchOutput = await sendCommand(stockfish, 'go depth 20', 'bestmove');
            const evaluation = parseSearchEval(searchOutput); 

            console.log(`Game ${game.id} | ${moveData.short_notation} | Eval: ${evaluation.finalEval}`);

            await connection.execute(
                `UPDATE game_moves SET NNUMatEval = ?, NNUMPosEval = ?, Eval = ? WHERE id = ?`,
                [evaluation.matEval, evaluation.posEval, evaluation.finalEval, moveData.id]
            );
        }

        await connection.execute('UPDATE player_games SET analyzed = true WHERE id = ?', [game.id]);
        stockfish.kill();
        console.log("Analysis complete.");

    } catch (error) {
        console.error("Critical Error:", error);
    } finally {
        await connection.end();
        process.exit();
    }
}

/**
 * Improved Command Sender
 */
/**
 * Improved Command Sender with Dynamic Timeout
 * Ms 60000 = 60sec
 */
function sendCommand(child, command, terminator, timeoutMs = 60000 ) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        
        const onData = (data) => {
            buffer += data.toString();
            if (!terminator || buffer.includes(terminator)) {
                child.stdout.removeListener('data', onData);
                clearTimeout(timeout); // Clear on success
                resolve(buffer);
            }
        };

        child.stdout.on('data', onData);
        
        const timeout = setTimeout(() => {
            child.stdout.removeListener('data', onData);
            reject(new Error(`Stockfish timeout on command: ${command} after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdin.write(`${command}\n`);
        
        if (!terminator) {
            clearTimeout(timeout);
            resolve();
        }
    });
}

function parseSearchEval(text) {
    // Search for the last 'info' line containing 'score cp'
    const lines = text.split('\n');
    let cpValue = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('score cp')) {
            const match = lines[i].match(/score cp ([-+]?\d+)/);
            if (match) {
                // Convert centipawns to decimal (e.g., 556 to 5.56)
                cpValue = parseInt(match[1]) / 100;
                break;
            }
        }
        // Handle Mates
        if (lines[i].includes('score mate')) {
            const match = lines[i].match(/score mate ([-+]?\d+)/);
            cpValue = match[1] > 0 ? 99.0 : -99.0; // Represent mate as a high score
            break;
        }
    }

    return {
        matEval: 0, // Search score doesn't provide these separately
        posEval: 0,
        finalEval: cpValue
    };
}

runEvaluation();
