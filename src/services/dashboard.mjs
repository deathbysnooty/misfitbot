import http from "node:http";

function sendJson(res, code, payload) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, code, text, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "content-type": type });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function toUnixNow() {
  return Math.floor(Date.now() / 1000);
}

function parsePositiveInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function intervalToSeconds(every, unit = "minutes") {
  const unitMap = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
  };
  const mult = unitMap[String(unit || "").toLowerCase()] || 60;
  return Math.max(1, Math.floor(Number(every) || 1)) * mult;
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MisfitBot Dashboard</title>
  <style>
    :root {
      --bg: #060717;
      --panel: #111533;
      --panel2: #0b0f28;
      --ink: #ebf0ff;
      --muted: #9ca4d6;
      --line: #2a3574;
      --cyan: #4ee8ff;
      --pink: #ff4fcb;
      --green: #55e39f;
      --warn: #ffcc66;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", system-ui, sans-serif;
      background: radial-gradient(1200px 700px at 20% -10%, #202a7a, transparent), var(--bg);
      color: var(--ink);
    }
    .wrap { max-width: 1200px; margin: 24px auto; padding: 0 14px; }
    .card {
      background: linear-gradient(180deg, var(--panel), var(--panel2));
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 14px;
    }
    h1,h2,h3 { margin: 0 0 10px; }
    h1 { font-size: 1.3rem; }
    h2 { font-size: 1.05rem; color: var(--cyan); }
    .muted { color: var(--muted); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input, select, button, textarea {
      background: #090d22;
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      font: inherit;
    }
    textarea { min-height: 90px; width: 100%; }
    button {
      cursor: pointer;
      background: linear-gradient(90deg, #2848f5, #d036de);
      border: 0;
      font-weight: 700;
    }
    button.subtle { background: #1a214d; border: 1px solid var(--line); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.93rem;
    }
    .table th, .table td {
      border-bottom: 1px solid #233064;
      padding: 8px 6px;
      vertical-align: top;
      text-align: left;
    }
    .ok { color: var(--green); }
    .warn { color: var(--warn); }
    .pill {
      display: inline-block;
      border: 1px solid #2f3c7e;
      border-radius: 999px;
      padding: 2px 9px;
      font-size: .78rem;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>MisfitBot Admin Dashboard</h1>
      <p class="muted">Token-protected control panel for core bot automations.</p>
      <div class="row">
        <input id="token" type="password" placeholder="Dashboard token (from DASHBOARD_TOKEN)" style="min-width:320px" />
        <button id="connectBtn">Connect</button>
        <span id="status" class="muted">Not connected</span>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <label>Guild</label>
        <select id="guildSelect"></select>
        <span id="modeNow" class="pill">mode: ?</span>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Set mode</label>
        <select id="modeSelect">
          <option value="sassy">sassy</option>
          <option value="chill">chill</option>
          <option value="serious">serious</option>
          <option value="hype">hype</option>
          <option value="rude">rude</option>
          <option value="ultraroast">ultraroast</option>
        </select>
        <button id="modeBtn">Update Mode</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Schedules</h2>
        <div class="row">
          <button class="subtle" id="refreshSchedules">Refresh</button>
        </div>
        <div id="schedulesBox" class="muted" style="margin-top:10px">No data yet.</div>
      </div>

      <div class="card">
        <h2>Auto Purge</h2>
        <div class="row">
          <input id="apChannel" placeholder="Channel ID" />
          <input id="apEvery" type="number" min="1" value="5" style="width:90px" />
          <select id="apUnit"><option>minutes</option><option>seconds</option><option>hours</option><option>days</option></select>
          <select id="apMode"><option>all</option><option>media</option><option>nonadmin</option></select>
          <input id="apScan" type="number" min="1" max="1000" value="200" style="width:90px" />
          <button id="apSetBtn">Set</button>
        </div>
        <div id="apList" class="muted" style="margin-top:10px">No data yet.</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Per-Message TTL</h2>
        <div class="row">
          <input id="ttlChannel" placeholder="Channel ID" />
          <input id="ttlEvery" type="number" min="1" value="5" style="width:90px" />
          <select id="ttlUnit"><option>minutes</option><option>seconds</option><option>hours</option><option>days</option></select>
          <button id="ttlSetBtn">Set</button>
        </div>
        <div id="ttlList" class="muted" style="margin-top:10px">No data yet.</div>
      </div>

      <div class="card">
        <h2>NSFW Guard</h2>
        <div class="row">
          <input id="guardChannel" placeholder="Channel ID" />
          <button id="guardSetBtn">Enable</button>
        </div>
        <div id="guardList" class="muted" style="margin-top:10px">No data yet.</div>
      </div>
    </div>

    <div class="card">
      <h2>Presets</h2>
      <div class="row">
        <input id="presetTitle" placeholder="Title" />
      </div>
      <div style="margin-top:8px">
        <textarea id="presetContent" placeholder="Preset message content"></textarea>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="presetSaveBtn">Save Preset</button>
        <button class="subtle" id="presetRefreshBtn">Refresh Presets</button>
      </div>
      <div id="presetList" class="muted" style="margin-top:10px">No data yet.</div>
    </div>
  </div>

  <script>
    let token = "";
    let guildId = "";
    const $ = (id) => document.getElementById(id);

    function fmt(ts) {
      if (!ts) return "-";
      try { return new Date(ts * 1000).toLocaleString(); } catch { return String(ts); }
    }
    function esc(s) {
      return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
    }

    async function api(path, options = {}) {
      const res = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-dashboard-token": token,
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      return data;
    }

    async function boot() {
      token = $("token").value.trim();
      if (!token) return;
      localStorage.setItem("misfit_dashboard_token", token);
      $("status").textContent = "Connecting...";
      const st = await api("/dashboard/api/status");
      $("modeNow").textContent = "mode: " + st.mode;
      const guilds = st.guilds || [];
      $("guildSelect").innerHTML = guilds.map(g => '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>").join("");
      guildId = $("guildSelect").value || "";
      $("status").innerHTML = '<span class="ok">Connected</span>';
      await refreshAll();
    }

    async function refreshSchedules() {
      if (!guildId) return;
      const d = await api("/dashboard/api/schedules?guildId=" + encodeURIComponent(guildId));
      const rows = d.items || [];
      if (!rows.length) return $("schedulesBox").textContent = "No schedules.";
      $("schedulesBox").innerHTML = '<table class="table"><thead><tr><th>ID</th><th>Channel</th><th>When</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>#' + r.id + '</td><td>' + esc(r.channel_id) + '</td><td>' + esc(fmt(r.send_at)) + '</td><td>' + esc(r.payload_type || "text") + '</td><td>' + (r.active ? "active" : "paused") + '</td><td>' +
          '<button class="subtle" onclick="actSchedule(' + r.id + ',\\'pause\\')">Pause</button> ' +
          '<button class="subtle" onclick="actSchedule(' + r.id + ',\\'resume\\')">Resume</button> ' +
          '<button class="subtle" onclick="actSchedule(' + r.id + ',\\'delete\\')">Delete</button>' +
        '</td></tr>').join("") + "</tbody></table>";
    }

    async function refreshAutopurge() {
      if (!guildId) return;
      const d = await api("/dashboard/api/autopurge?guildId=" + encodeURIComponent(guildId));
      const rows = d.items || [];
      if (!rows.length) return $("apList").textContent = "No auto-purge rules.";
      $("apList").innerHTML = '<table class="table"><thead><tr><th>ID</th><th>Channel</th><th>Mode</th><th>Every</th><th>Next</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>#' + r.id + '</td><td>' + esc(r.channel_id) + '</td><td>' + esc(r.mode) + '</td><td>' + esc(r.interval_seconds + "s") + '</td><td>' + esc(fmt(r.next_run_at)) + '</td><td><button class="subtle" onclick="delAutopurge(' + r.id + ')">Remove</button></td></tr>').join("") +
        "</tbody></table>";
    }

    async function refreshTtl() {
      if (!guildId) return;
      const d = await api("/dashboard/api/msgttl?guildId=" + encodeURIComponent(guildId));
      const rows = d.items || [];
      if (!rows.length) return $("ttlList").textContent = "No per-message TTL rules.";
      $("ttlList").innerHTML = '<table class="table"><thead><tr><th>ID</th><th>Channel</th><th>TTL</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>#' + r.id + '</td><td>' + esc(r.channel_id) + '</td><td>' + esc(r.ttl_seconds + "s") + '</td><td><button class="subtle" onclick="delTtl(' + r.id + ')">Remove</button></td></tr>').join("") +
        "</tbody></table>";
    }

    async function refreshGuard() {
      if (!guildId) return;
      const d = await api("/dashboard/api/nsfwguard?guildId=" + encodeURIComponent(guildId));
      const rows = d.items || [];
      if (!rows.length) return $("guardList").textContent = "No guarded channels.";
      $("guardList").innerHTML = '<table class="table"><thead><tr><th>ID</th><th>Channel</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>#' + r.id + '</td><td>' + esc(r.channel_id) + '</td><td><button class="subtle" onclick="delGuard(' + r.id + ')">Remove</button></td></tr>').join("") +
        "</tbody></table>";
    }

    async function refreshPresets() {
      if (!guildId) return;
      const d = await api("/dashboard/api/presets?guildId=" + encodeURIComponent(guildId));
      const rows = d.items || [];
      if (!rows.length) return $("presetList").textContent = "No presets.";
      $("presetList").innerHTML = '<table class="table"><thead><tr><th>Title</th><th>Updated</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>' + esc(r.title) + '</td><td>' + esc(fmt(r.updated_at)) + '</td><td><button class="subtle" onclick="delPreset(\\'' + esc(r.title_key) + '\\')">Remove</button></td></tr>').join("") +
        "</tbody></table>";
    }

    async function refreshAll() {
      await Promise.all([refreshSchedules(), refreshAutopurge(), refreshTtl(), refreshGuard(), refreshPresets()]);
    }

    window.actSchedule = async (id, action) => {
      await api("/dashboard/api/schedules/" + id + "/" + action + "?guildId=" + encodeURIComponent(guildId), { method: "POST" });
      await refreshSchedules();
    };
    window.delAutopurge = async (id) => {
      await api("/dashboard/api/autopurge/" + id + "?guildId=" + encodeURIComponent(guildId), { method: "DELETE" });
      await refreshAutopurge();
    };
    window.delTtl = async (id) => {
      await api("/dashboard/api/msgttl/" + id + "?guildId=" + encodeURIComponent(guildId), { method: "DELETE" });
      await refreshTtl();
    };
    window.delGuard = async (id) => {
      await api("/dashboard/api/nsfwguard/" + id + "?guildId=" + encodeURIComponent(guildId), { method: "DELETE" });
      await refreshGuard();
    };
    window.delPreset = async (titleKey) => {
      await api("/dashboard/api/presets/" + encodeURIComponent(titleKey) + "?guildId=" + encodeURIComponent(guildId), { method: "DELETE" });
      await refreshPresets();
    };

    $("connectBtn").addEventListener("click", async () => {
      try { await boot(); } catch (e) { $("status").textContent = "Failed: " + e.message; }
    });
    $("guildSelect").addEventListener("change", async (e) => {
      guildId = e.target.value;
      await refreshAll();
    });
    $("modeBtn").addEventListener("click", async () => {
      await api("/dashboard/api/mode", { method: "POST", body: JSON.stringify({ mode: $("modeSelect").value }) });
      const d = await api("/dashboard/api/status");
      $("modeNow").textContent = "mode: " + d.mode;
    });
    $("refreshSchedules").addEventListener("click", refreshSchedules);
    $("apSetBtn").addEventListener("click", async () => {
      await api("/dashboard/api/autopurge", {
        method: "POST",
        body: JSON.stringify({
          guildId,
          channelId: $("apChannel").value.trim(),
          every: Number($("apEvery").value || 5),
          unit: $("apUnit").value,
          mode: $("apMode").value,
          scanLimit: Number($("apScan").value || 200),
        }),
      });
      await refreshAutopurge();
    });
    $("ttlSetBtn").addEventListener("click", async () => {
      await api("/dashboard/api/msgttl", {
        method: "POST",
        body: JSON.stringify({
          guildId,
          channelId: $("ttlChannel").value.trim(),
          every: Number($("ttlEvery").value || 5),
          unit: $("ttlUnit").value,
        }),
      });
      await refreshTtl();
    });
    $("guardSetBtn").addEventListener("click", async () => {
      await api("/dashboard/api/nsfwguard", {
        method: "POST",
        body: JSON.stringify({ guildId, channelId: $("guardChannel").value.trim() }),
      });
      await refreshGuard();
    });
    $("presetSaveBtn").addEventListener("click", async () => {
      await api("/dashboard/api/presets", {
        method: "POST",
        body: JSON.stringify({
          guildId,
          title: $("presetTitle").value.trim(),
          content: $("presetContent").value.trim(),
        }),
      });
      await refreshPresets();
    });
    $("presetRefreshBtn").addEventListener("click", refreshPresets);

    const remembered = localStorage.getItem("misfit_dashboard_token") || "";
    if (remembered) $("token").value = remembered;
  </script>
</body>
</html>`;

export function createDashboardService({
  db,
  client,
  getBotMode,
  setBotMode,
  ownerId,
  clampPurgeScanLimit,
}) {
  let server = null;

  function isAuthed(req, token) {
    if (!token) return false;
    const header = String(req.headers["x-dashboard-token"] || "").trim();
    return header && header === token;
  }

  function requireGuildId(urlObj, res) {
    const guildId = String(urlObj.searchParams.get("guildId") || "").trim();
    if (!guildId) {
      sendJson(res, 400, { error: "guildId is required." });
      return null;
    }
    return guildId;
  }

  async function handleApi(req, res, urlObj) {
    const token = String(process.env.DASHBOARD_TOKEN || "").trim();
    if (!isAuthed(req, token)) return sendJson(res, 401, { error: "Unauthorized." });

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/status") {
      const guilds = [...client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name }));
      return sendJson(res, 200, {
        ok: true,
        mode: getBotMode(),
        guilds,
      });
    }

    if (req.method === "POST" && urlObj.pathname === "/dashboard/api/mode") {
      const body = await readJsonBody(req);
      const mode = String(body.mode || "").toLowerCase();
      const allowed = new Set(["sassy", "chill", "serious", "hype", "rude", "ultraroast"]);
      if (!allowed.has(mode)) return sendJson(res, 400, { error: "Invalid mode." });
      setBotMode(mode);
      return sendJson(res, 200, { ok: true, mode });
    }

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/schedules") {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const items = db
        .prepare(
          `SELECT id, channel_id, send_at, interval_minutes, payload_type, active, updated_at
           FROM scheduled_messages
           WHERE guild_id = ?
           ORDER BY id DESC
           LIMIT 100`
        )
        .all(guildId);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === "POST" && /^\/dashboard\/api\/schedules\/\d+\/(pause|resume|delete)$/.test(urlObj.pathname)) {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const m = urlObj.pathname.match(/^\/dashboard\/api\/schedules\/(\d+)\/(pause|resume|delete)$/);
      const id = Number(m[1]);
      const action = m[2];
      if (action === "pause") {
        db.prepare(`UPDATE scheduled_messages SET active = 0, updated_at = strftime('%s','now') WHERE id = ? AND guild_id = ?`).run(id, guildId);
      } else if (action === "resume") {
        db.prepare(`UPDATE scheduled_messages SET active = 1, updated_at = strftime('%s','now') WHERE id = ? AND guild_id = ?`).run(id, guildId);
      } else {
        db.prepare(`DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?`).run(id, guildId);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/autopurge") {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const items = db
        .prepare(
          `SELECT id, channel_id, mode, interval_seconds, scan_limit, next_run_at, active
           FROM auto_purge_rules
           WHERE guild_id = ?
           ORDER BY id DESC
           LIMIT 100`
        )
        .all(guildId);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === "POST" && urlObj.pathname === "/dashboard/api/autopurge") {
      const body = await readJsonBody(req);
      const guildId = String(body.guildId || "").trim();
      const channelId = String(body.channelId || "").trim();
      const mode = String(body.mode || "all").toLowerCase();
      const scanLimit = clampPurgeScanLimit(parsePositiveInt(body.scanLimit, 200));
      if (!guildId || !channelId) return sendJson(res, 400, { error: "guildId and channelId are required." });
      if (!["all", "media", "nonadmin"].includes(mode)) return sendJson(res, 400, { error: "Invalid mode." });
      const intervalSeconds = intervalToSeconds(body.every || 5, body.unit || "minutes");
      db.prepare(`
        INSERT INTO auto_purge_rules (
          guild_id, channel_id, mode, interval_minutes, interval_seconds, scan_limit, next_run_at, active, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, strftime('%s','now'), strftime('%s','now'))
        ON CONFLICT(channel_id) DO UPDATE SET
          guild_id = excluded.guild_id,
          mode = excluded.mode,
          interval_minutes = excluded.interval_minutes,
          interval_seconds = excluded.interval_seconds,
          scan_limit = excluded.scan_limit,
          next_run_at = excluded.next_run_at,
          active = 1,
          updated_at = strftime('%s','now')
      `).run(
        guildId,
        channelId,
        mode,
        Math.max(1, Math.floor(intervalSeconds / 60)),
        intervalSeconds,
        scanLimit,
        toUnixNow() + intervalSeconds,
        ownerId || "dashboard"
      );
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/dashboard\/api\/autopurge\/\d+$/.test(urlObj.pathname)) {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const id = Number(urlObj.pathname.split("/").pop());
      db.prepare(`DELETE FROM auto_purge_rules WHERE id = ? AND guild_id = ?`).run(id, guildId);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/msgttl") {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const items = db
        .prepare(
          `SELECT id, channel_id, ttl_seconds, active, updated_at
           FROM message_ttl_rules
           WHERE guild_id = ?
           ORDER BY id DESC
           LIMIT 100`
        )
        .all(guildId);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === "POST" && urlObj.pathname === "/dashboard/api/msgttl") {
      const body = await readJsonBody(req);
      const guildId = String(body.guildId || "").trim();
      const channelId = String(body.channelId || "").trim();
      if (!guildId || !channelId) return sendJson(res, 400, { error: "guildId and channelId are required." });
      const ttlSeconds = intervalToSeconds(body.every || 5, body.unit || "minutes");
      if (ttlSeconds < 5 || ttlSeconds > 86400 * 30) {
        return sendJson(res, 400, { error: "TTL must be between 5 seconds and 30 days." });
      }
      db.prepare(`
        INSERT INTO message_ttl_rules (
          guild_id, channel_id, ttl_seconds, active, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, 1, ?, strftime('%s','now'), strftime('%s','now'))
        ON CONFLICT(channel_id) DO UPDATE SET
          guild_id = excluded.guild_id,
          ttl_seconds = excluded.ttl_seconds,
          active = 1,
          updated_at = strftime('%s','now')
      `).run(guildId, channelId, ttlSeconds, ownerId || "dashboard");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/dashboard\/api\/msgttl\/\d+$/.test(urlObj.pathname)) {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const id = Number(urlObj.pathname.split("/").pop());
      db.prepare(`DELETE FROM message_ttl_rules WHERE id = ? AND guild_id = ?`).run(id, guildId);
      db.prepare(
        `UPDATE message_ttl_queue
         SET active = 0, updated_at = strftime('%s','now')
         WHERE guild_id = ?
           AND channel_id NOT IN (
             SELECT channel_id FROM message_ttl_rules WHERE guild_id = ? AND active = 1
           )`
      ).run(guildId, guildId);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/nsfwguard") {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const items = db
        .prepare(
          `SELECT id, channel_id, active, updated_at
           FROM nsfw_media_guard_rules
           WHERE guild_id = ?
           ORDER BY id DESC
           LIMIT 100`
        )
        .all(guildId);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === "POST" && urlObj.pathname === "/dashboard/api/nsfwguard") {
      const body = await readJsonBody(req);
      const guildId = String(body.guildId || "").trim();
      const channelId = String(body.channelId || "").trim();
      if (!guildId || !channelId) return sendJson(res, 400, { error: "guildId and channelId are required." });
      db.prepare(`
        INSERT INTO nsfw_media_guard_rules (guild_id, channel_id, active, created_by, created_at, updated_at)
        VALUES (?, ?, 1, ?, strftime('%s','now'), strftime('%s','now'))
        ON CONFLICT(channel_id) DO UPDATE SET
          guild_id = excluded.guild_id,
          active = 1,
          updated_at = strftime('%s','now')
      `).run(guildId, channelId, ownerId || "dashboard");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/dashboard\/api\/nsfwguard\/\d+$/.test(urlObj.pathname)) {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const id = Number(urlObj.pathname.split("/").pop());
      db.prepare(`DELETE FROM nsfw_media_guard_rules WHERE id = ? AND guild_id = ?`).run(id, guildId);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && urlObj.pathname === "/dashboard/api/presets") {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const items = db
        .prepare(
          `SELECT id, title, title_key, updated_at
           FROM message_presets
           WHERE guild_id = ?
           ORDER BY updated_at DESC
           LIMIT 200`
        )
        .all(guildId);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === "POST" && urlObj.pathname === "/dashboard/api/presets") {
      const body = await readJsonBody(req);
      const guildId = String(body.guildId || "").trim();
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      if (!guildId || !title || !content) {
        return sendJson(res, 400, { error: "guildId, title and content are required." });
      }
      const titleKey = title.toLowerCase().replace(/\s+/g, " ").trim();
      db.prepare(`
        INSERT INTO message_presets (guild_id, title, title_key, content, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
        ON CONFLICT(guild_id, title_key) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          updated_at = strftime('%s','now')
      `).run(guildId, title, titleKey, content, ownerId || "dashboard");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/dashboard\/api\/presets\/.+/.test(urlObj.pathname)) {
      const guildId = requireGuildId(urlObj, res);
      if (!guildId) return;
      const titleKey = decodeURIComponent(urlObj.pathname.split("/").pop() || "").trim();
      db.prepare(`DELETE FROM message_presets WHERE guild_id = ? AND title_key = ?`).run(guildId, titleKey);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found." });
  }

  function start() {
    const enabled = String(process.env.DASHBOARD_ENABLED || "true").toLowerCase() !== "false";
    const token = String(process.env.DASHBOARD_TOKEN || "").trim();
    if (!enabled || !token) {
      console.log("ℹ️ Dashboard disabled (set DASHBOARD_TOKEN to enable).");
      return;
    }

    const port = Number(process.env.DASHBOARD_PORT || process.env.PORT || 3000);
    const host = process.env.DASHBOARD_HOST || "0.0.0.0";

    server = http.createServer(async (req, res) => {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        if (urlObj.pathname === "/dashboard" || urlObj.pathname === "/dashboard/") {
          return sendText(res, 200, DASHBOARD_HTML, "text/html; charset=utf-8");
        }
        if (urlObj.pathname.startsWith("/dashboard/api/")) {
          return await handleApi(req, res, urlObj);
        }
        return sendText(res, 404, "Not found.");
      } catch (err) {
        console.error("Dashboard server error:", err);
        return sendJson(res, 500, { error: "Internal error." });
      }
    });

    server.listen(port, host, () => {
      console.log(`🌐 Dashboard running at http://${host}:${port}/dashboard`);
    });
  }

  return { start };
}
