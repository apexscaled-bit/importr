// netlify/functions/import-product.js
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

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

  const { asin, domain, price, compareAt, title, description, tags, category, previewOnly, shop, token } = body;
  const access_token = token;

  if (!access_token || !shop) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Not authenticated. Please reinstall the app." }),
    };
  }

  if (!asin) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ASIN" }) };
  }

  try {
    const RAINFOREST_KEY = process.env.RAINFOREST_API_KEY;
    const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
    const amazonDomain = domain || "amazon.com";

    // ── Fetch Amazon product ──
    const rfResp = await fetch(
      `https://api.rainforestapi.com/request?api_key=${RAINFOREST_KEY}&type=product&asin=${asin}&amazon_domain=${amazonDomain}`
    );
    const rfData = await rfResp.json();

    if (!rfData.product) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Product not found on Amazon" }) };
    }

    const p = rfData.product;
    const amazonCost = p.buybox_winner?.price?.value || p.price?.value || p.prices?.[0]?.value || 0;
    const productCategory = p.categories?.[0]?.name || category || "product";
    const searchQuery = `${p.brand || ""} ${productCategory}`.trim();

    // ── Fetch Unsplash images ──
    async function getUnsplashImages(query, count = 5) {
      try {
        const resp = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
          { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
        );
        const data = await resp.json();
        return data.results?.map(img => img.urls?.regular) || [];
      } catch {
        return [];
      }
    }

    const [productImages, heroImages] = await Promise.all([
      getUnsplashImages(searchQuery, 5),
      getUnsplashImages(`${productCategory} lifestyle`, 1),
    ]);

    // ── Claude AI for store content ──
    const bulletPoints = p.feature_bullets?.slice(0, 5).join("\n") || p.description || "";
    const claudePrompt = `You are a Shopify store builder. Given this Amazon product, create complete store content.

Product: ${p.title}
Brand: ${p.brand || "Unknown"}
Price: $${amazonCost}
Category: ${productCategory}
Features:
${bulletPoints}

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "storeName": "catchy 2-3 word store name for this niche",
  "tagline": "compelling store tagline under 60 chars",
  "heroHeading": "punchy homepage hero heading under 40 chars",
  "heroSubheading": "compelling homepage subheading under 80 chars",
  "heroCta": "call to action button text under 20 chars",
  "productTitle": "improved product title under 80 chars",
  "productDescription": "3 paragraphs of compelling HTML using <p> tags. Focus on benefits and lifestyle.",
  "seoTitle": "SEO page title under 60 chars",
  "seoDescription": "SEO meta description under 160 chars",
  "tags": "5-8 relevant comma-separated tags",
  "accentColor": "hex color that fits this product niche e.g. #FF6B35"
}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: claudePrompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    let ai = {};
    try {
      const rawText = claudeData.content?.[0]?.text || "{}";
      ai = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      ai = {};
    }

    if (previewOnly) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          amazonProduct: {
            title: ai.productTitle || p.title,
            image: productImages[0] || p.main_image?.link || "",
            amazon_cost: amazonCost,
            brand: p.brand || "",
            rating: p.rating,
            tags: ai.tags || "",
            category: productCategory,
            aiContent: ai,
          }
        }),
      };
    }

    const salePrice = price || (amazonCost * 2.5).toFixed(2);
    const compareAtPrice = compareAt || (amazonCost * 3).toFixed(2);
    const bodyHtml = ai.productDescription ||
      (p.feature_bullets ? "<ul>" + p.feature_bullets.map(b => `<li>${b}</li>`).join("") + "</ul>" : p.description || "");

    // ── Get location ──
    const locResp = await fetch(
      `https://${shop}/admin/api/2024-01/locations.json`,
      { headers: { "X-Shopify-Access-Token": access_token } }
    );
    const locData = await locResp.json();
    const locationId = locData.locations?.[0]?.id;

    // ── Create product with Unsplash images ──
// Download Unsplash images and convert to base64 for Shopify
async function imageToBase64(url) {
  try {
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch {
    return null;
  }
}

let imageUrls = [];
if (productImages.length > 0) {
  const base64Images = await Promise.all(productImages.slice(0, 3).map(imageToBase64));
  imageUrls = base64Images
    .filter(Boolean)
    .map(attachment => ({ attachment }));
}
if (imageUrls.length === 0 && p.main_image?.link) {
  imageUrls = [{ src: p.main_image.link }];
}
    const productPayload = {
      product: {
        title: ai.productTitle || title || p.title,
        body_html: bodyHtml,
        vendor: p.brand || "",
        product_type: productCategory,
        tags: ai.tags || tags || "",
        variants: [{
          price: String(salePrice),
          compare_at_price: String(compareAtPrice),
          sku: asin,
          inventory_management: "shopify",
          inventory_quantity: 10,
        }],
        images: imageUrls,
      },
    };

    const createResp = await fetch(
      `https://${shop}/admin/api/2024-01/products.json`,
      {
        method: "POST",
        headers: { "X-Shopify-Access-Token": access_token, "Content-Type": "application/json" },
        body: JSON.stringify(productPayload),
      }
    );
    const createData = await createResp.json();

    if (createData.errors) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Shopify error: " + JSON.stringify(createData.errors) }) };
    }

    const createdProduct = createData.product;

    // ── Set inventory ──
    if (locationId && createdProduct.variants?.[0]?.inventory_item_id) {
      await fetch(`https://${shop}/admin/api/2024-01/inventory_levels/set.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": access_token, "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: createdProduct.variants[0].inventory_item_id,
          available: 10,
        }),
      });
    }

    // ── Update theme settings ──
    let themeUpdated = false;
    try {
      const themesResp = await fetch(
        `https://${shop}/admin/api/2024-01/themes.json`,
        { headers: { "X-Shopify-Access-Token": access_token } }
      );
      const themesData = await themesResp.json();
      const mainTheme = themesData.themes?.find(t => t.role === "main");

      if (mainTheme) {
        const settingsResp = await fetch(
          `https://${shop}/admin/api/2024-01/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
          { headers: { "X-Shopify-Access-Token": access_token } }
        );
        const settingsData = await settingsResp.json();
        const currentSettings = JSON.parse(settingsData.asset?.value || "{}");

        const updatedSettings = {
          ...currentSettings,
          current: {
            ...currentSettings.current,
            colors_accent_1: ai.accentColor || "#00e5a0",
            colors_accent_2: ai.accentColor || "#00e5a0",
          }
        };

        await fetch(
          `https://${shop}/admin/api/2024-01/themes/${mainTheme.id}/assets.json`,
          {
            method: "PUT",
            headers: { "X-Shopify-Access-Token": access_token, "Content-Type": "application/json" },
            body: JSON.stringify({
              asset: {
                key: "config/settings_data.json",
                value: JSON.stringify(updatedSettings),
              }
            }),
          }
        );
        themeUpdated = true;
      }
    } catch (themeErr) {
      console.error("Theme update failed (non-fatal):", themeErr);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        themeUpdated,
        aiContent: ai,
        heroImage: heroImages[0] || "",
        product: {
          id: createdProduct.id,
          title: createdProduct.title,
          handle: createdProduct.handle,
          admin_url: `https://${shop}/admin/products/${createdProduct.id}`,
          storefront_url: `https://${shop}/products/${createdProduct.handle}`,
          image: createdProduct.images?.[0]?.src || productImages[0] || "",
          price: createdProduct.variants?.[0]?.price,
          amazon_cost: amazonCost,
        },
        storeSetup: {
          storeName: ai.storeName,
          tagline: ai.tagline,
          heroHeading: ai.heroHeading,
          heroSubheading: ai.heroSubheading,
          heroCta: ai.heroCta,
        }
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Import failed: " + err.message }),
    };
  }
};
