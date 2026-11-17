// READ-ONLY check: does any account still use a well-known default password?
//   * Only SELECTs from `users`. Changes nothing, resets nothing, prints no hashes and no passwords.
//   * Output: account id, e-mail, role, status and WHICH well-known default matched (if any).
//
// Run it inside the backend container, feeding the file through stdin (nothing is copied into the container):
//   docker compose exec -T backend node --input-type=module < scripts/readonly_check_default_passwords.mjs
import pg from 'pg';
import bcrypt from 'bcryptjs';

const KNOWN_DEFAULTS = ['admin123', 'Qonnect@123', 'password', '12345678', 'fieldops_pass', 'lead123', 'tech123', 'sales123'];
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  max: 1,
});
try {
  await pool.query('BEGIN TRANSACTION READ ONLY');
  const { rows } = await pool.query('SELECT id, email, role, status, password FROM users ORDER BY role, email');
  await pool.query('ROLLBACK');
  let hits = 0;
  console.log(`Checked ${rows.length} accounts against ${KNOWN_DEFAULTS.length} well-known default passwords.\n`);
  for (const u of rows) {
    let matched = null;
    for (const d of KNOWN_DEFAULTS) {
      if (u.password && (await bcrypt.compare(d, u.password).catch(() => false))) { matched = d; break; }
    }
    if (matched) { hits++; console.log(`DEFAULT PASSWORD IN USE  ${u.role.padEnd(15)} ${u.status.padEnd(9)} ${u.email}   (matches "${matched}")`); }
  }
  console.log(hits ? `\n${hits} account(s) use a well-known default password — see the credential-rotation procedure.` : 'No account uses any of the checked default passwords.');
} finally {
  await pool.end();
}
