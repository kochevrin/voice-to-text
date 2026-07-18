// whispr-open license server — a single-file Cloudflare Worker.
//
//   GET /check?key=<license-key>  ->  {"active": bool, "expires": "YYYY-MM-DD" | null}
//
// Keys live in the LICENSES KV namespace (see wrangler.toml): the KV key is the
// license key, the KV value is its expiry date as "YYYY-MM-DD". A key is active
// while today (UTC) <= expiry. Unknown keys answer 200 {active:false, expires:null}
// so the app can tell "revoked/unknown" apart from "server unreachable".
// Anything other than GET /check is a 404.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/check") {
      return json({ error: "not found" }, 404);
    }
    const key = url.searchParams.get("key");
    const expires = key ? await env.LICENSES.get(key) : null;
    if (!expires) {
      return json({ active: false, expires: null });
    }
    const today = new Date().toISOString().slice(0, 10); // UTC "YYYY-MM-DD"
    return json({ active: today <= expires, expires });
  },
};
