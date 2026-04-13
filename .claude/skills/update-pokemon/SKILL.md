---
name: update-pokemon
description: "Fetch and update Pokemon Champions data from Serebii.net and PokeAPI. Use when user wants to refresh or update the Pokemon database."
disable-model-invocation: true
allowed-tools: Bash(node scripts/fetch-champions-data.js), Bash(node scripts/patch-chinese-names.js)
---

# Update Pokemon Champions Data

Fetch the latest Pokemon Champions roster data from Serebii.net, including types, move type coverage, and Traditional Chinese names from PokeAPI.

## Steps

1. Run the main fetch script to scrape all Pokemon data from Serebii:

```
node scripts/fetch-champions-data.js
```

This script will:
- Fetch the full Pokemon list from `serebii.net/pokemonchampions/pokemon.shtml`
- Fetch move type coverage for each Pokemon from individual Serebii Pokedex pages
- Fetch Traditional Chinese names from PokeAPI
- Output to `data/champions-pokemon.json` and `data/champions-pokemon.js`

**Note:** This takes ~5 minutes due to rate limiting (1.5s between Serebii requests).

2. If Chinese names fail (check for empty `nameTW` fields), run the patch script:

```
node scripts/patch-chinese-names.js
```

3. Verify the output:

```
node -e "const d=require('./data/champions-pokemon.json'); console.log('Total:', d.meta.totalBase, 'base,', d.meta.totalWithForms, 'with forms'); const missing=d.pokemon.filter(p=>!p.nameTW); console.log('Missing CN names:', missing.length); const noMoves=d.pokemon.filter(p=>p.moveTypes.length===0); console.log('Missing moves:', noMoves.length);"
```

4. Report the results to the user:
   - Total base Pokemon count
   - Total with forms/megas
   - Any missing Chinese names or move data
