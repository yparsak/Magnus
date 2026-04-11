const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Script timeout: 1 hour (3600000 ms)
const SCRIPT_TIMEOUT = 3600000;
const timeoutHandle = setTimeout(() => {
    console.error('Script reached maximum execution time (1 hour). Exiting...');
    process.exit(1);
}, SCRIPT_TIMEOUT);

async function synchronizeEvaluations() {
    let connection;

    try {
        // Create a connection pool for efficiency
        const pool = mysql.createPool(dbConfig);
        connection = await pool.getConnection();

        console.log('Successfully connected to database. Starting synchronization...');

        // 1. Select all moves that haven't been linked to an evaluation
        const [moves] = await connection.execute(
            'SELECT id, fen FROM game_moves WHERE eval_id IS NULL'
        );

        if (moves.length === 0) {
            console.log('No pending moves to process.');
            return;
        }

        console.log(`Found ${moves.length} moves to evaluate/link.`);

        // 2. Prepare statements for performance
        const findEvalStmt = 'SELECT id FROM evaluation WHERE fen = ? LIMIT 1';
        const insertEvalStmt = 'INSERT INTO evaluation (fen) VALUES (?)';
        const updateMoveStmt = 'UPDATE game_moves SET eval_id = ? WHERE id = ?';

        for (const move of moves) {
            try {
                // Start a transaction for each move to ensure integrity
                await connection.beginTransaction();

                // Check if the FEN already exists in evaluation table
                const [evalRows] = await connection.execute(findEvalStmt, [move.fen]);
                
                let evaluationId;

                if (evalRows.length > 0) {
                    // Scenario A: Found existing FEN
                    evaluationId = evalRows[0].id;
                } else {
                    // Scenario B: FEN doesn't exist, create new row
                    // Note: If you later add Stockfish logic, values would be calculated here
                    const [insertResult] = await connection.execute(insertEvalStmt, [move.fen]);
                    evaluationId = insertResult.insertId;
                }

                // Update the game_moves table with the ID
                await connection.execute(updateMoveStmt, [evaluationId, move.id]);

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                console.error(`Failed to process move ID ${move.id}:`, err.message);
                // Continue to next move despite individual failure
            }
        }

        console.log('Synchronization complete.');

    } catch (error) {
        console.error('Critical Database Error:', error.message);
    } finally {
        if (connection) connection.release();
        clearTimeout(timeoutHandle);
        process.exit();
    }
}

/**
 * Stockfish Error Handler Placeholder
 * (Based on requirements for Stockfish communication handling)
 */
function handleStockfishError(error) {
    console.error('Stockfish Communication Error:', error);
    // Logic for restarting Stockfish process or logging specific FEN failures
}

// Run the script
synchronizeEvaluations();
