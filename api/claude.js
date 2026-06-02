export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych Vercel" });
  }

  try {
    const body = req.body;

    // Only add web-search beta when tools include web_search
    const usesWebSearch = Array.isArray(body.tools) &&
      body.tools.some(t => t.type === "web_search_20250305" || t.name === "web_search");

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (usesWebSearch) {
      headers["anthropic-beta"] = "web-search-2025-03-05";
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      // Return full Anthropic error so we can see it in the browser
      console.error("Anthropic error:", response.status, JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || "Anthropic API error",
        anthropic_type: data?.error?.type,
        status: response.status,
        full: data,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy exception:", err);
    return res.status(500).json({ error: err.message });
  }
}
