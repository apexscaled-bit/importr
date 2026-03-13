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
    const amazonCost = p.buybox_winner?.price?.value || p.price?.value || p.prices?.[0]?.value || 0;

    // ── Use Claude AI to generate full store content ──
    const bulletPoints = p.feature_bullets?.slice(0, 5).join("\n") || p.description || "";
    const claudePrompt = `You are a Shopify store builder. Given this Amazon product, create a complete store identity and product content.

Product: ${p.title}
Brand: ${p.brand || "Unknown"}
Price: $${amazonCost}
Category: ${p.categories?.[0]?.name || "General"}
Features:
${bulletPoints}

Respond ONLY with a JSON object (no markdown, no backticks) with these exact keys:
{
  "storeName": "catchy 2-3 word store name for this product niche",
  "tagline": "one compelling sentence store tagline under 60 chars",
  "heroHeading": "punchy homepage hero heading under 40 chars",
  "heroSubheading": "compelling homepage subheading under 80 chars",
  "heroCta": "call to action button text under 20 chars",
  "productTitle": "improved product title under 80 chars",
  "productDescription": "3 paragraphs of compelling HTML using <p> tags. Focus on benefits and lifestyle. No bullet points.",
  "seoTitle": "SEO page title under 60 chars",
  "seoDescription": "SEO meta description under 160 chars",
  "tags": "5-8 relevant comma-separated tags",
  "accentColor": "a hex color code that fits this product niche e.g. #FF6B35"
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
      const clean = rawText.replace(/```json|```/g, "").trim();
      ai = JSON.parse(clean);
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
            image: p.main_image?.link || p.images?.[0]?.link || "",
            amazon_cost: amazonCost,
            brand: p.brand || "",
            rating: p.rating,
            tags: ai.tags || "",
            category: p.categories?.[0]?.name || "General",
            aiContent: ai,
          }
        }),
      };
    }

    const salePrice = price || (amazonCost * 2.5).toFixed(2);
    const compareAtPrice = compareAt || (amazonCost * 3).toFixed(2);

    const bodyHtml = ai.productDescription ||
      (p.feature_bullets
        ? "<ul>" + p.feature_bullets.map((b) => `<li>${b}</li>`).join("") + "</ul>"
        : p.description || "");

    // ── Step 1: Get location ──
    const locResp = await fetch(
      `https://${shop}/admin/api/2024-01/locations.json`,
      { headers: { "X-Shopify-Access-Token": access_token } }
    );
    const locData = await locResp.json();
    const locationId = locData.locations?.[0]?.id;

    // ── Step 2: Create product ──
    const productPayload = {
      product: {
        title: ai.productTitle || title || p.title,
        body_html: bodyHtml,
        vendor: p.brand || "",
        product_type: category || p.categories?.[0]?.name || "General",
        tags: ai.tags || tags || [p.brand, ...(p.categories?.slice(0, 3).map((c) => c.name) || [])].filter(Boolean).join(", "),
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
          ? [{ src: p.main_image.link }, ...(p.images?.slice(1, 5).map(img => ({ src: img.link })) || [])]
          : p.images?.slice(0, 5).map((img) => ({ src: img.link })) || [],
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
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Shopify error: " + JSON.stringify(createData.errors) }),
      };
    }

    const createdProduct = createData.product;

    // ── Step 3: Set inventory ──
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

    // ── Step 4: Update store theme settings ──
    let themeUpdated = false;
    try {
      // Get the main published theme
      const themesResp = await fetch(
        `https://${shop}/admin/api/2024-01/themes.json`,
        { headers: { "X-Shopify-Access-Token": access_token } }
      );
      const themesData = await themesResp.json();
      const mainTheme = themesData.themes?.find(t => t.role === "main");

      if (mainTheme) {
        // Get current theme settings
        const settingsResp = await fetch(
          `https://${shop}/admin/api/2024-01/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
          { headers: { "X-Shopify-Access-Token": access_token } }
        );
        const settingsData = await settingsResp.json();
        const currentSettings = JSON.parse(settingsData.asset?.value || "{}");

        // Update hero section and store info
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

    // ── Step 5: Update store metafields with AI content ──
    try {
      await fetch(`https://${shop}/admin/api/2024-01/metafields.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": access_token, "Content-Type": "application/json" },
        body: JSON.stringify({
          metafield: {
            namespace: "importr",
            key: "store_tagline",
            value: ai.tagline || "",
            type: "single_line_text_field",
          }
        }),
      });
    } catch (e) {
      console.error("Metafield update failed (non-fatal):", e);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        themeUpdated,
        aiContent: ai,
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
        storeSetup: {
          storeName: ai.storeName,
          tagline: ai.tagline,
          heroHeading: ai.heroHeading,
          heroSubheading: ai.heroSubheading,
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