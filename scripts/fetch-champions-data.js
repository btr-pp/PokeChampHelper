/**
 * fetch-champions-data.js
 *
 * 從 Serebii.net 抓取《Pokémon Champions》可用寶可夢資料，
 * 並從 PokeAPI 取得繁體中文名稱，輸出至 data/champions-pokemon.json。
 *
 * 使用方式：node scripts/fetch-champions-data.js
 * 相容 Node.js 16+ (使用 https 模組)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SEREBII_BASE = "https://www.serebii.net";
const POKEMON_LIST_URL = `${SEREBII_BASE}/pokemonchampions/pokemon.shtml`;
const POKEAPI_SPECIES = "https://pokeapi.co/api/v2/pokemon-species";
const REQUEST_DELAY = 1500; // ms between requests to Serebii
const POKEAPI_DELAY = 300; // ms between PokeAPI requests
const MAX_RETRIES = 3;

const OUTPUT_PATH = path.join(__dirname, "..", "data", "champions-pokemon.json");

// ─── Helpers ───

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Pokemon Champions Data Fetcher; educational/personal use)",
        },
      },
      (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${SEREBII_BASE}${res.headers.location}`;
          return httpGet(redirectUrl).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await httpGet(url);
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1}/${retries} for ${url}: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}

async function fetchJSON(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const text = await httpGet(url);
      return JSON.parse(text);
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

/**
 * Extract type names from HTML snippets containing type images.
 * Pattern: /pokedex-bw/type/{typename}.gif
 */
function extractTypes(html) {
  const typeRegex = /\/pokedex-bw\/type\/(\w+)\.gif/g;
  const types = [];
  let match;
  while ((match = typeRegex.exec(html)) !== null) {
    const t = match[1].toLowerCase();
    if (t === "physical" || t === "special" || t === "other") continue;
    types.push(t);
  }
  return types;
}

// ─── Step 1: Parse Pokemon list from Serebii ───

async function fetchPokemonList() {
  console.log("📋 Fetching Pokemon list from Serebii...");
  const html = await fetchWithRetry(POKEMON_LIST_URL);

  // Structure: <td class="fooinfo"> #0003 </td> ... <a href="...">Name<br /></a> ... type gifs
  // Use a more flexible regex that handles the nested table and <br /> in name
  const rowRegex =
    /<td[^>]*class="fooinfo"[^>]*>\s*#(\d+)\s*<\/td>\s*<td[^>]*class="fooinfo"[^>]*>[\s\S]*?<\/td>\s*<td[^>]*class="fooinfo"[^>]*>\s*<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*class="fooinfo"[^>]*>([\s\S]*?)<\/td>/gi;

  const entries = [];
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const dexNum = parseInt(match[1], 10);
    const detailPath = match[2];
    const name = match[3].replace(/<br\s*\/?>/g, "").trim();
    const typeHtml = match[4];
    const types = extractTypes(typeHtml);

    entries.push({ dexNum, name, detailPath, types });
  }

  console.log(`  Found ${entries.length} entries (including forms & megas)`);
  return entries;
}

// ─── Step 2: Group entries into base pokemon + forms ───

function groupEntries(entries) {
  const baseMap = new Map();

  for (const entry of entries) {
    const isMega = entry.name.startsWith("Mega ");
    const isForm = entry.name.includes("(") || entry.name.includes("Eternal");

    if (!baseMap.has(entry.dexNum)) {
      if (isMega || isForm) {
        baseMap.set(entry.dexNum, { base: null, forms: [entry] });
      } else {
        baseMap.set(entry.dexNum, { base: entry, forms: [] });
      }
    } else {
      const group = baseMap.get(entry.dexNum);
      if (!isMega && !isForm && !group.base) {
        group.base = entry;
      } else {
        group.forms.push(entry);
      }
    }
  }

  return baseMap;
}

// ─── Step 3: Fetch moves + stats for each pokemon from detail page ───

function extractBaseStats(html) {
  // Pattern: "Base Stats - Total: 534</td>\n<td ...>78</td><td ...>84</td>..."
  const statsRegex =
    /Base Stats\s*-\s*Total:\s*(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>/i;
  const m = statsRegex.exec(html);
  if (!m) return null;
  return {
    total: parseInt(m[1], 10),
    hp: parseInt(m[2], 10),
    atk: parseInt(m[3], 10),
    def: parseInt(m[4], 10),
    spa: parseInt(m[5], 10),
    spd: parseInt(m[6], 10),
    spe: parseInt(m[7], 10),
  };
}

async function fetchDetailData(detailPath) {
  const url = `${SEREBII_BASE}${detailPath}`;
  try {
    const html = await fetchWithRetry(url);
    const moveTypes = new Set();

    // Primary regex: find move entries with type + category + power
    const moveRowRegex =
      /attackdex-champions\/[^"]+\.shtml[^>]*>[^<]+<\/a>.*?\/pokedex-bw\/type\/(\w+)\.gif.*?\/pokedex-bw\/type\/(physical|special|other)\.png.*?<td[^>]*>\s*(\d+|--)/gis;

    let m;
    while ((m = moveRowRegex.exec(html)) !== null) {
      const moveType = m[1].toLowerCase();
      const category = m[2].toLowerCase();
      const power = m[3];
      if (category !== "other" && power !== "--") {
        moveTypes.add(moveType);
      }
    }

    // Fallback: simpler extraction of types near attackdex links
    if (moveTypes.size === 0) {
      const simpleRegex =
        /attackdex-champions\/.*?\/pokedex-bw\/type\/(\w+)\.gif/gis;
      while ((m = simpleRegex.exec(html)) !== null) {
        const t = m[1].toLowerCase();
        if (t !== "physical" && t !== "special" && t !== "other") {
          moveTypes.add(t);
        }
      }
    }

    // Extract base stats
    const stats = extractBaseStats(html);

    return { moveTypes: [...moveTypes], stats };
  } catch (e) {
    console.log(`  ⚠️ Failed to fetch detail from ${url}: ${e.message}`);
    return { moveTypes: [], stats: null };
  }
}

// ─── Step 4: Fetch Chinese names from PokeAPI ───

async function fetchChineseName(dexNum) {
  try {
    const data = await fetchJSON(`${POKEAPI_SPECIES}/${dexNum}`);
    const zhHant = data.names.find((n) => n.language.name === "zh-hant");
    const zhHans = data.names.find((n) => n.language.name === "zh-hans");
    return zhHant ? zhHant.name : zhHans ? zhHans.name : null;
  } catch (e) {
    console.log(`  ⚠️ Failed to fetch Chinese name for #${dexNum}: ${e.message}`);
    return null;
  }
}

// ─── Main ───

async function main() {
  console.log("🎮 Pokémon Champions Data Fetcher");
  console.log("==================================\n");

  // Step 1: Get pokemon list
  const entries = await fetchPokemonList();
  if (entries.length === 0) {
    console.error("❌ No pokemon entries found. Page structure may have changed.");
    process.exit(1);
  }

  // Step 2: Group into base + forms
  const grouped = groupEntries(entries);
  const dexNums = [...grouped.keys()].sort((a, b) => a - b);
  console.log(`\n📊 ${dexNums.length} unique pokemon (base species)\n`);

  // Step 3: Collect unique detail paths
  const allDetailPaths = new Set();
  for (const [, group] of grouped) {
    if (group.base) allDetailPaths.add(group.base.detailPath);
    for (const form of group.forms) {
      allDetailPaths.add(form.detailPath);
    }
  }
  const uniquePaths = [...allDetailPaths];
  console.log(`🔍 Fetching moves + stats from ${uniquePaths.length} detail pages...\n`);

  // Fetch move types + stats
  const detailCache = new Map(); // detailPath -> { moveTypes, stats }
  for (let i = 0; i < uniquePaths.length; i++) {
    const p = uniquePaths[i];
    const name = p.replace("/pokedex-champions/", "").replace(/\//g, "");
    process.stdout.write(`  [${i + 1}/${uniquePaths.length}] ${name}...`);
    const detail = await fetchDetailData(p);
    detailCache.set(p, detail);
    const statsStr = detail.stats ? ` stats:${detail.stats.total}` : " no-stats";
    console.log(` ${detail.moveTypes.length} types${statsStr}`);
    if (i < uniquePaths.length - 1) await sleep(REQUEST_DELAY);
  }

  // Step 4: Fetch Chinese names
  console.log(`\n🌏 Fetching Chinese names for ${dexNums.length} pokemon...\n`);
  const nameCache = new Map();
  for (let i = 0; i < dexNums.length; i++) {
    const num = dexNums[i];
    process.stdout.write(`  [${i + 1}/${dexNums.length}] #${num}...`);
    const name = await fetchChineseName(num);
    nameCache.set(num, name);
    console.log(` ${name || "(not found)"}`);
    if (i < dexNums.length - 1) await sleep(POKEAPI_DELAY);
  }

  // Step 5: Assemble JSON
  console.log("\n📦 Assembling JSON...\n");
  const pokemon = [];

  for (const dexNum of dexNums) {
    const group = grouped.get(dexNum);
    const base = group.base || group.forms[0];
    const baseDetail = detailCache.get(base.detailPath) || { moveTypes: [], stats: null };
    const nameTW = nameCache.get(dexNum) || "";

    const entry = {
      id: dexNum,
      name: base.name,
      nameTW,
      types: base.types,
      stats: baseDetail.stats,
      moveTypes: baseDetail.moveTypes,
    };

    if (group.forms.length > 0) {
      entry.forms = group.forms.map((f) => {
        const fDetail = detailCache.get(f.detailPath) || baseDetail;
        return {
          name: f.name,
          types: f.types,
          stats: fDetail.stats,
          moveTypes: fDetail.moveTypes || baseDetail.moveTypes,
        };
      });
    }

    pokemon.push(entry);
  }

  const output = {
    pokemon,
    meta: {
      source: "serebii.net + pokeapi.co",
      fetchedAt: new Date().toISOString().split("T")[0],
      gameVersion: "Pokémon Champions",
      totalBase: pokemon.length,
      totalWithForms: entries.length,
    },
  };

  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  // Also generate JS file for <script> tag loading (works with file://)
  const jsPath = OUTPUT_PATH.replace(".json", ".js");
  fs.writeFileSync(jsPath, "var CHAMPIONS_DATA = " + JSON.stringify(output) + ";", "utf-8");

  console.log(`✅ Done! Wrote ${pokemon.length} pokemon to ${OUTPUT_PATH}`);
  console.log(`   Also generated ${jsPath}`);
  console.log(`   Total entries (with forms): ${entries.length}`);
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
