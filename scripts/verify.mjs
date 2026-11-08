// _verify.mjs — 只读验证：运行中的 DSH 宿主是否已把某个客户端插件发给浏览器
// 用法: node _verify.mjs [packageName] [port]
// 输出固定标记行，便于 install.ps1 / uninstall.ps1 断言：
//   GRAPH_REV <rev>
//   GRAPH_HIT <true|false>
//   GRAPH_ROW <json>
//   BUNDLE_STATUS <code>
//   BUNDLE_MARKER <true|false>
const pkg = process.argv[2] ?? "dsh-prompt-polish";
const port = process.argv[3] ?? "61372";
const base = `http://127.0.0.1:${port}`;

async function readGraph() {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 4000);
  try {
    const res = await fetch(`${base}/plugins/events`, { signal: c.signal });
    if (res.status !== 200) return { error: `events HTTP ${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const line = buf.split("\n").find((l) => l.startsWith("data: "));
      if (line) return JSON.parse(line.slice(6));
    }
    return { error: "stream closed before graph frame" };
  } catch (e) {
    return { error: `${e.name}: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

const frame = await readGraph();
if (frame.type !== "graph") {
  console.log(`GRAPH_ERROR ${frame.error ?? "no graph frame"}`);
  process.exit(1);
}

const g = frame.graph;
console.log(`GRAPH_REV ${g.rev}`);
console.log(`GRAPH_ENTRIES ${g.entries.length}`);
const row = g.entries.find((e) => e.id === pkg) ?? g.entries.find((e) => e.id.includes(pkg));
console.log(`GRAPH_HIT ${row !== undefined}`);
if (row) console.log(`GRAPH_ROW ${JSON.stringify(row)}`);

let status = 0;
let hasMarker = false;
if (row) {
  // 图里给的 URL 是文档相对形式的 combo 路由，例如 plugins/??<pkg>/client.js&rev=xxxx
  const url = `${base}/${row.url}`;
  try {
    const r = await fetch(url);
    status = r.status;
    const text = await r.text();
    hasMarker = text.includes("data-prompt-polish");
    console.log(`BUNDLE_URL ${url}`);
    console.log(`BUNDLE_LEN ${text.length}`);
  } catch (e) {
    console.log(`BUNDLE_ERROR ${e.name}: ${e.message}`);
  }
}
console.log(`BUNDLE_STATUS ${status}`);
console.log(`BUNDLE_MARKER ${hasMarker}`);
process.exit(row && status === 200 ? 0 : 2);
