// netlify/functions/auth.js
// Step 1 of OAuth: redirect merchant to Shopify to authorize your app

exports.handler = async (event) => {
  const { shop } = event.queryStringParameters || {};

  if (!shop) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing shop parameter' }) };
  }

  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;

  const nonce = Math.random().toString(36).substring(2);

  const authUrl =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=write_products,read_products,write_themes,read_themes,write_content,read_content` +
    `&redirect_uri=${encodeURIComponent(`${process.env.APP_URL}/auth/callback`)}` +
    `&state=${nonce}`;

  return {
    statusCode: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `nonce=${nonce}; HttpOnly; Secure; SameSite=None; Path=/`,
    },
    body: '',
  };
};
