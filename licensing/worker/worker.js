// whispr-open license server — a single-file Cloudflare Worker.
//
//   GET /check?key=<license-key>  ->  {"active": bool, "expires": "YYYY-MM-DD" | null}
//
// Keys live in the LICENSES KV namespace (see wrangler.toml): the KV key is the
// license key, the KV value is its expiry date as "YYYY-MM-DD". A key is active
// while today (UTC) <= expiry. Unknown keys answer 200 {active:false, expires:null}
// so the app can tell "revoked/unknown" apart from "server unreachable".
//
// Admin panel (needs the ADMIN_TOKEN wrangler secret; 503 while it is unset):
//   GET    /admin                 -> HTML panel (token is entered in the page)
//   GET    /admin/api/keys        -> {"keys":[{"key":"...","expires":"YYYY-MM-DD"}...]}
//   PUT    /admin/api/keys/<key>  -> body {"expires":"YYYY-MM-DD"} -> {"ok":true}
//   DELETE /admin/api/keys/<key>  -> {"ok":true}
// Every /admin/api/* call requires "Authorization: Bearer <ADMIN_TOKEN>".
// Anything else is a 404.

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
    if (request.method === "GET" && url.pathname === "/check") {
      const key = url.searchParams.get("key");
      const expires = key ? await env.LICENSES.get(key) : null;
      if (!expires) {
        return json({ active: false, expires: null });
      }
      const today = new Date().toISOString().slice(0, 10); // UTC "YYYY-MM-DD"
      return json({ active: today <= expires, expires });
    }
    if (request.method === "GET" && url.pathname === "/admin") {
      return new Response(ADMIN_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname.startsWith("/admin/api/")) {
      return adminApi(request, env, url);
    }
    return json({ error: "not found" }, 404);
  },
};

async function adminApi(request, env, url) {
  if (!env.ADMIN_TOKEN) {
    return json({ error: "admin disabled" }, 503);
  }
  if (request.headers.get("Authorization") !== "Bearer " + env.ADMIN_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  if (request.method === "GET" && url.pathname === "/admin/api/keys") {
    const names = [];
    let cursor;
    do {
      const page = await env.LICENSES.list(cursor ? { cursor } : {});
      for (const k of page.keys) names.push(k.name);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    names.sort();
    const keys = await Promise.all(
      names.map(async (key) => ({ key, expires: await env.LICENSES.get(key) })),
    );
    return json({ keys });
  }
  const prefix = "/admin/api/keys/";
  if (url.pathname.startsWith(prefix)) {
    let key;
    try {
      key = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return json({ error: "invalid key" }, 400);
    }
    if (!key || key.length > 128 || /\s/.test(key)) {
      return json({ error: "invalid key" }, 400);
    }
    if (request.method === "PUT") {
      let expires;
      try {
        expires = (await request.json()).expires;
      } catch {
        expires = null;
      }
      if (
        typeof expires !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(expires) ||
        Number.isNaN(Date.parse(expires)) ||
        // Date.parse overflows out-of-range days ("2026-02-30" -> Mar 2);
        // require the parsed date to roundtrip to the same string.
        new Date(expires).toISOString().slice(0, 10) !== expires
      ) {
        return json({ error: "invalid date" }, 400);
      }
      await env.LICENSES.put(key, expires);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await env.LICENSES.delete(key);
      return json({ ok: true });
    }
  }
  return json({ error: "not found" }, 404);
}

const ADMIN_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>whispr-open — licenses</title>
<style>
  body { margin: 0; padding: 2rem; background: #121212; color: #ddd;
         font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 1.2rem; margin: 0 0 1rem; }
  input, button { font: inherit; color: inherit; background: #1e1e1e;
                  border: 1px solid #333; border-radius: 4px; padding: .35rem .6rem; }
  button { cursor: pointer; }
  button:hover { background: #2a2a2a; }
  table { border-collapse: collapse; margin-top: 1rem; width: 100%; max-width: 46rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #2a2a2a; }
  th { color: #888; font-weight: 500; }
  td.key { font-family: ui-monospace, monospace; }
  .pill { padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; }
  .pill.ok { background: #143d21; color: #6fd68b; }
  .pill.bad { background: #46181c; color: #f08a8f; }
  #msg { color: #f08a8f; }
  #bar, #newbar { display: flex; gap: .5rem; align-items: center; }
  #newbar { margin-top: 1rem; }
</style>
<h1>whispr-open — licenses</h1>
<div id="bar">
  <input id="token" type="password" placeholder="admin token" size="30">
  <button id="signin">Sign in</button><span id="msg"></span>
</div>
<div id="panel" hidden>
  <table>
    <thead><tr><th>Key</th><th>Expires</th><th>Status</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="newbar">
    <input id="newkey" placeholder="new key" size="24">
    <button id="gen">Generate</button>
    <input id="newdate" type="date">
    <button id="add">Add</button>
  </div>
</div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function msg(t) { $("msg").textContent = t; }
  async function api(method, path, body) {
    var opts = { method: method,
                 headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    var res = await fetch("/admin/api/keys" + path, opts);
    if (res.status === 401) {
      localStorage.removeItem("token");
      $("panel").hidden = true;
      msg("wrong token");
      throw new Error("unauthorized");
    }
    if (res.status === 503) { msg("admin disabled — set the ADMIN_TOKEN secret"); throw new Error("503"); }
    if (!res.ok) { msg("error " + res.status); throw new Error("http " + res.status); }
    return res.json();
  }
  async function load() {
    var data = await api("GET", "");
    var today = new Date().toISOString().slice(0, 10);
    $("rows").innerHTML = data.keys.map(function (k) {
      var ok = today <= (k.expires || "");
      return '<tr data-key="' + esc(k.key) + '"><td class="key">' + esc(k.key) + '</td>' +
        '<td><input type="date" value="' + esc(k.expires || "") + '"></td>' +
        '<td><span class="pill ' + (ok ? "ok" : "bad") + '">' + (ok ? "Active" : "Expired") + '</span></td>' +
        '<td><button class="save">Save</button> <button class="del">Delete</button></td></tr>';
    }).join("");
    $("rows").querySelectorAll("tr").forEach(function (tr) {
      var key = tr.dataset.key, path = "/" + encodeURIComponent(key);
      tr.querySelector(".save").onclick = function () {
        api("PUT", path, { expires: tr.querySelector("input").value }).then(load);
      };
      tr.querySelector(".del").onclick = function () {
        if (confirm("Delete " + key + "?")) api("DELETE", path).then(load);
      };
    });
    $("panel").hidden = false;
    msg("");
  }
  $("signin").onclick = function () {
    localStorage.setItem("token", $("token").value.trim());
    load();
  };
  $("gen").onclick = function () {
    var chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // A-Z0-9 minus lookalikes I L O 0 1
    var buf = new Uint8Array(12), s = "KK";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 12; i++) s += (i % 4 ? "" : "-") + chars[buf[i] % chars.length];
    $("newkey").value = s;
  };
  $("add").onclick = function () {
    var key = $("newkey").value.trim();
    if (!key) { msg("key is empty"); return; }
    api("PUT", "/" + encodeURIComponent(key), { expires: $("newdate").value })
      .then(function () { $("newkey").value = ""; load(); });
  };
  var d = new Date();
  d.setMonth(d.getMonth() + 1); // default expiry: one month from today
  $("newdate").value = d.toISOString().slice(0, 10);
  if (localStorage.getItem("token")) load();
</script>
`;
