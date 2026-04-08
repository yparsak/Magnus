
/* Uses lichess opening book files, inserts into the db */

require('dotenv').config({
  path: require('path').resolve(__dirname, '.env')
});

const fs = require('fs');
const { Chess } = require('chess.js');
const mysql = require('mysql2/promise');

async function importOpenings() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    // Process files a.tsv through e.tsv
    const files = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

    for (const file of files) {
        if (!fs.existsSync(file)) {
            console.log(`Skipping ${file}: File not found.`);
            continue;
        }

        console.log(`Processing ${file}...`);
        const data = fs.readFileSync(file, 'utf8').split('\n');

        for (let i = 1; i < data.length; i++) {
            const line = data[i].trim();
            if (!line) continue;

            const [eco, name, pgn] = line.split('\t');
            
            const chess = new Chess();
            try {
                // Generate FEN from PGN
                chess.loadPgn(pgn);
                const fen = chess.fen();

                await connection.execute(
                    'INSERT INTO opening_book (eco, name, fen, pgn) VALUES (?, ?, ?, ?)',
                    [eco, name, fen, pgn]
                );
            } catch (e) {
                // Some Lichess PGNs might have comments or variations; chess.js handles most
                console.error(`Error on line ${i} of ${file}: ${pgn}`);
            }
        }
    }

    console.log("Database import successful.");
    await connection.end();
}

importOpenings().catch(console.error);
