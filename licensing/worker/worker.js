// whispr-open license server — a single-file Cloudflare Worker.
//
//   GET /check?key=<license-key>&device=<device-id>
//     -> {"active": bool, "expires": "YYYY-MM-DD" | null, "reason"?: "device_limit"}
//
// Keys live in the LICENSES KV namespace (see wrangler.toml): the KV key is
// the license key, the KV value is either a legacy bare expiry date
// ("YYYY-MM-DD") or a JSON record
//   {expires, tier: "standard"|"premium", note, activated: "YYYY-MM-DD"|null,
//    devices: [{id, first_seen, last_seen}]}
// /check upgrades legacy values in place the first time it writes. A key is
// active while today (UTC) <= expires. Unknown keys answer 200
// {active:false, expires:null} so the app can tell "revoked/unknown" apart
// from "server unreachable".
//
// Device limit: at most DEVICE_LIMIT devices per key. `last_seen` has day
// granularity, so a device causes at most ~1 KV write per day; devices unseen
// for DEVICE_EXPIRY_DAYS free their slot. KV has no transactions — two brand
// new devices racing can momentarily exceed the limit (last write wins, the
// lost device simply re-registers on its next hourly check). Devices are only
// tracked while the key is active; `activated` is stamped on first sight of
// the key either way (the admin panel's "Used" column).
//
// Admin panel (needs the ADMIN_TOKEN wrangler secret; 503 while it is unset):
//   GET    /admin                         -> HTML panel (token entered in the page)
//   GET    /admin/api/keys                -> {"keys":[{key, expires, tier, note,
//                                             activated, devices:[...]}, ...]}
//   PUT    /admin/api/keys/<key>          -> body {"expires":"YYYY-MM-DD",
//                                             "note"?: string, "tier"?: string}
//                                            (activated/devices are preserved)
//   DELETE /admin/api/keys/<key>          -> {"ok":true}
//   DELETE /admin/api/keys/<key>/devices  -> {"ok":true} (frees all device slots)
// Every /admin/api/* call requires "Authorization: Bearer <ADMIN_TOKEN>".
// Anything else is a 404.

const DEVICE_LIMIT = 3;
const DEVICE_EXPIRY_DAYS = 30;
const NOTE_MAX_CHARS = 500;
const TIERS = ["standard", "premium"];

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

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function emptyRecord() {
  return { expires: null, tier: "standard", note: "", activated: null, devices: [] };
}

/** Parses a KV value (legacy bare date or JSON record) into the record shape;
 * null for missing/garbage values. */
function parseRecord(raw) {
  if (!raw) return null;
  if (raw[0] !== "{") {
    return { ...emptyRecord(), expires: raw };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = emptyRecord();
  if (typeof parsed.expires === "string") record.expires = parsed.expires;
  if (TIERS.includes(parsed.tier)) record.tier = parsed.tier;
  if (typeof parsed.note === "string") record.note = parsed.note.slice(0, NOTE_MAX_CHARS);
  if (typeof parsed.activated === "string") record.activated = parsed.activated;
  if (Array.isArray(parsed.devices)) {
    record.devices = parsed.devices.filter(
      (d) => d && typeof d.id === "string" && typeof d.last_seen === "string",
    );
  }
  return record;
}

/** Device ids come from the app (random 32-hex tokens); refuse anything that
 * could bloat the record or break the panel. */
function sanitizeDeviceId(raw) {
  return raw && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
}

/** Drops devices unseen for DEVICE_EXPIRY_DAYS so old machines free slots. */
function pruneDevices(devices, today) {
  const cutoff = Date.parse(today) - DEVICE_EXPIRY_DAYS * 86400000;
  return devices.filter((d) => Date.parse(d.last_seen) >= cutoff);
}

async function handleCheck(env, url) {
  const key = url.searchParams.get("key");
  const record = key ? parseRecord(await env.LICENSES.get(key)) : null;
  if (!record || !record.expires) {
    return json({ active: false, expires: null });
  }
  const today = todayUTC();
  const active = today <= record.expires;
  let dirty = false;
  if (!record.activated) {
    record.activated = today;
    dirty = true;
  }
  let limited = false;
  const device = sanitizeDeviceId(url.searchParams.get("device"));
  if (active && device) {
    const kept = pruneDevices(record.devices, today);
    if (kept.length !== record.devices.length) {
      record.devices = kept;
      dirty = true;
    }
    const seen = record.devices.find((d) => d.id === device);
    if (seen) {
      if (seen.last_seen !== today) {
        seen.last_seen = today;
        dirty = true;
      }
    } else if (record.devices.length < DEVICE_LIMIT) {
      record.devices.push({ id: device, first_seen: today, last_seen: today });
      dirty = true;
    } else {
      limited = true;
    }
  }
  if (dirty) {
    await env.LICENSES.put(key, JSON.stringify(record));
  }
  if (limited) {
    return json({ active: false, expires: record.expires, reason: "device_limit" });
  }
  return json({ active, expires: record.expires });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/check") {
      return handleCheck(env, url);
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

function validKey(key) {
  return key && key.length <= 128 && !/\s/.test(key);
}

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
      names.map(async (key) => ({
        key,
        ...(parseRecord(await env.LICENSES.get(key)) ?? emptyRecord()),
      })),
    );
    return json({ keys });
  }
  const prefix = "/admin/api/keys/";
  if (!url.pathname.startsWith(prefix)) {
    return json({ error: "not found" }, 404);
  }
  const rest = url.pathname.slice(prefix.length);

  // DELETE .../<key>/devices — free every device slot on the key.
  if (request.method === "DELETE" && rest.endsWith("/devices")) {
    let key;
    try {
      key = decodeURIComponent(rest.slice(0, -"/devices".length));
    } catch {
      return json({ error: "invalid key" }, 400);
    }
    if (!validKey(key)) {
      return json({ error: "invalid key" }, 400);
    }
    const record = parseRecord(await env.LICENSES.get(key));
    if (!record) {
      return json({ error: "not found" }, 404);
    }
    record.devices = [];
    await env.LICENSES.put(key, JSON.stringify(record));
    return json({ ok: true });
  }

  let key;
  try {
    key = decodeURIComponent(rest);
  } catch {
    return json({ error: "invalid key" }, 400);
  }
  if (!validKey(key)) {
    return json({ error: "invalid key" }, 400);
  }
  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const expires = body.expires;
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
    if (body.note !== undefined && typeof body.note !== "string") {
      return json({ error: "invalid note" }, 400);
    }
    if (body.tier !== undefined && !TIERS.includes(body.tier)) {
      return json({ error: "invalid tier" }, 400);
    }
    // Merge into the existing record so activated/devices survive edits.
    const record = parseRecord(await env.LICENSES.get(key)) ?? emptyRecord();
    record.expires = expires;
    if (typeof body.note === "string") record.note = body.note.slice(0, NOTE_MAX_CHARS);
    if (body.tier !== undefined) record.tier = body.tier;
    await env.LICENSES.put(key, JSON.stringify(record));
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await env.LICENSES.delete(key);
    return json({ ok: true });
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
  table { border-collapse: collapse; margin-top: 1rem; width: 100%; max-width: 78rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #2a2a2a;
           vertical-align: middle; }
  th { color: #888; font-weight: 500; }
  td.key { font-family: ui-monospace, monospace; white-space: nowrap; }
  td.used { color: #888; white-space: nowrap; }
  td.devices { white-space: nowrap; }
  td.devices button { padding: .1rem .45rem; font-size: .8rem; margin-left: .35rem; }
  input.note { width: 100%; min-width: 10rem; box-sizing: border-box; }
  .pill { padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; }
  .pill.ok { background: #143d21; color: #6fd68b; }
  .pill.bad { background: #46181c; color: #f08a8f; }
  #msg { color: #f08a8f; }
  #bar, #newbar { display: flex; gap: .5rem; align-items: center; }
  #newbar { margin-top: 1rem; flex-wrap: wrap; }
</style>
<h1>whispr-open — licenses</h1>
<div id="bar">
  <input id="token" type="password" placeholder="admin token" size="30">
  <button id="signin">Sign in</button><span id="msg"></span>
</div>
<div id="panel" hidden>
  <table>
    <thead><tr><th>Key</th><th>Expires</th><th>Status</th><th>Used</th>
      <th>Devices</th><th>Note</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="newbar">
    <input id="newkey" placeholder="new key" size="24">
    <button id="gen">Generate</button>
    <input id="newdate" type="date">
    <input id="newnote" placeholder="note (optional)" size="24">
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
      var devices = k.devices || [];
      var deviceTitle = devices.map(function (d) {
        return d.id + " (seen " + d.last_seen + ")";
      }).join("\\n");
      return '<tr data-key="' + esc(k.key) + '"><td class="key">' + esc(k.key) + '</td>' +
        '<td><input type="date" value="' + esc(k.expires || "") + '"></td>' +
        '<td><span class="pill ' + (ok ? "ok" : "bad") + '">' + (ok ? "Active" : "Expired") + '</span></td>' +
        '<td class="used">' + esc(k.activated || "—") + '</td>' +
        '<td class="devices" title="' + esc(deviceTitle) + '">' + devices.length + "/" + 3 +
          (devices.length ? ' <button class="reset">Reset</button>' : "") + '</td>' +
        '<td><input class="note" value="' + esc(k.note || "") + '"></td>' +
        '<td><button class="save">Save</button> <button class="del">Delete</button></td></tr>';
    }).join("");
    $("rows").querySelectorAll("tr").forEach(function (tr) {
      var key = tr.dataset.key, path = "/" + encodeURIComponent(key);
      tr.querySelector(".save").onclick = function () {
        api("PUT", path, {
          expires: tr.querySelector('input[type="date"]').value,
          note: tr.querySelector("input.note").value,
        }).then(load);
      };
      var reset = tr.querySelector(".reset");
      if (reset) {
        reset.onclick = function () {
          if (confirm("Free all device slots for " + key + "?"))
            api("DELETE", path + "/devices").then(load);
        };
      }
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
    api("PUT", "/" + encodeURIComponent(key), {
      expires: $("newdate").value,
      note: $("newnote").value,
    }).then(function () { $("newkey").value = ""; $("newnote").value = ""; load(); });
  };
  var d = new Date();
  d.setMonth(d.getMonth() + 1); // default expiry: one month from today
  $("newdate").value = d.toISOString().slice(0, 10);
  if (localStorage.getItem("token")) load();
</script>
`;
