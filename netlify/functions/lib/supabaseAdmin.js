const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

// Verifies the caller's Supabase access token and returns the user.
async function verifyUser(authHeader) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Not logged in — missing session token.");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error("Invalid or expired session — please log in again.");
  return user;
}

// Reads a single service's stored token row. integration_tokens has no RLS
// policy at all (see schema.sql) — only reachable via this service_role client.
async function getServiceToken(authHeader, service) {
  const user = await verifyUser(authHeader);
  const { data, error } = await supabaseAdmin
    .from("integration_tokens")
    .select("*")
    .eq("user_id", user.id)
    .eq("service", service)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { user, token: data || {} };
}

// Upserts a token row (secrets) — service_role only, never called from the browser.
async function saveServiceToken(userId, service, fields) {
  const { error } = await supabaseAdmin
    .from("integration_tokens")
    .upsert({ user_id: userId, service, updated_at: new Date().toISOString(), ...fields }, { onConflict: "user_id,service" });
  if (error) throw new Error(error.message);
}

// Upserts the safe-to-display status row the frontend reads directly.
async function upsertConnectedAccount(userId, service, fields) {
  const { error } = await supabaseAdmin
    .from("connected_accounts")
    .upsert({ user_id: userId, service, ...fields }, { onConflict: "user_id,service" });
  if (error) throw new Error(error.message);
}

// Records a sync attempt and updates the account's last_sync fields together.
async function logSync(userId, service, status, message) {
  await supabaseAdmin.from("integration_sync_logs").insert({ user_id: userId, service, status, message });
  await supabaseAdmin
    .from("connected_accounts")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status })
    .eq("user_id", userId)
    .eq("service", service);
}

module.exports = { supabaseAdmin, verifyUser, getServiceToken, saveServiceToken, upsertConnectedAccount, logSync, CORS };
