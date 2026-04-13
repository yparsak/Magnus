
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

  const scriptTimeout = setTimeout(() => {
        console.error('Script reached 1 hour limit.');
        process.exit(1);
  }, TIMEOUT_MS);

  scriptTimeout.unref();

  let conn;
  let MaterialEval   = 0;
  let PositionalEval = 0;
  let FinalEval      = 0;
  let is_incheck     = null;
  let in_mate        = null;

  try {

    const engine = spawn(ENGINE_PATH);
    engine.on('error', (err) => {
            console.error('Failed to start chess engine process:', err);
            process.exit(1);
    });

    conn = await mysql.createConnection(DB_CONFIG);
    const [rows] = await conn.execute(
            `SELECT id, fen FROM evaluation WHERE final_eval IS NULL LIMIT ${MAX_ROWS}`
    );

    for (const row of rows) {

      MaterialEval = 0;
      PositionalEval = 0;
      FinalEval = 0;
      is_incheck = null;
      mate_in =null;

      await sendCommand(engine, 'uci', 'uciok');
      await sendCommand(engine, 'isready', 'readyok');
      await sendCommand(engine, 'ucinewgame');    
      await sendCommand(engine, `position fen ${row.fen}`, null);

      const evalresp = await sendCommand(engine, 'eval', 'Final evaluation', 10000);
      const eval_lines = evalresp.split(/\r?\n/);

  
      eval_lines.forEach(eval => {
        if (eval.includes("Final evaluation: none (in check)")) {
          MaterialEval = 0;
          PositionalEval = 0;
          FinalEval = 0;
          is_incheck = 1;
          return; 
        }
        if (eval.includes("this bucket is used")) {
          const segments = eval.split('|').map(s => s.trim());
          // Format: | ndx (index 1) | Material (index 2) | Positional (index 3) |
          if (segments.length >= 4) {
            MaterialEval = segments[2].replace(/\s+/g, '');
            PositionalEval = segments[3].replace(/\s+/g, '');
          }
        }
        if (/final evaluation/i.test(eval)) {
          const eval_match = eval.match(/[+-]?\d+\.\d+/);
          if (eval_match) {
            FinalEval = eval_match[0];
          }
        }
      });

      const bestmove_resp = await sendCommand(
        engine, 
        'go depth 20', 
        'bestmove', 
        30000 // 30 seconds
      );

      const bestmove_lines = bestmove_resp.split(/\r?\n/);
      bestmove_lines.forEach( bestmove => {
        // Regex matches "score mate " followed by one or more digits
        const match = bestmove.match(/score mate (-?\d+)/);
        if (match) {
          const current_mate = Math.abs(parseInt(match[1]));
          // Update mate_in if it's the first one found or smaller than current
          if (mate_in === 0 || current_mate < mate_in) {
             mate_in = current_mate;
          }
        }
        if (bestmove.includes("bestmove (none)")) {
          mate_in = 0;
        }
      }); 
    
      await conn.execute(
          `UPDATE evaluation 
           SET material_eval = ?, positional_eval = ?, final_eval = ?, is_incheck = ?, mate_in = ? 
           WHERE id = ?`,
           [MaterialEval, PositionalEval, FinalEval, is_incheck, mate_in, row.id]
      );

    }

    engine.kill();

  } catch (error) {
    console.error('Error:', error.message); 
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

main();
