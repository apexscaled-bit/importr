// netlify/functions/usage.js
// Tracks import usage per shop using Neon PostgreSQL

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { shop, token, action } = body;
  if (!shop) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing shop" }) };
  }

  try {
    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shop_usage (
        shop TEXT PRIMARY KEY,
        imports_count INTEGER DEFAULT 0,
        plan TEXT DEFAULT 'free',
        plan_id TEXT,
        token TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    if (action === "get") {
      // Get current usage
      const result = await pool.query(
        "SELECT * FROM shop_usage WHERE shop = $1",
        [shop]
      );
      const row = result.rows[0];
      if (!row) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ shop, imports_count: 0, plan: "free", limit: 5 }),
        };
      }
      const limit = row.plan === "free" ? 5 : 999999;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ...row, limit }),
      };
    }

    if (action === "increment") {
      // Upsert and increment
      await pool.query(`
        INSERT INTO shop_usage (shop, imports_count, token, updated_at)
        VALUES ($1, 1, $2, NOW())
        ON CONFLICT (shop) DO UPDATE SET
          imports_count = shop_usage.imports_count + 1,
          token = $2,
          updated_at = NOW()
      `, [shop, token || ""]);

      const result = await pool.query("SELECT * FROM shop_usage WHERE shop = $1", [shop]);
      const row = result.rows[0];
      const limit = row.plan === "free" ? 5 : 999999;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ...row, limit, canImport: row.imports_count <= limit }),
      };
    }

    if (action === "upgrade") {
      const { plan, planId } = body;
      await pool.query(`
        INSERT INTO shop_usage (shop, plan, plan_id, token, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (shop) DO UPDATE SET
          plan = $2,
          plan_id = $3,
          token = $4,
          updated_at = NOW()
      `, [shop, plan, planId || "", token || ""]);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};