/*
* updates evaluation table where final_eval = null
* communicates to chess engine, and extracts evaluation values 
* and stores in evaluation table
*/

const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

const ENGINE_PATH=process.env.ENGINE_PATH;
const DEPTH = 20;
const TIMEOUT_MS = 60 * 60 * 1000; 
const MAX_ROWS = 100;

async function main() {

  let conn;

  let MaterialEval   = 0;
  let PositionalEval = 0;
  let FinalEval      = 0 ;

  const scriptTimeout = setTimeout(() => {
        console.error('Script reached 1 hour limit.');
        process.exit(1);
  }, TIMEOUT_MS);

  try {
    conn = await mysql.createConnection(DB_CONFIG);

    const [rows] = await conn.execute(
            `SELECT id, fen FROM evaluation WHERE final_eval IS NULL LIMIT ${MAX_ROWS}`
    );

    for (const row of rows) {
      try {

        //console.log('>> ',row.fen);

        const engine = spawn(ENGINE_PATH);
 
        engine.on('error', (err) => {
            console.error('Failed to start chess engine process:', err);
            process.exit(1);
        });

        await sendCommand(engine, 'uci', 'uciok');
        await sendCommand(engine, 'isready', 'readyok');
        await sendCommand(engine, 'ucinewgame');
        await sendCommand(engine, `position fen ${row.fen}`, null);
        //await sendCommand(engine, 'isready', 'readyok');
 
        const rawEval = await sendCommand(engine, 'eval', 'Final evaluation', 10000);
        // const nnue = parseStaticEval(rawEval); 

        MaterialEval = 0;
        PositionalEval = 0;
        FinalEval = 0;
        const lines = rawEval.split(/\r?\n/);
       

        lines.forEach(line => {

          // | x |0.00|0.00|0.00| <-- this bucket is used
          if (line.includes('this bucket is used')) {
            const segments = line.split('|').map(s => s.trim());
            // Format: | ndx (index 1) | Material (index 2) | Positional (index 3) |

           if (segments.length >= 4) {
             MaterialEval = segments[2].replace(/([+-])\s+/g, '$1');;
             // This removes spaces specifically after a + or - sign
             PositionalEval = segments[3].replace(/([+-])\s+/g, '$1');
           }

          }

          // Final Evaluation
          if (/final evaluation/i.test(line)) {
            const match = line.match(/[+-]?\d+\.\d+/);
            if (match) {
              FinalEval = match[0];
            }
          }

        }); 

        //console.log('Material Eval: ', MaterialEval );
        //console.log('Positional Eval: ', PositionalEval );
        //console.log('Final Eval: ', FinalEval );

        await conn.execute(
          `UPDATE evaluation 
                     SET material_eval = ?, positional_eval = ?, final_eval = ? 
                     WHERE id = ?`,
                    [MaterialEval, PositionalEval, FinalEval, row.id]
                );

        engine.kill();


      } catch (err) {
        console.error(`Error on ID ${row.id}:`, err.message);
      }
    } 

  } catch (error) {
    console.error('Database connection error:', error.message); 
  } finally {
    clearTimeout(scriptTimeout);
    if (conn) await conn.end();
    console.log('Done.');
  }
}

function sendCommand(child, command, terminator, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const onData = (data) => {
            buffer += data.toString();
            if (!terminator || buffer.includes(terminator)) {
                child.stdout.removeListener('data', onData);
                clearTimeout(timeout);
                resolve(buffer);
            }
        };

        child.stdout.on('data', onData);
        const timeout = setTimeout(() => {
            child.stdout.removeListener('data', onData);
            reject(new Error(`Stockfish timeout on: ${command}`));
        }, timeoutMs);

        child.stdin.write(`${command}\n`);
        if (!terminator) {
            clearTimeout(timeout);
            resolve();
        }
    });
}

function parseEvaluation(content) {
    const lines = content.split(/\r?\n/);

    let MaterialEval = "Not found";
    let PositionalEval = "Not found";
    let FinalEval = "Not found";

    lines.forEach(line => {
        // 1. Process the active bucket line
        if (line.includes('this bucket is used')) {
            const segments = line.split('|').map(s => s.trim());
            
            // Format: | ndx (index 1) | Material (index 2) | Positional (index 3) |
            if (segments.length >= 4) {
                MaterialEval = segments[2];
                // Remove internal spaces (e.g., "+  0.12" becomes "+0.12")
                PositionalEval = segments[3].replace(/\s+/g, '');
            }
        }

        // 2. Process the final evaluation line
        // Case-insensitive search for "final evaluation"
        if (/final evaluation/i.test(line)) {
            const match = line.match(/[+-]?\d+\.\d+/);
            if (match) {
                FinalEval = match[0];
            }
        }
    });

    // Print results to screen
    console.log(`MaterialEval:   ${MaterialEval}`);
    console.log(`PositionalEval: ${PositionalEval}`);
    console.log(`FinalEval:      ${FinalEval}`);
}

main();
