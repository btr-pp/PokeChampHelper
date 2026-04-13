/**
 * patch-stats.js
 * Patches base stats into existing champions-pokemon.json from Serebii detail pages.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const SEREBII_BASE = "https://www.serebii.net";
const DATA_PATH = path.join(__dirname, "..", "data", "champions-pokemon.json");
const JS_PATH = DATA_PATH.replace(".json", ".js");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redir = res.headers.location.startsWith("http") ? res.headers.location : `${SEREBII_BASE}${res.headers.location}`;
        return httpGet(redir).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function extractBaseStats(html) {
  const r = /Base Stats\s*-\s*Total:\s*(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>/i;
  const m = r.exec(html);
  if (!m) return null;
  return { total: +m[1], hp: +m[2], atk: +m[3], def: +m[4], spa: +m[5], spd: +m[6], spe: +m[7] };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  const pokemon = data.pokemon;
  let patched = 0;

  // Collect all unique detail paths needed
  const tasks = [];
  for (const p of pokemon) {
    if (!p.stats) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/\s+/g, "-");
      tasks.push({ target: p, slug });
    }
  }

  console.log(`📊 Patching stats for ${tasks.length} pokemon...\n`);

  for (let i = 0; i < tasks.length; i++) {
    const { target, slug } = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] #${target.id} ${target.name}...`);
    try {
      const html = await httpGet(`${SEREBII_BASE}/pokedex-champions/${slug}/`);
      const stats = extractBaseStats(html);
      if (stats) {
        target.stats = stats;
        patched++;
        console.log(` ${stats.total} (${stats.hp}/${stats.atk}/${stats.def}/${stats.spa}/${stats.spd}/${stats.spe})`);
      } else {
        console.log(" (stats not found on page)");
      }
    } catch (e) {
      console.log(` error: ${e.message}`);
    }
    await sleep(1500);
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
  fs.writeFileSync(JS_PATH, "var CHAMPIONS_DATA = " + JSON.stringify(data) + ";", "utf-8");
  console.log(`\n✅ Patched ${patched} pokemon with stats`);
}

main().catch(e => { console.error(e); process.exit(1); });
