// netlify/functions/import-product.js
// Fetches product from Amazon via Rainforest API, then creates it in the
// merchant's Shopify store using their access token
 
exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
 
  // ── CORS headers (needed for browser fetch calls) ──
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
 
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
 
  // ── Parse request body ──
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
 
  const { asin, domain, price, compareAt, title, description, tags, category, previewOnly } = body;
 
  // ── Get shop + token from cookie ──
  const cookies = parseCookies(event.headers.cookie || "");
  const shopifyToken = cookies.shopify_token;
  const shop = cookies.shop;
 
  if (!shopifyToken || !shop) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Not authenticated. Please reinstall the app." }),
    };
  }
 
  let tokenData;
  try {
    tokenData = JSON.parse(Buffer.from(shopifyToken, "base64").toString());
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
  }
 
  const { access_token } = tokenData;
 
  if (!asin) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ASIN" }) };
  }
 
  try {
    // ── Step 1: Fetch product from Rainforest API ──
    const RAINFOREST_KEY = process.env.RAINFOREST_API_KEY;
    const amazonDomain = domain || "amazon.com";
 
    const rfResp = await fetch(
      `https://api.rainforestapi.com/request?api_key=${RAINFOREST_KEY}&type=product&asin=${asin}&amazon_domain=${amazonDomain}`
    );
    const rfData = await rfResp.json();
 
    if (!rfData.product) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Product not found on Amazon" }),
      };
    }
 
    const p = rfData.product;
 
    // ── If previewOnly, just return the Amazon data without touching Shopify ──
    if (previewOnly) {
      const cost = p.buybox_winner?.price?.value || p.price?.value || p.prices?.[0]?.value || 0;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          amazonProduct: {
            title: p.title,
            image: p.main_image?.link || p.images?.[0]?.link || "",
            amazon_cost: cost,
            brand: p.brand || "",
            rating: p.rating,
            tags: [p.brand, ...(p.categories?.slice(0,3).map(c => c.name) || [])].filter(Boolean).join(", "),
            category: p.categories?.[0]?.name || "General",
          }
        }),
      };
    }
 
    // ── Parse Amazon price ──
    const amazonCost =
      p.buybox_winner?.price?.value ||
      p.price?.value ||
      p.prices?.[0]?.value ||
      0;
 
    // Use values from frontend if provided, otherwise auto-calculate
    const salePrice = price || (amazonCost * 2.5).toFixed(2);
    const compareAtPrice = compareAt || (amazonCost * 3).toFixed(2);
 
    // ── Build product description from bullet points ──
    const bodyHtml = p.feature_bullets
      ? "<ul>" + p.feature_bullets.map((b) => `<li>${b}</li>`).join("") + "</ul>"
      : p.description || "";
 
    // ── Step 2: Get the first location ID from the merchant's store ──
    const locResp = await fetch(
      `https://${shop}/admin/api/2024-01/locations.json`,
      { headers: { "X-Shopify-Access-Token": access_token } }
    );
    const locData = await locResp.json();
    const locationId = locData.locations?.[0]?.id;
 
    // ── Step 3: Create product in Shopify ──
    const productPayload = {
      product: {
        title: title || p.title,
        body_html: description || bodyHtml,
        vendor: p.brand || "",
        product_type: category || p.categories?.[0]?.name || "General",
        tags: tags || [p.brand, ...(p.categories?.slice(0, 3).map((c) => c.name) || [])]
          .filter(Boolean)
          .join(", "),
        variants: [
          {
            price: String(salePrice),
            compare_at_price: String(compareAtPrice),
            sku: asin,
            inventory_management: "shopify",
            inventory_quantity: 10,
          },
        ],
        images: p.main_image?.link
          ? [{ src: p.main_image.link }]
          : p.images?.slice(0, 5).map((img) => ({ src: img.link })) || [],
      },
    };
 
    const createResp = await fetch(
      `https://${shop}/admin/api/2024-01/products.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(productPayload),
      }
    );
 
    const createData = await createResp.json();
 
    if (createData.errors) {
      console.error("Shopify create error:", createData.errors);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Shopify error: " + JSON.stringify(createData.errors) }),
      };
    }
 
    const createdProduct = createData.product;
 
    // ── Step 4: Set inventory if we have a location ──
    if (locationId && createdProduct.variants?.[0]?.inventory_item_id) {
      await fetch(`https://${shop}/admin/api/2024-01/inventory_levels/set.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: createdProduct.variants[0].inventory_item_id,
          available: 10,
        }),
      });
    }
 
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        product: {
          id: createdProduct.id,
          title: createdProduct.title,
          handle: createdProduct.handle,
          admin_url: `https://${shop}/admin/products/${createdProduct.id}`,
          storefront_url: `https://${shop}/products/${createdProduct.handle}`,
          image: createdProduct.images?.[0]?.src || "",
          price: createdProduct.variants?.[0]?.price,
          amazon_cost: amazonCost,
        },
      }),
    };
  } catch (err) {
    console.error("Import error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Import failed: " + err.message }),
    };
  }
};
 
// ── Cookie parser helper ──
function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, ...val] = cookie.trim().split("=");
    if (key) acc[key.trim()] = decodeURIComponent(val.join("="));
    return acc;
  }, {});
}
 