import pkg from "pg";

const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
