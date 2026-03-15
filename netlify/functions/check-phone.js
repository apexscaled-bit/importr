/ netlify/functions/check-phone.js
// Checks if a phone number has reached the 2-account limit

import { neon } from '@netlify/neon';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { phone, email } = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: 'Phone required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // Create table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        imports_count INTEGER DEFAULT 0,
        plan TEXT DEFAULT 'free'
      )
    `;

    // Check how many accounts already use this phone
    const existing = await sql`
      SELECT email FROM user_accounts 
      WHERE phone = ${phone}
    `;

    const accountCount = existing.length;
    const alreadyOwned = existing.some(row => row.email === email);

    // Block if 2+ accounts on this number AND this email isn't one of them
    if (accountCount >= 2 && !alreadyOwned) {
      return new Response(JSON.stringify({ 
        blocked: true, 
        reason: 'Phone number limit reached (max 2 accounts)' 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Register/update this account's phone
    if (email) {
      await sql`
        INSERT INTO user_accounts (email, phone)
        VALUES (${email}, ${phone})
        ON CONFLICT (email) DO UPDATE SET phone = ${phone}
      `;
    }

    return new Response(JSON.stringify({ 
      blocked: false,
      accountCount,
      alreadyOwned
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('check-phone error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/auth/check-phone' };
