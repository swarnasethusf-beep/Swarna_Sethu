/**
 * Generate ADMIN_PASSWORD_HASH for backend/.env
 *
 *   node scripts/hash-password.js "my-strong-password"
 */
const bcrypt = require("bcrypt");

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: node scripts/hash-password.js "<password, at least 10 characters>"');
  process.exit(1);
}
bcrypt.hash(password, 12).then((hash) => {
  console.log("Add this line to backend/.env (single quotes keep the $ characters intact):\n");
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
});
