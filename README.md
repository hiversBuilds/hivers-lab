# hivers.lab

> Independent fan tools for the **$BOB** community on **BNB Chain**.
> Open-source. On-chain. No promises.

---

## What is this?

A single-page app that gives the $BOB community four tools, all powered by direct reads from the BNB Chain — no backend, no database, no tracking.

| Tool | What it does |
|------|--------------|
| **Burn Tracker** | Live total of $BOB burned to `0x...dEaD`, % of supply, USD value, auto-refresh every 30s. |
| **Burn Leaderboard** | Top 10 wallets by $BOB burned in the last ~7 days, read from on-chain `Transfer` events. |
| **Meme Factory** | Upload a Bob image, add top/bottom text, export 1080×1080 PNG, post directly to X. |
| **My $BOB Impact** | Paste any wallet address, generate a shareable card showing $BOB holdings on BNB Chain. |

Built for the holders, the burners, and the meme makers. Not for speculators, not for advisors, not for anyone making predictions about price.

---

## Stack

- **React** (Vite)
- **Tailwind CSS v3** for layout utilities
- **No external runtime dependencies** beyond React itself — all chain reads use native `fetch` against public BSC RPCs
- **No backend** — fully static, deployable on any CDN
- **No analytics** — your visit is between you and your browser

The token data is fetched live from these public RPC endpoints (with fallback chain):

```
https://bsc-dataseed.binance.org/
https://bsc-dataseed1.defibit.io/
https://bsc-dataseed1.ninicoin.io/
https://bsc.publicnode.com/
https://1rpc.io/bnb
```

Price data comes from CoinGecko's free public API.

---

## Run locally

```bash
git clone https://github.com/hivers_Builds/hivers-lab.git
cd hivers-lab
npm install
npm run dev
```

Open `http://localhost:5173`. The Burn Tracker should show live values within a few seconds.

---

## Deploy

Push to GitHub, import on [Vercel](https://vercel.com), no config needed. Vercel auto-detects Vite + Tailwind and builds.

---

## Verify on-chain

| | |
|---|---|
| $BOB contract | [`0x51363f073b1e4920fda7aa9e9d84ba97ede1560e`](https://bscscan.com/token/0x51363f073b1e4920fda7aa9e9d84ba97ede1560e) |
| Burn address | [`0x000000000000000000000000000000000000dEaD`](https://bscscan.com/token/0x51363f073b1e4920fda7aa9e9d84ba97ede1560e?a=0x000000000000000000000000000000000000dEaD) |
| PancakeSwap pair | [`0x3c79593e01a7f7fed5d0735b16621e2d52a6bc58`](https://dexscreener.com/bsc/0x3c79593e01a7f7fed5d0735b16621e2d52a6bc58) |

---

## Community

| | |
|---|---|
| Official BOB Telegram | [t.me/BuildOnBNBBOB](https://t.me/BuildOnBNBBOB) |
| Official BOB X / Twitter | [x.com/BuildOnBNBBOB](https://x.com/BuildOnBNBBOB) |
| Hivers (builder) | [x.com/hivers_Builds](https://x.com/hivers_Builds) · [t.me/hivers_Builds](https://t.me/hivers_Builds) |

---

## Roadmap

This is `v0.1`. The lab will ship small, ship often.

- [ ] `v0.2` — historical burn chart (daily / weekly volume)
- [ ] `v0.3` — meme gallery (opt-in publishing of generated memes)
- [ ] `v0.4` — wallet connection + on-chain "burn-to-stamp" optional feature
- [ ] `v0.5` — multilingual (EN / 中文 / ES)

Open an issue to suggest a feature. Better: open a pull request.

---

## Contributing

Forks welcome. PRs welcome. The code is intentionally kept in a single `App.jsx` for now to lower the barrier to contribution — if you can read React, you can contribute.

Code style:
- Tailwind utility classes for layout, inline styles for theming
- Accessibility: keyboard-friendly, color contrast checked
- No tracking, no analytics, no telemetry — ever

---

## Disclaimer

This is an independent fan project. **Not affiliated with Binance, the BNB Chain team, or the $BOB community core team.** Use at your own discretion.

$BOB is a memecoin. Crypto is volatile. You can lose everything. **Nothing in this repository or the deployed site is financial advice.** Always verify on-chain via [BscScan](https://bscscan.com).

---

## License

MIT. Build with it. Fork it. Improve it. Ship something.

---

*Built by [@hivers_Builds](https://x.com/hivers_Builds) — quiet code, no promises.*