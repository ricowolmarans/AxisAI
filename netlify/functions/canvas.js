// GET /api/canvas?resource=users/self
// Header required: Authorization: Bearer <supabase access token>
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "canvas");
    user = result.user;
    const { access_token, extra } = result.token;
    const canvasDomain = extra?.canvas_domain;

    if (!access_token || !canvasDomain) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Canvas isn't set up yet — add your domain and token in Integrations." }) };
    }

    const resource = event.queryStringParameters?.resource || "users/self";
    const res = await fetch(`https://${canvasDomain}/api/v1/${resource}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const data = await res.json();

    await logSync(user.id, "canvas", res.ok ? "success" : "error", res.ok ? null : (data.errors?.[0]?.message || `HTTP ${res.status}`));
    return { statusCode: res.status, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    if (user) await logSync(user.id, "canvas", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
