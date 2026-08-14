// GET /api/notion?query=roadmap   (searches pages/databases in the connected workspace)
// Header required: Authorization: Bearer <supabase access token>
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "notion");
    user = result.user;
    const token = result.token.access_token;

    if (!token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Notion isn't connected yet — hit Connect in Integrations." }) };
    }

    const query = event.queryStringParameters?.query || "";
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: JSON.stringify({ query, page_size: 10 })
    });
    const data = await res.json();

    await logSync(user.id, "notion", res.ok ? "success" : "error", res.ok ? null : (data.message || "error"));
    if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.message || "Notion API error" }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    if (user) await logSync(user.id, "notion", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
