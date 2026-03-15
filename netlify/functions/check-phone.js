exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }
  
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
  
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }
  
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
  
    const { phone, uid, email, action } = body;
  
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  
    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing phone' }) };
    }
  
    try {
      if (action === 'register') {
        // Try to insert — will fail if phone already exists (UNIQUE constraint)
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/phone_accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ phone, uid, email }),
        });
  
        if (resp.status === 409) {
          // Phone already registered to another account
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ blocked: true, reason: 'phone_taken' }),
          };
        }
  
        if (!resp.ok) {
          const err = await resp.text();
          // If uid already exists, that's fine — same user re-registering
          if (err.includes('uid')) {
            return { statusCode: 200, headers, body: JSON.stringify({ blocked: false }) };
          }
          throw new Error('Database error: ' + err);
        }
  
        return { statusCode: 200, headers, body: JSON.stringify({ blocked: false }) };
  
      } else {
        // action === 'check' — just check if phone is already taken
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/phone_accounts?phone=eq.${encodeURIComponent(phone)}&select=uid`,
          {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
  
        const rows = await resp.json();
  
        if (rows.length > 0 && rows[0].uid !== uid) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ blocked: true, reason: 'phone_taken' }),
          };
        }
  
        return { statusCode: 200, headers, body: JSON.stringify({ blocked: false }) };
      }
  
    } catch (err) {
      console.error('check-phone error:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message }),
      };
    }
  };