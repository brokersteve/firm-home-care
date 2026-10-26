import fs from "node:fs";
const sig = process.argv[2], base = `/t/501/${sig}/`;
const seen = new Map(), queue = [base];
while (queue.length) {
  const path = queue.shift(); if (seen.has(path)) continue;
  const res = await fetch(`http://localhost:8787${path}`, { redirect: "manual" });
  const body = await res.text(); seen.set(path, { status: res.status, body, loc: res.headers.get("location") });
  for (const m of body.matchAll(/href="([^"]+)"/g)) {
    const u = m[1].replace(/&amp;/g, "&");
    if (u.startsWith(base.slice(0, -1)) && !u.includes("manifest") && !seen.has(u)) queue.push(u);
  }
  if (res.headers.get("location")?.startsWith(base.slice(0,-1))) queue.push(res.headers.get("location"));
}
fs.writeFileSync("/tmp/claude-0/demo/pages.json", JSON.stringify([...seen].map(([p, v]) => [p, v.status, v.body, v.loc])));
console.log(seen.size);
for (const [p, v] of seen) if (v.status !== 200) console.log(v.status, p, v.loc);
