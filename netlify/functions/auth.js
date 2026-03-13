// netlify/functions/auth.js
// Step 1 of OAuth: redirect merchant to Shopify to authorize your app

exports.handler = async (event) => {
  const { shop } = event.queryStringParameters || {};

  if (!shop) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing shop parameter" }),
    };
  }

  // Sanitize shop domain
  const shopDomain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

  const CLIENT_ID = process.env.SHOPIFY_API_KEY;
  const REDIRECT_URI = `${process.env.APP_URL}/auth/callback`;
  const SCOPES = "write_products,read_products";

  // Random nonce to prevent CSRF
  const nonce = Math.random().toString(36).substring(2);

  const authUrl =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${nonce}`;

  return {
    statusCode: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `nonce=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    },
    body: "",
  };
};
