# Pokex — 寶可夢屬性相剋查詢

純前端單頁工具，快速查詢寶可夢屬性弱點、建立隊伍並取得對戰建議。

> 📖 詳細操作請看 **[使用者說明書](./使用者說明書.md)**；版本更新請看 [CHANGES.md](./CHANGES.md)。

## 主要功能

- **屬性查詢** — 搜尋寶可夢（中文／英文／編號）或手選 1～2 個屬性，即時顯示弱點（×2/×4）、抵抗（×½/×¼）、免疫（×0）。
- **我的隊伍** — 3 組隊伍、每隊最多 6 隻；支援自動帶入屬性／種族值／可學招式、拖曳排序、Mega 進化（每場限 1）、隊伍 JSON 匯出匯入。
- **隊伍分析** — 各成員弱點一覽、威脅屬性分級、推薦攜帶招式、攻擊覆蓋盲點偵測。
- **即時對手分析** — 搜尋對手後自動排序上場建議，含徽章分類與速度比較（先手／後手／同速）。
- **6 選 3 對戰選角** — 隊伍超過 3 隻時自動啟用。

資料會自動存入瀏覽器 `localStorage`，免登入、免後端。

> 💡 App 運行時，畫面右下角的 📖 按鈕可隨時開啟使用者說明書。

## 快速開始

### 方式一：直接開啟

瀏覽器開啟 `index.html` 即可使用全部功能。

### 方式二：本機伺服器（PWA／行動裝置建議）

```bash
npm install -g serve
serve .
# 瀏覽器開啟 http://localhost:3000
```

## 安裝為 App（PWA）

本工具支援 PWA，可安裝到手機桌面或電腦工作列當原生 App 用，並可離線使用。

> ⚠️ PWA 功能**只在 HTTPS 或 localhost 下生效**。`file://` 直接開只能用網頁模式（功能完全相同，只是沒有離線與安裝能力）。

| 平台 | 安裝方式 |
| --- | --- |
| **iOS Safari** | 點分享 ⬆️ → 加入主畫面（需 iOS 16.4+） |
| **Android Chrome** | 選單 ☰ → 安裝應用程式 |
| **桌面 Chrome / Edge** | 網址列右側出現安裝圖示，點擊即可 |

## 技術細節

- 單一 HTML 檔案（HTML + CSS + JS 全包）
- 18 種屬性的攻防倍率表完整內建（`DEFENSE` / `OFFENSE` 矩陣）
- 繁體中文介面、Mobile-first RWD
- 資料持久化使用 `localStorage`（key: `poke-teams`，支援舊格式自動升級）
- 寶可夢資料庫：`data/champions-pokemon.json`（含種族值、可學招式屬性、Mega/區域形態）

## 檔案結構

```
PokeChampHelper/
├── index.html              # 主頁面（HTML + CSS + JS 全包）
├── manifest.json           # PWA 設定檔
├── sw.js                   # Service Worker（離線快取）
├── logo.png
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── data/
│   ├── champions-pokemon.json   # 寶可夢資料
│   └── champions-pokemon.js     # 同資料包成 JS 全域變數
├── scripts/
│   ├── fetch-champions-data.js  # 從 Serebii / PokeAPI 抓資料
│   ├── patch-chinese-names.js
│   └── patch-stats.js
├── README.md               # 本檔
├── CHANGES.md              # 版本更新紀錄
└── 使用者說明書.md           # 完整操作手冊
```
