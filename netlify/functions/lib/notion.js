// Notion's OAuth integration tokens don't expire either — no refresh flow,
// same reasoning as github.js. Kept as its own file for a consistent import
// shape and in case Notion ever adds token expiry (they haven't so far).
async function getNotionAccessToken(tokens) {
  const t = tokens.notion;
  if (!t?.access_token) throw new Error("Notion isn't connected.");
  return t.access_token;
}

module.exports = { getNotionAccessToken };
