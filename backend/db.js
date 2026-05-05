import pkg from "pg";

const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,                        // Max connections in pool
  idleTimeoutMillis: 30000,       // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Fail fast if can't connect in 5s
});

export async function testConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT 1 as ok");
    return res.rows[0];
  } finally {
    client.release();
  }
}
