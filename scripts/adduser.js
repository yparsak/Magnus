const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'scripts', '.env') });

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const BCRYPT_SALT_ROUNDS = 10;

const readline = require('readline');

function askUsername(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askPassword(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Access the internal _writeToOutput to intercept what gets echoed
    rl._writeToOutput = function (stringToWrite) {
      // Only echo the prompt itself; mask everything else with *
      if (stringToWrite === query) {
        rl.output.write(stringToWrite);
      } else if (stringToWrite === '\r\n' || stringToWrite === '\n') {
        rl.output.write(stringToWrite);
      } else {
        rl.output.write('*');
      }
    };

    rl.question(query, (answer) => {
      rl.close();
      console.log(''); // move to next line cleanly
      resolve(answer);
    });
  });
}

async function main() {
  const username = await askUsername('Enter username: ');
  const password = await askPassword('Enter password: ');

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await connection.query(
    'INSERT INTO users (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
    [username, passwordHash]
  );
  await connection.end();

  console.log(`User "${username}" created/updated with a hashed password.`);

}

main().catch((err) => {
  console.error('Failed to create user:', err.message);
  process.exit(1);
});
