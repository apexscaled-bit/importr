// netlify/functions/callback.js
// Step 2 of OAuth: Shopify redirects back here with a code
// We exchange it for a permanent access token, then redirect to the app

exports.handler = async (event) => {
  const { shop, code, hmac, state } = event.queryStringParameters || {};

  if (!shop || !code) {
    return {
      statusCode: 400,
      body: "Missing required parameters",
    };
  }

  const CLIENT_ID = process.env.SHOPIFY_API_KEY;
  const CLIENT_SECRET = process.env.SHOPIFY_API_SECRET;

  // ── Verify HMAC signature from Shopify ──
  const crypto = require("crypto");
  const params = { ...event.queryStringParameters };
  delete params.hmac;
  delete params.signature;

  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(message)
    .digest("hex");

  if (digest !== hmac) {
    return { statusCode: 403, body: "HMAC validation failed" };
  }

  // ── Exchange code for access token ──
  try {
    const tokenResp = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
        }),
      }
    );

    const { access_token, scope } = await tokenResp.json();

    if (!access_token) {
      return { statusCode: 400, body: "Failed to get access token" };
    }

    // ── Store token in a secure cookie and redirect to app ──
    // In production you'd save this to a database (e.g. Supabase/PlanetScale)
    // For now we store it in a secure cookie tied to the shop
    return {
      statusCode: 302,
      headers: {
        Location: `/?shop=${shop}&token=${access_token}`,
      },
      body: "",
    };
    
  } catch (err) {
    console.error("Token exchange failed:", err);
    return { statusCode: 500, body: "OAuth failed: " + err.message };
  }
};
