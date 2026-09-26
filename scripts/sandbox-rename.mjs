/**
 * Turn the integration build into the separately-installable sandbox system.
 * Idempotent: re-run after every merge from integration/v14, then commit.
 *   node scripts/sandbox-rename.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const FROM = "starwarsffg";
const TO = "starwarsffg_sandbox";
const TITLE = "Star Wars FFG (Sandbox)";
const REPO = "https://github.com/Saberofblue/starwarsffg-sandbox";
const SKIP = /^(lib|fonts|images)\//;
const TEXT = /\.(js|mjs|ts|html|hbs|json|css|scss|yml|yaml|md)$/i;
const re = new RegExp(`${FROM}(?!_sandbox)`, "g");

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
let edited = 0;
for (const file of files) {
  if (SKIP.test(file) || !TEXT.test(file) || file === "scripts/sandbox-rename.mjs") continue;
  const src = fs.readFileSync(file, "utf8");
  const out = src.replace(re, TO);
  if (out !== src) { fs.writeFileSync(file, out); edited++; }
}
// files named after the old id (compiled stylesheet and its Sass source)
for (const file of files) {
  if (SKIP.test(file) || !file.includes(FROM) || file.includes(TO)) continue;
  const dest = file.replace(re, TO);
  execSync(`git mv -k "${file}" "${dest}"`);
  console.log(`renamed ${file} -> ${dest}`);
}
// manifest: distinct title and this repo's release URLs
const manifest = JSON.parse(fs.readFileSync("system.json", "utf8"));
manifest.title = TITLE;
manifest.url = REPO;
manifest.manifest = `${REPO}/releases/latest/download/system.json`;
manifest.download = `${REPO}/releases/download/v${manifest.version}/system.zip`;
fs.writeFileSync("system.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`rewrote ${edited} files; id=${manifest.id} title="${manifest.title}" version=${manifest.version}`);
