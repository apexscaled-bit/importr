import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      background: "#0a0a0f",
      minHeight: "100vh",
      color: "#f0f0f5",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px"
    }}>
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "5px 14px",
          background: "rgba(0,229,160,0.12)", border: "1px solid rgba(0,229,160,0.2)",
          borderRadius: "100px", fontSize: "12px", fontWeight: "600",
          color: "#00e5a0", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "20px"
        }}>
          ✦ AMAZON → SHOPIFY
        </div>
        <h1 style={{ fontSize: "48px", fontWeight: "400", lineHeight: "1.1", marginBottom: "16px" }}>
          Paste any Amazon link,<br />
          <em style={{ color: "#00e5a0", fontStyle: "italic" }}>build your store</em>
        </h1>
        <p style={{ fontSize: "17px", color: "#6b6b80", maxWidth: "520px", margin: "0 auto 36px", lineHeight: "1.6" }}>
          Import real Amazon products instantly. Set your markup, customize details, then export directly to Shopify.
        </p>
      </div>

      <div style={{
        background: "#111118", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "20px", padding: "28px", maxWidth: "700px", width: "100%"
      }}>
        <div style={{ fontSize: "12px", fontWeight: "600", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b6b80", marginBottom: "10px" }}>
          AMAZON PRODUCT URL
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            id="urlInput"
            type="url"
            placeholder="https://www.amazon.com/dp/B08N5WRWNW"
            style={{
              flex: 1, padding: "14px 16px",
              background: "#18181f", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "10px", color: "#f0f0f5", fontSize: "15px", outline: "none"
            }}
          />
          <button
            onClick={() => alert("Amazon scraping coming soon!")}
            style={{
              padding: "14px 24px", background: "#00e5a0", color: "#001a0d",
              border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: "600",
              cursor: "pointer"
            }}
          >
            Import Product
          </button>
        </div>
      </div>
    </div>
  );
}