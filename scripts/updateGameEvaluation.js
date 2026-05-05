
  require('dotenv').config({ quiet: true });
  const mysql = require('mysql2/promise');
  const { spawn } = require('child_process');

  const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  };

  const ENGINE_PATH = process.env.ENGINE_PATH;

  const timeout = setTimeout(() => {
    console.error('ERROR: Script timed out!');
    process.exit(1);
  }, 3600000);

  async function getStockfishData(fen) {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';

        engine.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('bestmove')) {
                engine.stdin.write('quit\n');
            }
        });

        // Setup engine parameters
        engine.stdin.write(`position fen ${fen}\n`);
        engine.stdin.write('eval\n'); // For the bucket table
        engine.stdin.write('setoption name MultiPV value 10\n');
        engine.stdin.write('go depth 10\n');
        engine.on('close', () => resolve(output));
    });
  }

function parseEval(output) {
    if (output.includes("Final evaluation: none (in check)")) {
      if (output.includes("bestmove (none)")) {
        return {
          material: "0.00",
          positional: "0.00",
          final: "0.00",
          in_check: 1,
          mate: 1
        };
      }
      return {
        material: "0.00",
        positional: "0.00",
        final: "0.00",
        in_check: 1,
        mate: 0
      };
    }

    const bucketRegex = /\|\s*\d+\s*\|\s*([+-]?\s*[\d.]+)\s*\|\s*([+-]?\s*[\d.]+)\s*\|.*<-- this bucket is used/;
    
    const finalRegex = /Final evaluation\s+([+-]\s*[\d.]+)/;

    const bucketMatch = output.match(bucketRegex);
    const finalMatch = output.match(finalRegex);

    if (!bucketMatch || !finalMatch) {
        console.error("Regex failed to match output structure.");
        return null;
    }

    // Clean up spaces so "-  1.27" becomes "-1.27"
    return {
        material: bucketMatch[1].replace(/\s+/g, ''),
        positional: bucketMatch[2].replace(/\s+/g, ''),
        final: finalMatch[1].replace(/\s+/g, ''),
        in_check: 0,
        mate: 0
    };
}

async function main() {

  const now = new Date();
  console.log(`Starting Game Evaluation @ ${now.toLocaleString()}`);

  const conn = await mysql.createConnection(dbConfig);

  try {

    const [moves] = await conn.execute(
          'SELECT id, fen FROM game_moves WHERE eval_id IS NULL LIMIT 100'
    );

    for (const move of moves) {
      //console.log(`Processing Move ${move.id}`);
      await conn.beginTransaction();

      try {
        const [eval] = await conn.execute(
          'SELECT id FROM evaluation WHERE fen = ? LIMIT 1',
          [move.fen]
        );

        if (eval.length > 0) {
          await conn.execute(
            'UPDATE game_moves SET eval_id = ? WHERE id = ?',
            [eval[0].id, move.id]
          );  
        } else {

          const rawOutput = await getStockfishData(move.fen); 

          const evalData = parseEval(rawOutput);

          if (evalData == null) {
            console.log(`Error: Unable to parse Evaluation Data`);
            //console.log(rawOutput);
          } else {

            const [evalResult] = await conn.execute(
               `INSERT INTO evaluation (fen,material_eval, positional_eval, final_eval, incheck, mate) 
               VALUES (?,?, ?, ?, ?, ?)`,
               [move.fen, evalData.material, evalData.positional, evalData.final, evalData.in_check, evalData.mate]
            );

            const newEvalId = evalResult.insertId;

            await conn.execute(
              'UPDATE game_moves SET eval_id = ? WHERE id = ?',
              [newEvalId, move.id]
            );
            //console.log(` ${evalData.material} ${evalData.positional} ${evalData.final} ${evalData.in_check} ${evalData.mate}`);
          }
        }

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        console.error(`Error processing Move ${move.id} ${err}`);
      }
    }
  } catch (err) {
    console.error("Database connection error:", err);
  } finally {
    await conn.end();
    const endtime = new Date();
    console.log(`Done Game Evaluation @ ${endtime.toLocaleString()}`);

    timeout.unref();
  }
}

main();

