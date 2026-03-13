// netlify/functions/billing.js
// Creates a Shopify subscription charge for Importr

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
  
    const { shop, token, plan } = body;
  
    if (!shop || !token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Not authenticated" }) };
    }
  
    const plans = {
      pro: {
        name: "Importr Pro",
        price: "19.00",
        terms: "Unlimited imports, AI descriptions, Unsplash images",
      },
      business: {
        name: "Importr Business",
        price: "49.00",
        terms: "Everything in Pro plus bulk import and priority support",
      },
    };
  
    const selectedPlan = plans[plan];
    if (!selectedPlan) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid plan" }) };
    }
  
    try {
      const resp = await fetch(
        `https://${shop}/admin/api/2024-01/recurring_application_charges.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recurring_application_charge: {
              name: selectedPlan.name,
              price: selectedPlan.price,
              terms: selectedPlan.terms,
              return_url: `${process.env.APP_URL}/?shop=${shop}&token=${token}&billing=success`,
              test: true, // Remove this line when going live
            },
          }),
        }
      );
  
      const data = await resp.json();
  
      if (data.errors) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: JSON.stringify(data.errors) }) };
      }
  
      const confirmUrl = data.recurring_application_charge?.confirmation_url;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ confirmUrl }),
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  };