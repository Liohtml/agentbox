#!/usr/bin/env node
/**
 * agentbox Observer — a tiny zero-dependency dashboard that runs in the tmux
 * `observer` window inside the container.
 *
 * CRITICAL: bind 0.0.0.0, NOT 127.0.0.1 — Docker's published port is only
 * reachable from the host browser if the server listens on all interfaces.
 *
 * Port comes from OBSERVER_PORT (set by the entry script), default 4317.
 * It surfaces live agent-team activity by tailing the Claude projects dir.
 */
import { createServer } from "node:http";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAW_PORT = Number(process.env.OBSERVER_PORT || 4317);
const PORT = Number.isInteger(RAW_PORT) && RAW_PORT > 0 && RAW_PORT <= 65535 ? RAW_PORT : 4317;
const HOST = "0.0.0.0";
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || "/home/agent/.claude/projects";

function collectSessions() {
  const out = [];
  if (!existsSync(PROJECTS_DIR)) return out;
  let projects;
  try {
    projects = readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const proj of projects) {
    const dir = join(PROJECTS_DIR, proj);
    let files;
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = join(dir, f);
      try {
        const st = statSync(full);
        out.push({ project: proj, session: f.replace(/\.jsonl$/, ""), mtime: st.mtimeMs, size: st.size });
      } catch {
        /* ignore */
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, 50);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>agentbox observer</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:dark}
  body{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;background:#0b0e14;color:#cbd5e1}
  header{padding:14px 20px;background:#11161f;border-bottom:1px solid #1f2733;display:flex;align-items:center;gap:12px}
  header b{color:#7dd3fc;font-size:16px}
  .dot{width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e}
  main{padding:20px;max-width:960px;margin:0 auto}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1f2733}
  th{color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
  .muted{color:#64748b}
  code{color:#fbbf24}
</style></head><body>
<header><span class="dot"></span><b>agentbox observer</b><span class="muted">agent-team activity</span></header>
<main>
  <p class="muted">Polling <code>${PROJECTS_DIR}</code> · port ${PORT} · refreshes every 2s</p>
  <table><thead><tr><th>project</th><th>session</th><th>size</th><th>updated</th></tr></thead>
  <tbody id="rows"><tr><td colspan="4" class="muted">loading…</td></tr></tbody></table>
</main>
<script>
// Project/session names come from filesystem paths that in-container code can
// create — always HTML-escape before rendering (stored-XSS guard).
const esc = (v) => String(v).replace(/[&<>"']/g, (c) =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function refresh(){
  try{
    const r = await fetch('/api/sessions'); const data = await r.json();
    const rows = document.getElementById('rows');
    if(!data.sessions.length){ rows.innerHTML='<tr><td colspan="4" class="muted">no active sessions yet</td></tr>'; return; }
    rows.innerHTML = data.sessions.map(s=>{
      const ago = Math.max(0, Math.round((data.now - s.mtime)/1000));
      return '<tr><td>'+esc(s.project)+'</td><td>'+esc(s.session.slice(0,8))+'…</td><td>'+(s.size/1024|0)+' KB</td><td>'+ago+'s ago</td></tr>';
    }).join('');
  }catch(e){ /* ignore transient */ }
}
refresh(); setInterval(refresh, 2000);
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === "/api/sessions") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ now: Date.now(), sessions: collectSessions() }));
    return;
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

server.on("error", (err) => {
  // Without this handler a bind failure (e.g. EADDRINUSE) is an unhandled
  // exception and the observer tmux window dies with an unreadable stack.
  if (err && err.code === "EADDRINUSE") {
    console.error(`[observer] port ${PORT} is already in use inside the container.`);
    console.error(`[observer] stop the other process or restart agentbox with --port <n>.`);
  } else {
    console.error(`[observer] server error: ${err && err.message ? err.message : err}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[observer] listening on http://${HOST}:${PORT} (open http://localhost:${PORT} on the host)`);
});
