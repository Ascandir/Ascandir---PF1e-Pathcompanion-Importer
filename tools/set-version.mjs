// Sets the module version in module.json and stamps it onto all internal script
// imports (./x.js?v=1.2.3) so browsers load fresh files after an update.
// Usage: node tools/set-version.mjs 0.1.3
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node tools/set-version.mjs X.Y.Z");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync("module.json", "utf8"));
manifest.version = version;
writeFileSync("module.json", `${JSON.stringify(manifest, null, 2)}\n`);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
});
for (const file of walk("scripts")) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/(from\s+["']\.{1,2}\/[^"'?]+\.js)(\?v=[^"']*)?(["'])/g, `$1?v=${version}$3`);
  if (out !== src) writeFileSync(file, out);
}
console.log(`Version ${version} gesetzt.`);
