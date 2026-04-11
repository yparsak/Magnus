const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

const SF_PATH=process.env.ENGINE_PATH;
const DEPTH = 20;
const TIMEOUT_MS = 60 * 60 * 1000; 

function parseStockfishEval(output) {
    let material = 0, positional = 0, final = 0;
    
    const bucketRegex = /\|\s+(\d+)\s+\|\s+([+-]?\d+\.\d+)\s+\|\s+([+-]?\d+\.\d+)\s+\|\s+([+-]?\d+\.\d+)\s+\|\s+<-- this bucket is used/;
    const finalRegex = /Final evaluation\s+([+-]?\d+\.\d+)/;

    const bucketMatch = output.match(bucketRegex);
    const finalMatch = output.match(finalRegex);

    if (bucketMatch) {
        material = parseFloat(bucketMatch[2]);
        positional = parseFloat(bucketMatch[3]);
    }

    if (finalMatch) {
        final = parseFloat(finalMatch[1]);
    }

    return { material, positional, final };
}

async function getEngineEval(fen) {
    return new Promise((resolve, reject) => {
        const engine = spawn(SF_PATH);
        let output = '';

        const timer = setTimeout(() => {
            engine.kill();
            reject(new Error(`Stockfish timeout for FEN: ${fen}`));
        }, 20000); 

        engine.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('Final evaluation')) {
                engine.stdin.write('quit\n');
            }
        });

        engine.stdin.write(`position fen ${fen}\n`);
        engine.stdin.write(`go depth ${DEPTH}\n`);
        engine.stdin.write(`eval\n`);

        engine.on('close', () => {
            clearTimeout(timer);
            resolve(parseStockfishEval(output));
        });

        engine.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function main() {
    let connection;

    const scriptTimeout = setTimeout(() => {
        console.error('Script reached 1 hour limit.');
        process.exit(1);
    }, TIMEOUT_MS);

    try {
        connection = await mysql.createConnection(DB_CONFIG);

        const [rows] = await connection.execute(
            'SELECT id, fen FROM evaluation WHERE final_eval IS NULL'
        );

        for (const row of rows) {
            try {
                const evals = await getEngineEval(row.fen);

                await connection.execute(
                    `UPDATE evaluation 
                     SET material_eval = ?, positional_eval = ?, final_eval = ? 
                     WHERE id = ?`,
                    [evals.material, evals.positional, evals.final, row.id]
                );

                console.log(`Updated ID ${row.id}`);
            } catch (err) {
                console.error(`Error on ID ${row.id}:`, err.message);
            }
        }

    } catch (error) {
        console.error('Database connection error:', error.message);
    } finally {
        clearTimeout(scriptTimeout);
        if (connection) await connection.end();
        console.log('Done.');
    }
}

main();
