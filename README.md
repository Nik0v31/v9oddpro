# ⚽ Voetbal Odds Bot

## 🚀 Vercel deployment — stap voor stap

### Stap 1 — Maak een GitHub repository

1. Ga naar [github.com](https://github.com) → log in
2. Klik **"New"** (groene knop linksboven)
3. Naam: `odds-bot` → klik **"Create repository"**

---

### Stap 2 — Upload de bestanden

Op de pagina van je nieuwe lege repository:

1. Klik op **"uploading an existing file"**
2. **Unzip** eerst de `odds-bot.zip` op je computer
3. Open de uitgepakte map — je ziet: `pages/`, `package.json`, `next.config.js`, etc.
4. **Selecteer ALLES** in die map en sleep het naar het GitHub uploadvenster
5. Klik **"Commit changes"**

> ⚠️ Belangrijk: sleep de **inhoud** van de map, niet de map zelf.
> GitHub moet `package.json` zien in de root, niet `odds-bot/package.json`.

---

### Stap 3 — Deploy op Vercel

1. Ga naar [vercel.com](https://vercel.com) → log in met GitHub
2. Klik **"Add New Project"**
3. Selecteer je `odds-bot` repository → klik **"Import"**
4. Vercel detecteert Next.js automatisch — klik **"Deploy"**

---

### Stap 4 — API key instellen

Na de deploy:

1. Ga naar je project in Vercel → **Settings** → **Environment Variables**
2. Voeg toe (één voor één):

| Name | Value |
|------|-------|
| `API_FOOTBALL_KEY` | `766e5a816bmsh863be1da5ebacfdp1b2fdcjsnf5fc4ec89a8b` |
| `NEXT_PUBLIC_USE_LIVE` | `true` |

3. Klik **Save** na elke variabele

---

### Stap 5 — Herstart

1. Ga naar **Deployments** tab in Vercel
2. Klik de **drie puntjes** naast de laatste deployment → **"Redeploy"**
3. ✅ Je bot is live!

---

## 📁 Bestandsstructuur (wat GitHub moet zien)

```
(root van repository)
├── pages/
│   ├── index.js
│   └── api/
│       ├── fixtures.js
│       ├── live.js
│       ├── team-history.js
│       └── odds.js
├── package.json
├── next.config.js
├── vercel.json
└── README.md
```

---

## ⚙️ API verbruik (gratis plan = 100 req/dag)

| Actie | Requests |
|-------|----------|
| Wedstrijden laden | ~6 (1 per competitie) |
| Stats per wedstrijd | ~2 per wedstrijd |
| Odds per wedstrijd | 1 per wedstrijd |
| Live refresh (60s) | 1 per minuut |

**Tip:** Vercel cachet responses automatisch — dit bespaart veel requests.
