/**
 * patch-chinese-names.js
 * Fixes Chinese names in champions-pokemon.json (PokeAPI uses lowercase zh-hant/zh-hans)
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "champions-pokemon.json");
const POKEAPI_SPECIES = "https://pokeapi.co/api/v2/pokemon-species";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  const pokemon = data.pokemon;
  let patched = 0;

  for (let i = 0; i < pokemon.length; i++) {
    const p = pokemon[i];
    if (p.nameTW) continue; // already has Chinese name

    process.stdout.write(`  [${i + 1}/${pokemon.length}] #${p.id} ${p.name}...`);
    try {
      const species = await httpGet(`${POKEAPI_SPECIES}/${p.id}`);
      const zhHant = species.names.find(n => n.language.name === "zh-hant");
      const zhHans = species.names.find(n => n.language.name === "zh-hans");
      p.nameTW = zhHant ? zhHant.name : zhHans ? zhHans.name : "";
      console.log(` ${p.nameTW || "(none)"}`);
      patched++;
    } catch (e) {
      console.log(` error: ${e.message}`);
    }
    await sleep(200);
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\n✅ Patched ${patched} Chinese names`);
}

main().catch(e => { console.error(e); process.exit(1); });
