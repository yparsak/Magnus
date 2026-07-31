const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env') });

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const BCRYPT_SALT_ROUNDS = 10;

// One-off admin utility for provisioning a username/password when USE_AUTH=1.
// There is no self-service sign-up route (out of scope for the login feature),
// so this is how an operator seeds the first accounts.
// Usage: node scripts/create-user.js <username> <password>
async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error('Usage: node scripts/create-user.js <username> <password>');
    process.exit(1);
  }

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
