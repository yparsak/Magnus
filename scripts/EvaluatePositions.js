require('dotenv').config();
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');

// 1. Database Connection Configuration 
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

const ENGINE_PATH = process.env.ENGINE_PATH;

// 8. Global Timer: 1 Hour (3600000ms)
setTimeout(() => {
    console.log("Time limit reached. Exiting script.");
    process.exit(0);
}, 3600000);

/**
 * Communicates with Stockfish binary
 */
async function getStockfishData(fen) {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';

        engine.stdout.on('data', (data) => {
            output += data.toString();
            // We look for "bestmove" to know the depth 20 analysis is done
            if (output.includes('bestmove')) {
                engine.stdin.write('quit\n');
            }
        });

        // Setup engine parameters
        engine.stdin.write(`position fen ${fen}\n`);
        engine.stdin.write('eval\n'); // For the bucket table
        engine.stdin.write('setoption name MultiPV value 10\n');
        engine.stdin.write('go depth 20\n');
        
        engine.on('close', () => resolve(output));
    });
}

/**
 * Parsers for Stockfish output
 */
function parseEval(output) {
    // Regex to find the row marked with <-- this bucket is used
    // Matches: | 7 | 0.00 | + 0.12 | + 0.12 | <-- this bucket is used
    const bucketRegex = /\|\s+\d+\s+\|\s+([\d.-]+)\s+\|\s+([+-]\s+[\d.]+)\s+\|.*<-- this bucket is used/;
    const finalRegex = /Final evaluation\s+([+-][\d.]+)/;

    const bucketMatch = output.match(bucketRegex);
    const finalMatch = output.match(finalRegex);

    if (!bucketMatch || !finalMatch) return null;

    return {
        material: bucketMatch[1].replace(/\s/g, ''),
        positional: bucketMatch[2].replace(/\s/g, ''),
        final: finalMatch[1].replace(/\s/g, '')
    };
}

function parseBestMoves(output) {
    const moves = [];
    const lines = output.split('\n');
    
    // Look for lines like: info depth 20 ... cp 15 ... pv e2e4
    // We only take the ones from the final depth 20 report
    const depth20Lines = lines.filter(l => l.includes('depth 20') && l.includes(' multipv '));
    
    // Get the last 10 MultiPV entries
    const latestMoves = depth20Lines.slice(-10);

    latestMoves.forEach(line => {
        const cpMatch = line.match(/cp (-?\d+)/);
        const pvMatch = line.match(/pv (\w+)/);
        if (cpMatch && pvMatch) {
            moves.push({
                short_notation: pvMatch[1], // Stockfish returns LAN, mapping to schema
                eval: (parseInt(cpMatch[1]) / 100).toFixed(2)
            });
        }
    });
    return moves;
}

/**
 * Main Logic
 */
async function run() {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        // 2. Select rows from game_moves
        const [rows] = await connection.execute(
            'SELECT id, fen FROM game_moves WHERE eval_id IS NULL LIMIT 5'
        );

        for (const row of rows) {
            // Start Transaction for each FEN
            await connection.beginTransaction();

            try {
                // 3. Search for existing FEN in evaluation table
                const [existing] = await connection.execute(
                    'SELECT id FROM evaluation WHERE fen = ? LIMIT 1',
                    [row.fen]
                );

                if (existing.length > 0) {
                    // 3.1 Found: Update game_moves and commit
                    await connection.execute(
                        'UPDATE game_moves SET eval_id = ? WHERE id = ?',
                        [existing[0].id, row.id]
                    );
                } else {
                    // 3.2 & 4. Run Stockfish
                    const rawOutput = await getStockfishData(row.fen);
                    const evalData = parseEval(rawOutput);
                    const bestMoves = parseBestMoves(rawOutput);

                    if (evalData) {
                        // 5. Store in evaluation table
                        const [evalResult] = await connection.execute(
                            `INSERT INTO evaluation (fen, material_eval, positional_eval, final_eval) 
                             VALUES (?, ?, ?, ?)`,
                            [row.fen, evalData.material, evalData.positional, evalData.final]
                        );
                        const newEvalId = evalResult.insertId;

                        // Set game_moves.eval_id
                        await connection.execute(
                            'UPDATE game_moves SET eval_id = ? WHERE id = ?',
                            [newEvalId, row.id]
                        );

                        // 6 & 7. Enter best moves
                        for (const move of bestMoves) {
                            await connection.execute(
                                `INSERT INTO best_moves (short_notation, eval, eval_id) 
                                 VALUES (?, ?, ?)`,
                                [move.short_notation, move.eval, newEvalId]
                            );
                        }
                    }
                }
                await connection.commit();
                console.log(`Processed row ID: ${row.id}`);
            } catch (err) {
                await connection.rollback();
                console.error(`Error processing FEN ${row.fen}:`, err);
            }
        }
    } catch (err) {
        console.error("Database connection error:", err);
    } finally {
        await connection.end();
    }
}

run();
