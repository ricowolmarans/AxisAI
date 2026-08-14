// GitHub OAuth App tokens don't expire and have no refresh flow — the
// access_token saved at connect time is used directly, forever (until the
// user revokes it in GitHub → Settings → Applications). This file exists
// only so callers have one consistent shape to import, matching
// google.js/microsoft.js/canva.js.
async function getGithubAccessToken(tokens) {
  const t = tokens.github;
  if (!t?.access_token) throw new Error("GitHub isn't connected.");
  return t.access_token;
}

module.exports = { getGithubAccessToken };
