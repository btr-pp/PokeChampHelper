/**
 * fetch-abilities.js
 *
 * 從 PokeAPI 的 GitHub static mirror 拉每隻寶可夢的特性資訊
 * （含 Mega/特殊 form），並產出：
 *   - data/abilities.json：所有特性的中英文名與說明
 *   - data/abilities.js：上面那份的 JS 包裝
 *   - data/champions-pokemon.json：原本的資料每筆加上 abilities 欄位
 *   - data/champions-pokemon.js：同步重產
 *
 * 使用方式：node scripts/fetch-abilities.js
 *
 * 資料來源：https://github.com/PokeAPI/api-data （PokeAPI 官方靜態映射）
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const RAW_BASE = "https://raw.githubusercontent.com/PokeAPI/api-data/master/data/api/v2";
const POKE_PATH = path.join(__dirname, "..", "data", "champions-pokemon.json");
const POKE_JS_PATH = path.join(__dirname, "..", "data", "champions-pokemon.js");
const ABIL_PATH = path.join(__dirname, "..", "data", "abilities.json");
const ABIL_JS_PATH = path.join(__dirname, "..", "data", "abilities.js");
const REQUEST_DELAY = 80; // ms between requests
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "PokeChampHelper/1.0" } }, (res) => {
        if (res.statusCode === 404) {
          res.resume();
          return resolve(null);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch (e) {
            reject(new Error("JSON parse: " + e.message));
          }
        });
      })
      .on("error", reject)
      .setTimeout(30000, function () { this.destroy(new Error("Timeout")); });
  });
}

async function fetchWithRetry(url) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await httpGetJSON(url);
    } catch (e) {
      if (i === MAX_RETRIES - 1) throw e;
      console.warn(`  retry ${i + 1}: ${e.message}`);
      await sleep(1000 * (i + 1));
    }
  }
}

// 把 form 的英文名轉成 PokeAPI 的 slug
//   "Mega Charizard X" → "charizard-mega-x"
//   "Heat Rotom" → "rotom-heat"
//   "Mega Venusaur" → "venusaur-mega"
//   "Alolan Raichu" → "raichu-alola"
//   "Galarian Slowpoke" → "slowpoke-galar"
function formNameToSlug(baseName, formName) {
  const base = baseName.toLowerCase();
  const f = formName.toLowerCase();

  // Mega 進化
  const mMega = f.match(/^mega (.+?)(?: ([xy]))?$/);
  if (mMega) {
    const sufX = mMega[2] ? `-mega-${mMega[2]}` : "-mega";
    return base + sufX;
  }
  // Rotom forms: "Heat Rotom" → "rotom-heat"
  const mRotom = f.match(/^(heat|wash|frost|fan|mow) rotom$/);
  if (mRotom) return `rotom-${mRotom[1]}`;
  // Region forms
  if (f.startsWith("alolan ")) return `${base}-alola`;
  if (f.startsWith("galarian ")) return `${base}-galar`;
  if (f.startsWith("hisuian ")) return `${base}-hisui`;
  if (f.startsWith("paldean ")) return `${base}-paldea`;
  // Special: "Eternal Floette" 等 — 試試直接拼
  return null;
}

async function fetchPokemonAbilities(slugOrId) {
  // slugOrId 可以是數字 id 或 slug 字串；slug 需透過索引查 numeric id
  let id = slugOrId;
  if (typeof id === "string" && !/^\d+$/.test(id)) {
    id = pokemonNameToId.get(id);
    if (!id) return null;
  }
  const url = `${RAW_BASE}/pokemon/${id}/index.json`;
  const data = await fetchWithRetry(url);
  if (!data || !data.abilities) return null;
  return data.abilities.map((a) => ({
    id: a.ability.name,
    isHidden: !!a.is_hidden,
    slot: a.slot,
  }));
}

// 解析 ability 詳情頁 — 用 numeric id（從 ability 名稱→ id index 查）
async function fetchAbilityDetail(name) {
  const id = abilityNameToId.get(name);
  if (!id) return null;
  const url = `${RAW_BASE}/ability/${id}/index.json`;
  const data = await fetchWithRetry(url);
  if (!data) return null;
  const pickLang = (entries, field, langs) => {
    for (const lang of langs) {
      const m = entries.find((e) => e.language.name === lang);
      if (m) return m[field];
    }
    return "";
  };
  // Names
  const nameTW = pickLang(data.names, "name", ["zh-hant"]);
  const nameSC = pickLang(data.names, "name", ["zh-hans"]);
  const nameEN = pickLang(data.names, "name", ["en"]);
  // Description: prefer flavor_text (game-style 簡短) → fallback effect_entries.short_effect
  const flavTW = data.flavor_text_entries
    .filter((e) => e.language.name === "zh-hant")
    .map((e) => e.flavor_text.replace(/\s+/g, ""))
    .pop();
  const flavSC = data.flavor_text_entries
    .filter((e) => e.language.name === "zh-hans")
    .map((e) => e.flavor_text.replace(/\s+/g, ""))
    .pop();
  const shortEN = pickLang(data.effect_entries, "short_effect", ["en"]);
  return {
    id: data.name,
    nameTW: nameTW || nameSC || nameEN || data.name,
    nameEN: nameEN || data.name,
    descTW: flavTW || flavSC || shortEN || "",
    descEN: shortEN || "",
  };
}

// 全域 name→id 對照表（main 啟動時填入）
const pokemonNameToId = new Map();
const abilityNameToId = new Map();

async function loadIndexes() {
  console.log("📚 Loading PokeAPI indexes...");
  const pokeIdx = await fetchWithRetry(`${RAW_BASE}/pokemon/index.json`);
  for (const r of pokeIdx.results) {
    const m = r.url.match(/\/pokemon\/(\d+)\//);
    if (m) pokemonNameToId.set(r.name, parseInt(m[1], 10));
  }
  const abilIdx = await fetchWithRetry(`${RAW_BASE}/ability/index.json`);
  for (const r of abilIdx.results) {
    const m = r.url.match(/\/ability\/(\d+)\//);
    if (m) abilityNameToId.set(r.name, parseInt(m[1], 10));
  }
  console.log(`  pokemon: ${pokemonNameToId.size}, abilities: ${abilityNameToId.size}`);
}

async function main() {
  // 0. 載入索引
  await loadIndexes();

  // 1. 載入原始資料
  const raw = JSON.parse(fs.readFileSync(POKE_PATH, "utf8"));
  const pokeList = raw.pokemon;
  console.log(`📦 Loaded ${pokeList.length} pokemon from data/champions-pokemon.json`);

  // 2. 為每隻基本型態抓 abilities
  console.log("\n🔍 Fetching base abilities...");
  for (let i = 0; i < pokeList.length; i++) {
    const p = pokeList[i];
    if (p.abilities) {
      console.log(`  [${i + 1}/${pokeList.length}] #${p.id} ${p.name} (cached, skip)`);
      continue;
    }
    try {
      const abs = await fetchPokemonAbilities(p.id);
      p.abilities = abs || [];
      console.log(`  [${i + 1}/${pokeList.length}] #${p.id} ${p.name} → ${abs ? abs.map((a) => a.id).join(", ") : "NONE"}`);
    } catch (e) {
      console.warn(`  [${i + 1}/${pokeList.length}] #${p.id} ${p.name} FAILED: ${e.message}`);
      p.abilities = [];
    }
    await sleep(REQUEST_DELAY);
  }

  // 3. 為每個 form 抓 abilities
  console.log("\n🔍 Fetching form abilities...");
  for (let i = 0; i < pokeList.length; i++) {
    const p = pokeList[i];
    if (!p.forms) continue;
    for (let fi = 0; fi < p.forms.length; fi++) {
      const f = p.forms[fi];
      if (f.abilities) continue;
      const slug = formNameToSlug(p.name, f.name);
      if (!slug) {
        console.warn(`  ⚠️  ${p.name} → ${f.name}: 無法判斷 slug，跳過`);
        f.abilities = [];
        continue;
      }
      try {
        const abs = await fetchPokemonAbilities(slug);
        if (abs) {
          f.abilities = abs;
          console.log(`  ${p.name}/${f.name} (${slug}) → ${abs.map((a) => a.id).join(", ")}`);
        } else {
          console.warn(`  ${p.name}/${f.name} (${slug}) → 404，沿用基本特性`);
          f.abilities = p.abilities ? [...p.abilities] : [];
        }
      } catch (e) {
        console.warn(`  ${p.name}/${f.name} FAILED: ${e.message}`);
        f.abilities = p.abilities ? [...p.abilities] : [];
      }
      await sleep(REQUEST_DELAY);
    }
  }

  // 4. 收集所有用到的 ability id
  const allAbilityIds = new Set();
  for (const p of pokeList) {
    (p.abilities || []).forEach((a) => allAbilityIds.add(a.id));
    (p.forms || []).forEach((f) => (f.abilities || []).forEach((a) => allAbilityIds.add(a.id)));
  }
  console.log(`\n💡 Unique abilities: ${allAbilityIds.size}`);

  // 5. 讀取既有 abilities.json 做快取
  let existingAbilities = {};
  if (fs.existsSync(ABIL_PATH)) {
    existingAbilities = JSON.parse(fs.readFileSync(ABIL_PATH, "utf8"));
  }

  // 6. 為每個 ability 抓詳情
  console.log("\n🔍 Fetching ability details (zh-hant)...");
  const abilitiesOut = { ...existingAbilities };
  let idx = 0;
  for (const id of [...allAbilityIds].sort()) {
    idx++;
    if (abilitiesOut[id]) {
      console.log(`  [${idx}/${allAbilityIds.size}] ${id} (cached, skip)`);
      continue;
    }
    try {
      const detail = await fetchAbilityDetail(id);
      if (detail) {
        abilitiesOut[id] = detail;
        console.log(`  [${idx}/${allAbilityIds.size}] ${id} → ${detail.nameTW}`);
      } else {
        console.warn(`  [${idx}/${allAbilityIds.size}] ${id} → NULL`);
      }
    } catch (e) {
      console.warn(`  [${idx}/${allAbilityIds.size}] ${id} FAILED: ${e.message}`);
    }
    await sleep(REQUEST_DELAY);
  }

  // 7. 寫檔
  fs.writeFileSync(POKE_PATH, JSON.stringify(raw, null, 2));
  fs.writeFileSync(POKE_JS_PATH, "var CHAMPIONS_DATA = " + JSON.stringify(raw) + ";\n");
  fs.writeFileSync(ABIL_PATH, JSON.stringify(abilitiesOut, null, 2));
  fs.writeFileSync(ABIL_JS_PATH, "var ABILITIES_DATA = " + JSON.stringify(abilitiesOut) + ";\n");

  console.log(`\n✅ Wrote:`);
  console.log(`  - ${POKE_PATH}`);
  console.log(`  - ${POKE_JS_PATH}`);
  console.log(`  - ${ABIL_PATH}`);
  console.log(`  - ${ABIL_JS_PATH}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
