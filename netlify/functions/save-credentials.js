// POST /api/save-credentials  { service: "canvas"|"slack", ...fields }
// Header required: Authorization: Bearer <supabase access token>
//
// The browser never writes directly to integration_tokens (it has no RLS
// policy — see schema.sql). This is the only path secrets take into that
// table, and it always goes through a verified session first.
const { verifyUser, saveServiceToken, upsertConnectedAccount, CORS } = require("./lib/supabaseAdmin");

const SCHEMAS = {
  canvas: { access_token: "canvas_token", extra: (b) => ({ canvas_domain: b.canvas_domain || "" }), label: (b) => b.canvas_domain },
  slack:  { access_token: "slack_user_token", extra: () => ({}), label: () => "Slack workspace" }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { service } = body;
  const schema = SCHEMAS[service];
  if (!schema) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Unknown service." }) };

  try {
    const user = await verifyUser(event.headers.authorization);
    const tokenValue = body[schema.access_token === "canvas_token" ? "canvas_token" : "slack_user_token"];
    if (!tokenValue) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing token/credential." }) };

    await saveServiceToken(user.id, service, { access_token: tokenValue, extra: schema.extra(body) });
    await upsertConnectedAccount(user.id, service, {
      status: "connected",
      account_label: schema.label(body) || null,
      connected_at: new Date().toISOString()
    });

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
