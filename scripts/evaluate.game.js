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
            'SELECT id, short_notation FROM game_moves WHERE game_id = ? ORDER BY id ASC',
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
            
            const rawEval = await sendCommand(stockfish, 'eval', 'Final evaluation');
            const evaluation = parseEval(rawEval);

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
function sendCommand(child, command, terminator) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        
        const onData = (data) => {
            const chunk = data.toString();
            buffer += chunk;
            
            // If no terminator is provided (e.g. for 'position' command), resolve immediately
            if (!terminator || buffer.includes(terminator)) {
                child.stdout.removeListener('data', onData);
                resolve(buffer);
            }
        };

        child.stdout.on('data', onData);
        
        // Timeout if engine takes too long to respond to a command
        const timeout = setTimeout(() => {
            child.stdout.removeListener('data', onData);
            reject(new Error(`Stockfish timeout on command: ${command}`));
        }, 5000);

        child.stdin.write(`${command}\n`);
        
        // Clear timeout if resolved
        if (!terminator) {
            clearTimeout(timeout);
            resolve();
        }
    });
}

function parseEval(text) {
    const getVal = (regex) => {
        const match = text.match(regex);
        return match ? parseFloat(match[1]) : 0;
    };

    return {
        matEval: getVal(/NNUE Material Eval:\s+([-+]?\d+\.\d+)/),
        posEval: getVal(/NNUE Positional:\s+([-+]?\d+\.\d+)/),
        finalEval: getVal(/Final\s+evaluation\s+([-+]?\d+\.\d+)/)
    };
}

runEvaluation();
