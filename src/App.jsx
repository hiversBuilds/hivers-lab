import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================
// HIVERS LAB — community fan tools for $BOB on BNB Chain
// v0.1 · open-source · on-chain · no promises
// ============================================================
//
// SETUP — IMPORTANT
// This component uses Tailwind utility classes for layout.
// Add this line to your index.html <head> for everything to render correctly:
//
//   <script src="https://cdn.tailwindcss.com"></script>
//
// (Or install Tailwind via Vite — see launch_kit.md)
// ============================================================

const TOKEN_CONTRACT = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PANCAKE_PAIR = '0x3c79593e01a7f7fed5d0735b16621e2d52a6bc58';

const RPC_ENDPOINTS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
  'https://bsc.publicnode.com/',
  'https://1rpc.io/bnb',
];

const SELECTOR_BALANCE_OF = '0x70a08231';
const SELECTOR_DECIMALS = '0x313ce567';
const SELECTOR_TOTAL_SUPPLY = '0x18160ddd';
// Transfer(address,address,uint256)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PADDED_BURN = '0x000000000000000000000000' + BURN_ADDRESS.slice(2).toLowerCase();

async function rpcPost(method, params) {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
    } catch (e) {}
  }
  throw new Error('All RPC endpoints failed');
}

const eth_call = (to, data) => rpcPost('eth_call', [{ to, data }, 'latest']);
const eth_blockNumber = () => rpcPost('eth_blockNumber', []);
const eth_getLogs = (filter) => rpcPost('eth_getLogs', [filter]);

async function fetchBurnData() {
  const balanceData = SELECTOR_BALANCE_OF + PADDED_BURN.slice(2);
  const [balanceHex, decimalsHex, totalSupplyHex] = await Promise.all([
    eth_call(TOKEN_CONTRACT, balanceData),
    eth_call(TOKEN_CONTRACT, SELECTOR_DECIMALS),
    eth_call(TOKEN_CONTRACT, SELECTOR_TOTAL_SUPPLY),
  ]);
  const decimals = parseInt(decimalsHex, 16);
  const burnedRaw = BigInt(balanceHex);
  const totalRaw = BigInt(totalSupplyHex);
  const divisor = 10n ** BigInt(decimals);
  const burned = Number(burnedRaw / divisor);
  const total = Number(totalRaw / divisor);
  const pct = Number((burnedRaw * 1000000n) / totalRaw) / 10000;
  return { burned, total, pct, decimals };
}

async function fetchBalanceOf(address) {
  const data = SELECTOR_BALANCE_OF + '000000000000000000000000' + address.toLowerCase().replace('0x', '');
  const [hex, decimalsHex] = await Promise.all([
    eth_call(TOKEN_CONTRACT, data),
    eth_call(TOKEN_CONTRACT, SELECTOR_DECIMALS),
  ]);
  const decimals = parseInt(decimalsHex, 16);
  const raw = BigInt(hex);
  return Number(raw / 10n ** BigInt(decimals));
}

async function fetchPrice() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=build-on-bnb&vs_currencies=usd&include_24hr_change=true'
    );
    const j = await r.json();
    return {
      usd: j['build-on-bnb']?.usd ?? null,
      change24h: j['build-on-bnb']?.usd_24h_change ?? null,
    };
  } catch {
    return null;
  }
}

// Read recent burn transfers (last ~7 days ≈ 200k blocks on BSC at 3s blocktime)
async function fetchRecentBurns() {
  const latestHex = await eth_blockNumber();
  const latest = parseInt(latestHex, 16);
  const from = latest - 200000;
  const decimalsHex = await eth_call(TOKEN_CONTRACT, SELECTOR_DECIMALS);
  const decimals = parseInt(decimalsHex, 16);

  // Some RPCs limit log range. We chunk by 5000 blocks, but only fetch last 40 chunks max for perf.
  const chunkSize = 5000;
  const chunks = [];
  for (let start = from; start < latest; start += chunkSize) {
    chunks.push([start, Math.min(start + chunkSize - 1, latest)]);
  }

  const all = [];
  // Fetch chunks in parallel batches of 4 to stay polite
  for (let i = 0; i < chunks.length; i += 4) {
    const batch = chunks.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(([s, e]) =>
        eth_getLogs({
          fromBlock: '0x' + s.toString(16),
          toBlock: '0x' + e.toString(16),
          address: TOKEN_CONTRACT,
          topics: [TRANSFER_TOPIC, null, PADDED_BURN],
        }).catch(() => [])
      )
    );
    for (const r of results) if (Array.isArray(r)) all.push(...r);
  }

  // Aggregate by sender
  const divisor = 10n ** BigInt(decimals);
  const map = new Map();
  for (const log of all) {
    if (!log.topics || log.topics.length < 3) continue;
    const sender = '0x' + log.topics[1].slice(26);
    const value = BigInt(log.data);
    const prev = map.get(sender) || 0n;
    map.set(sender, prev + value);
  }
  const entries = [...map.entries()]
    .map(([addr, raw]) => ({ addr, amount: Number(raw / divisor) }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  return entries;
}

// ============================================================
// Helpers
// ============================================================
function formatBig(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}
function formatFull(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.floor(n).toLocaleString('en-US');
}
function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}
function isValidAddress(a) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

function useCountUp(target, duration = 1400) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === null || target === undefined || isNaN(target)) return;
    const from = val;
    const to = target;
    let raf;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [target]);
  return val;
}

// ============================================================
// Visual primitives
// ============================================================
const C = {
  bg: '#0A0A09',
  bgSoft: '#141411',
  ink: '#F5E6C8',
  yellow: '#F0B90B',
  yellowDim: '#8A6A06',
  red: '#FF3B2F',
  green: '#4ADE80',
  line: '#2A2620',
};

const StripeBar = ({ height = 14 }) => (
  <div
    style={{
      height,
      background: `repeating-linear-gradient(135deg, ${C.yellow} 0 18px, #0A0A09 18px 36px)`,
    }}
  />
);

const Grain = () => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      opacity: 0.06,
      mixBlendMode: 'overlay',
      backgroundImage:
        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
    }}
  />
);

const HiversMark = ({ size = 36 }) => (
  <svg viewBox="0 0 400 400" width={size} height={size} aria-hidden>
    <rect width="400" height="400" fill="#0A0A09" />
    <line x1="200" y1="72" x2="200" y2="328" stroke="#F0B90B" strokeWidth="14" />
    <line x1="140" y1="120" x2="260" y2="120" stroke="#F0B90B" strokeWidth="14" />
    <line x1="120" y1="200" x2="280" y2="200" stroke="#F0B90B" strokeWidth="14" />
    <line x1="140" y1="280" x2="260" y2="280" stroke="#F0B90B" strokeWidth="14" />
    <circle cx="200" cy="72" r="12" fill="#F5E6C8" />
    <circle cx="200" cy="328" r="12" fill="#F5E6C8" />
  </svg>
);

// ============================================================
// HERO + ABOUT (top of page)
// ============================================================
function Hero() {
  return (
    <section className="relative" style={{ borderBottom: `2px solid ${C.line}` }}>
      <Grain />
      <div className="px-6 py-12 md:py-20 max-w-5xl">
        <div
          className="text-xs uppercase mb-4"
          style={{ color: C.yellow, letterSpacing: '0.3em' }}
        >
          // hivers lab v0.1
        </div>
        <h1
          className="leading-[0.95] mb-6"
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            fontSize: 'clamp(40px, 8vw, 92px)',
            color: C.ink,
            letterSpacing: '-0.02em',
          }}
        >
          BUILD WITH BOB.<br />
          <span style={{ color: C.yellow }}>BURN. SHIP. REPEAT.</span>
        </h1>
        <p
          className="max-w-2xl text-base md:text-lg mb-8"
          style={{ color: C.ink, opacity: 0.75, lineHeight: 1.6 }}
        >
          Free, open-source community tools for the $BOB token. Track every burn live on
          BNB Chain. Forge memes that travel. Mint a shareable card of your on-chain
          impact. Built by the community, for the community.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="#tools"
            className="px-5 py-3 text-xs tracking-widest"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.yellow,
              color: '#0A0A09',
              textDecoration: 'none',
              fontWeight: 700,
            }}
          >
            ↓ JUMP TO TOOLS
          </a>
          <a
            href="https://t.me/BuildOnBNBBOB"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-3 text-xs tracking-widest"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: 'transparent',
              color: C.ink,
              border: `1px solid ${C.line}`,
              textDecoration: 'none',
            }}
          >
            JOIN TELEGRAM ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function AboutBob() {
  return (
    <section className="px-6 py-12 md:py-16" style={{ borderBottom: `2px solid ${C.line}` }}>
      <div className="max-w-3xl">
        <div
          className="text-xs uppercase mb-4"
          style={{ color: C.yellow, letterSpacing: '0.3em' }}
        >
          // what is $bob ?
        </div>
        <h2
          className="mb-6"
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            fontSize: 'clamp(28px, 4vw, 44px)',
            color: C.ink,
            lineHeight: 1.05,
          }}
        >
          A meme that became a movement.
        </h2>
        <div className="space-y-4" style={{ color: C.ink, opacity: 0.8, lineHeight: 1.7 }}>
          <p>
            BOB started as a joke between Binance and its community — a mascot named after
            an intern's reply, with one mission: <em>make BSC great again</em>. The
            original deployer eventually walked away. The community didn't.
          </p>
          <p>
            In March 2025, BOB was officially taken over by its holders. What was a meme
            became a builder ethos: ship things, burn supply, prove the BNB Chain has
            soul. No roadmap dictated from above. Just code, memes, and conviction.
          </p>
          <p style={{ color: C.yellow }}>
            Hivers Lab is one tiny brick in that wall. Independent. Open-source. No
            promises about price. Just tools that make it easier to participate.
          </p>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// BURN TRACKER
// ============================================================
function BurnTracker() {
  const [data, setData] = useState(null);
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bd, pr] = await Promise.all([fetchBurnData(), fetchPrice()]);
      setData(bd);
      setPrice(pr);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const burnedAnim = useCountUp(data?.burned ?? 0);
  const burnedUsd = price?.usd && data?.burned ? data.burned * price.usd : null;

  return (
    <div className="relative">
      <Grain />
      <div className="px-6 py-10 md:py-14" style={{ borderBottom: `2px solid ${C.line}` }}>
        <div className="flex items-center gap-3 mb-6">
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: error ? C.red : C.green,
              boxShadow: `0 0 12px ${error ? C.red : C.green}`,
              animation: 'hivpulse 1.6s infinite',
            }}
          />
          <span
            className="text-xs uppercase"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: C.ink,
              opacity: 0.7,
              letterSpacing: '0.3em',
            }}
          >
            {error
              ? 'OFFLINE — VERIFY ON BSCSCAN'
              : loading && !data
              ? 'CONNECTING TO BSC...'
              : 'LIVE FROM BNB CHAIN'}
          </span>
        </div>

        <p
          className="text-xs uppercase mb-3"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: C.yellow,
            letterSpacing: '0.25em',
          }}
        >
          // total $BOB burned forever
        </p>

        <h2
          className="leading-none"
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            color: C.ink,
            fontSize: 'clamp(48px, 12vw, 160px)',
            letterSpacing: '-0.02em',
          }}
        >
          {data ? formatBig(burnedAnim) : '—'}
        </h2>

        <p
          className="mt-2"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: C.ink,
            opacity: 0.6,
            fontSize: '13px',
          }}
        >
          {data ? `${formatFull(data.burned)} BOB` : 'fetching…'}
          {burnedUsd && ` · ≈ $${formatBig(burnedUsd)} USD destroyed`}
        </p>

        <div className="mt-8 max-w-2xl">
          <div
            className="flex justify-between text-xs mb-2"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: C.ink, opacity: 0.7 }}
          >
            <span>BURNED / TOTAL SUPPLY</span>
            <span style={{ color: C.yellow }}>
              {data ? data.pct.toFixed(4) + '%' : '—'}
            </span>
          </div>
          <div
            className="relative w-full h-3"
            style={{ background: C.bgSoft, border: `1px solid ${C.line}` }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${Math.max(0.2, Math.min(100, data?.pct ?? 0))}%`,
                background: C.yellow,
                transition: 'width 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </div>
        </div>
      </div>

      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ borderBottom: `2px solid ${C.line}` }}
      >
        <MetaCell
          label="PRICE / USD"
          value={price?.usd ? '$' + price.usd.toExponential(3) : '—'}
          sub={
            price?.change24h !== null && price?.change24h !== undefined
              ? `${price.change24h >= 0 ? '+' : ''}${price.change24h?.toFixed(2)}% 24H`
              : ''
          }
          subColor={price?.change24h >= 0 ? C.green : C.red}
        />
        <MetaCell
          label="TOTAL SUPPLY"
          value={data ? formatBig(data.total) : '—'}
          sub={data ? formatFull(data.total) + ' BOB' : ''}
          border
        />
        <MetaCell
          label="LAST SYNC"
          value={lastFetch ? lastFetch.toLocaleTimeString() : '—'}
          sub="auto-refresh 30s"
          border
        />
      </div>

      <div className="px-6 py-8">
        <p
          className="text-xs uppercase mb-4"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: C.ink,
            opacity: 0.6,
            letterSpacing: '0.2em',
          }}
        >
          // verify on chain
        </p>
        <div className="flex flex-wrap gap-3">
          <ChainLink
            href={`https://bscscan.com/token/${TOKEN_CONTRACT}?a=${BURN_ADDRESS}`}
            label="BURN ADDRESS"
          />
          <ChainLink href={`https://bscscan.com/token/${TOKEN_CONTRACT}`} label="$BOB CONTRACT" />
          <ChainLink href={`https://dexscreener.com/bsc/${PANCAKE_PAIR}`} label="DEXSCREENER" />
          <ChainLink
            href={`https://pancakeswap.finance/swap?outputCurrency=${TOKEN_CONTRACT}`}
            label="PANCAKESWAP"
            primary
          />
        </div>
        {error && (
          <p
            className="mt-6 text-xs"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: C.red }}
          >
            ⚠ {error} — public RPCs occasionally throttle. Click refresh or verify on BscScan.
          </p>
        )}
        <button
          onClick={load}
          className="mt-6 px-5 py-2 text-xs tracking-widest"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            background: 'transparent',
            color: C.ink,
            border: `1px solid ${C.line}`,
            cursor: 'pointer',
          }}
        >
          {loading ? 'SYNCING…' : '↻ REFRESH'}
        </button>
      </div>
    </div>
  );
}

const MetaCell = ({ label, value, sub, subColor, border }) => (
  <div
    className={border ? 'hivlab-metacell' : ''}
    style={{
      padding: '24px',
      borderLeft: border ? `2px solid ${C.line}` : 'none',
    }}
  >
    <div
      className="text-xs uppercase mb-2"
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        color: C.ink,
        opacity: 0.55,
        letterSpacing: '0.2em',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: 'Bowlby One, Impact, sans-serif',
        color: C.ink,
        fontSize: '28px',
        lineHeight: 1,
      }}
    >
      {value}
    </div>
    {sub && (
      <div
        className="mt-1 text-xs"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          color: subColor || C.ink,
          opacity: subColor ? 1 : 0.55,
        }}
      >
        {sub}
      </div>
    )}
  </div>
);

const ChainLink = ({ href, label, primary }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="px-4 py-2 text-xs tracking-widest"
    style={{
      fontFamily: 'JetBrains Mono, monospace',
      background: primary ? C.yellow : 'transparent',
      color: primary ? '#0A0A09' : C.ink,
      border: `1px solid ${primary ? C.yellow : C.line}`,
      textDecoration: 'none',
      fontWeight: primary ? 700 : 400,
    }}
  >
    {label} ↗
  </a>
);

// ============================================================
// BURN LEADERBOARD (last ~7 days)
// ============================================================
function BurnLeaderboard() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRecentBurns();
      setRows(r);
    } catch (e) {
      setError(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = rows ? rows.reduce((s, r) => s + r.amount, 0) : 0;
  const max = rows && rows[0] ? rows[0].amount : 1;

  return (
    <section className="px-6 py-12" style={{ borderBottom: `2px solid ${C.line}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <h3
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            fontSize: 'clamp(24px, 4vw, 38px)',
            color: C.ink,
            letterSpacing: '-0.01em',
          }}
        >
          TOP BURNERS
        </h3>
        <button
          onClick={load}
          className="text-xs tracking-widest"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            background: 'transparent',
            color: C.ink,
            border: `1px solid ${C.line}`,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          {loading ? 'SCANNING…' : '↻'}
        </button>
      </div>
      <p
        className="text-xs mb-8"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          color: C.ink,
          opacity: 0.55,
          letterSpacing: '0.2em',
        }}
      >
        // last ~7 days · live from on-chain Transfer events
      </p>

      {error && (
        <p
          className="text-xs"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: C.red }}
        >
          ⚠ {error}
        </p>
      )}

      {loading && !rows && (
        <p
          className="text-xs"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: C.ink, opacity: 0.6 }}
        >
          scanning ~200,000 blocks of BSC, this takes 10-20 seconds…
        </p>
      )}

      {rows && rows.length === 0 && !loading && (
        <p
          className="text-xs"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: C.ink, opacity: 0.6 }}
        >
          no burns detected in this window. be the first.
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const pctOfMax = (r.amount / max) * 100;
              return (
                <a
                  key={r.addr}
                  href={`https://bscscan.com/token/${TOKEN_CONTRACT}?a=${r.addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block relative group"
                  style={{
                    background: C.bgSoft,
                    border: `1px solid ${C.line}`,
                    padding: '14px 18px',
                    textDecoration: 'none',
                    color: C.ink,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${pctOfMax}%`,
                      background: i === 0 ? C.yellow : `${C.yellow}33`,
                      opacity: 0.18,
                      transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                  <div
                    className="relative flex items-center justify-between gap-4"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span
                        style={{
                          fontFamily: 'Bowlby One, Impact, sans-serif',
                          fontSize: '22px',
                          color: i < 3 ? C.yellow : C.ink,
                          minWidth: 36,
                        }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate" style={{ fontSize: '13px' }}>
                        {shortAddr(r.addr)}
                      </span>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div
                        style={{
                          fontFamily: 'Bowlby One, Impact, sans-serif',
                          fontSize: '18px',
                          color: C.ink,
                        }}
                      >
                        {formatBig(r.amount)}
                      </div>
                      <div style={{ fontSize: '10px', opacity: 0.5 }}>BOB BURNED</div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
          <p
            className="mt-6 text-xs"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: C.ink,
              opacity: 0.5,
            }}
          >
            total burned by top 10: <span style={{ color: C.yellow }}>{formatBig(total)}</span> BOB
          </p>
        </>
      )}
    </section>
  );
}

// ============================================================
// MEME FACTORY
// ============================================================
const TEMPLATES = [
  { id: 'stripes', label: 'WARNING STRIPES', kind: 'stripes',
    autoText: '#FFFFFF', autoStroke: '#000000', bobHalo: '#0A0A09' },
  { id: 'yellow', label: 'BNB YELLOW', kind: 'solid', color: '#F0B90B',
    autoText: '#0A0A09', autoStroke: '#FFFFFF', bobHalo: null },
  { id: 'black', label: 'PURE BLACK', kind: 'solid', color: '#0A0A09',
    autoText: '#FFFFFF', autoStroke: '#000000', bobHalo: '#F5E6C8' },
  { id: 'cream', label: 'CREAM', kind: 'solid', color: '#F5E6C8',
    autoText: '#0A0A09', autoStroke: '#FFFFFF', bobHalo: null },
  { id: 'gradient', label: 'BUILDER GRADIENT', kind: 'gradient',
    autoText: '#FFFFFF', autoStroke: '#000000', bobHalo: '#0A0A09' },
];

function MemeFactory() {
  const canvasRef = useRef(null);
  const [topText, setTopText] = useState('BUILD WITH BOB');
  const [bottomText, setBottomText] = useState('MAKE BSC GREAT AGAIN');
  const [image, setImage] = useState(null);
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [mascot, setMascot] = useState(null);
  const fileInputRef = useRef(null);

  // Pre-load Bob mascot once on mount
  useEffect(() => {
    const img = new Image();
    img.onload = () => setMascot(img);
    img.src = '/bob-mascot.png';
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (image) {
      const ratio = Math.max(W / image.width, H / image.height);
      const w = image.width * ratio;
      const h = image.height * ratio;
      ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
    } else if (template.kind === 'solid') {
      ctx.fillStyle = template.color;
      ctx.fillRect(0, 0, W, H);
    } else if (template.kind === 'stripes') {
      const stripeW = 60;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((45 * Math.PI) / 180);
      ctx.translate(-W, -H);
      for (let x = 0; x < W * 3; x += stripeW * 2) {
        ctx.fillStyle = '#F0B90B';
        ctx.fillRect(x, 0, stripeW, H * 3);
        ctx.fillStyle = '#0A0A09';
        ctx.fillRect(x + stripeW, 0, stripeW, H * 3);
      }
      ctx.restore();
    } else if (template.kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#F0B90B');
      g.addColorStop(0.5, '#FF6B00');
      g.addColorStop(1, '#0A0A09');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Draw Bob mascot with signature yellow pastille — adaptive based on user image
    if (mascot) {
      let bobH, bobW, bobX, bobY;

      if (!image) {
        // No user image: Bob is centered, smaller, on a signature yellow pastille
        bobH = H * 0.32;
        bobW = (mascot.width / mascot.height) * bobH;
        bobX = (W - bobW) / 2;
        bobY = (H - bobH) / 2;
      } else {
        // User image: Bob is a small signature in the bottom-right
        bobH = H * 0.14;
        bobW = (mascot.width / mascot.height) * bobH;
        bobX = W - bobW - 40;
        bobY = H - bobH - 60;
      }

      // Draw signature yellow pastille behind Bob — same in both modes
      const cx = bobX + bobW / 2;
      const cy = bobY + bobH / 2;
      const r = Math.max(bobW, bobH) * 0.62;

      // Subtle outer ring for definition (especially on yellow templates)
      ctx.save();
      ctx.strokeStyle = '#0A0A09';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Yellow pastille fill
      ctx.save();
      ctx.fillStyle = '#F0B90B';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bob on top
      ctx.drawImage(mascot, bobX, bobY, bobW, bobH);
    }

    // Watermark
    ctx.save();
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = 'right';
    ctx.fillText('hivers.lab · $BOB', W - 24, H - 22);
    ctx.restore();

    const drawText = (text, isTop) => {
      if (!text) return;
      const upper = text.toUpperCase();
      let size = 64;
      ctx.font = `900 ${size}px "Anton", "Impact", "Arial Black", sans-serif`;
      while (ctx.measureText(upper).width > W - 60 && size > 24) {
        size -= 2;
        ctx.font = `900 ${size}px "Anton", "Impact", "Arial Black", sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(4, size / 14);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = textColor;
      const yPos = isTop ? size + 20 : H - 24;
      ctx.strokeText(upper, W / 2, yPos);
      ctx.fillText(upper, W / 2, yPos);
    };

    drawText(topText, true);
    drawText(bottomText, false);
  }, [image, template, topText, bottomText, textColor, strokeColor, mascot]);

  useEffect(() => {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    else draw();
  }, [draw]);

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => setImage(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const onDownload = () => {
    const link = document.createElement('a');
    link.download = `bob-meme-${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const onTweet = () => {
    const text = `${topText} — ${bottomText}\n\nMade with hivers.lab.\n#BuildOnBNB $BOB`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
      <div
        className="lg:col-span-2 p-6 space-y-6"
        style={{ borderRight: `2px solid ${C.line}` }}
      >
        <Field label="// top text">
          <input
            value={topText}
            onChange={(e) => setTopText(e.target.value)}
            className="w-full px-3 py-2"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.bgSoft,
              color: C.ink,
              border: `1px solid ${C.line}`,
              outline: 'none',
            }}
            maxLength={80}
          />
        </Field>
        <Field label="// bottom text">
          <input
            value={bottomText}
            onChange={(e) => setBottomText(e.target.value)}
            className="w-full px-3 py-2"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.bgSoft,
              color: C.ink,
              border: `1px solid ${C.line}`,
              outline: 'none',
            }}
            maxLength={80}
          />
        </Field>
        <Field label="// background image">
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-3 py-2 text-xs tracking-widest"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: C.yellow,
                color: '#0A0A09',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ↑ UPLOAD BOB IMAGE
            </button>
            {image && (
              <button
                onClick={() => {
                  setImage(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-3 py-2 text-xs tracking-widest"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'transparent',
                  color: C.ink,
                  border: `1px solid ${C.line}`,
                  cursor: 'pointer',
                }}
              >
                CLEAR
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onUpload}
            style={{ display: 'none' }}
          />
        </Field>
        <Field label="// or pick a template">
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setImage(null);
                  setTemplate(t);
                  if (t.autoText) setTextColor(t.autoText);
                  if (t.autoStroke) setStrokeColor(t.autoStroke);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-3 py-2 text-xs tracking-widest text-left"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  background: !image && template.id === t.id ? C.ink : 'transparent',
                  color: !image && template.id === t.id ? '#0A0A09' : C.ink,
                  border: `1px solid ${
                    !image && template.id === t.id ? C.ink : C.line
                  }`,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="// text color">
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="w-full h-10"
              style={{
                background: C.bgSoft,
                border: `1px solid ${C.line}`,
                cursor: 'pointer',
              }}
            />
          </Field>
          <Field label="// outline">
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              className="w-full h-10"
              style={{
                background: C.bgSoft,
                border: `1px solid ${C.line}`,
                cursor: 'pointer',
              }}
            />
          </Field>
        </div>
        <div className="space-y-2 pt-4" style={{ borderTop: `2px dashed ${C.line}` }}>
          <button
            onClick={onDownload}
            className="w-full px-4 py-3 text-sm tracking-widest"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.yellow,
              color: '#0A0A09',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ↓ STEP 1 — DOWNLOAD PNG
          </button>
          <button
            onClick={onTweet}
            className="w-full px-4 py-3 text-sm tracking-widest"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: 'transparent',
              color: C.ink,
              border: `1px solid ${C.line}`,
              cursor: 'pointer',
            }}
          >
            ✦ STEP 2 — POST ON X
          </button>
          <p
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: C.ink,
              opacity: 0.5,
              fontSize: '10px',
              lineHeight: 1.5,
              marginTop: 8,
              letterSpacing: '0.05em',
            }}
          >
            // X doesn't allow auto-attach. Download the PNG first, then drag &amp; drop it into the tweet.
          </p>
        </div>
      </div>

      <div
        className="lg:col-span-3 p-6 flex items-center justify-center"
        style={{ background: '#050505', minHeight: '500px' }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '520px',
            aspectRatio: '1 / 1',
            position: 'relative',
            boxShadow: `0 30px 80px -20px rgba(240, 185, 11, 0.15)`,
          }}
        >
          <canvas
            ref={canvasRef}
            width={1080}
            height={1080}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              border: `2px solid ${C.line}`,
            }}
          />
          <div
            className="absolute -top-3 -left-3 px-2 py-0.5 text-xs"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.yellow,
              color: '#0A0A09',
              fontWeight: 700,
              letterSpacing: '0.15em',
            }}
          >
            1080 × 1080
          </div>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <label
      className="block text-xs uppercase mb-2"
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        color: C.ink,
        opacity: 0.6,
        letterSpacing: '0.2em',
      }}
    >
      {label}
    </label>
    {children}
  </div>
);

// ============================================================
// MY BOB IMPACT — wallet card generator
// ============================================================
function MyImpact() {
  const [addr, setAddr] = useState('');
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cardRef = useRef(null);

  const onCheck = async () => {
    if (!isValidAddress(addr)) {
      setError('Invalid address. Format: 0x followed by 40 hex characters.');
      setBalance(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const b = await fetchBalanceOf(addr);
      setBalance(b);
    } catch (e) {
      setError(e.message || 'fetch failed');
      setBalance(null);
    } finally {
      setLoading(false);
    }
  };

  // Render card to canvas for download
  const onDownload = () => {
    const card = cardRef.current;
    if (!card) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    // bg
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, 1200, 630);

    // stripes top
    const stripeW = 30;
    for (let x = -200; x < 1400; x += stripeW * 2) {
      ctx.save();
      ctx.fillStyle = C.yellow;
      ctx.fillRect(x, 0, stripeW, 16);
      ctx.fillRect(x + stripeW, 0, stripeW, 16);
      ctx.restore();
    }
    ctx.fillStyle = C.bg;
    for (let x = -200; x < 1400; x += stripeW * 2) {
      ctx.fillRect(x + stripeW, 0, stripeW, 16);
    }

    // brand mark
    ctx.fillStyle = C.yellow;
    ctx.fillRect(80, 70, 8, 80);
    ctx.fillRect(60, 90, 50, 8);
    ctx.fillRect(54, 110, 60, 8);
    ctx.fillRect(60, 130, 50, 8);

    ctx.fillStyle = C.ink;
    ctx.font = '700 22px "JetBrains Mono", monospace';
    ctx.fillText('hivers.lab', 130, 105);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillStyle = C.ink;
    ctx.globalAlpha = 0.6;
    ctx.fillText('// $bob impact card', 130, 130);
    ctx.globalAlpha = 1;

    // Big title
    ctx.fillStyle = C.yellow;
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('// holdings on bnb chain', 80, 220);

    ctx.fillStyle = C.ink;
    ctx.font = '900 110px "Bowlby One", "Impact", sans-serif';
    ctx.fillText(formatBig(balance) + ' BOB', 80, 330);

    // Address
    ctx.font = '18px "JetBrains Mono", monospace';
    ctx.globalAlpha = 0.7;
    ctx.fillText(addr, 80, 380);
    ctx.globalAlpha = 1;

    // Tagline
    ctx.fillStyle = C.ink;
    ctx.font = '24px "JetBrains Mono", monospace';
    ctx.fillText("I'm building with $BOB.", 80, 470);
    ctx.fillStyle = C.yellow;
    ctx.fillText('Make BSC great again.', 80, 510);

    // Footer
    ctx.fillStyle = C.ink;
    ctx.globalAlpha = 0.5;
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('verify on bscscan · hivers.lab', 80, 590);

    // stripes bottom
    for (let x = -200; x < 1400; x += stripeW * 2) {
      ctx.fillStyle = C.yellow;
      ctx.globalAlpha = 1;
      ctx.fillRect(x, 614, stripeW, 16);
    }

    const link = document.createElement('a');
    link.download = `bob-impact-${addr.slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const onTweet = () => {
    if (balance === null) return;
    const text = `I'm building with $BOB.\n\nHoldings: ${formatBig(balance)} BOB on BNB Chain.\n\nMake BSC great again.\n\nCheck yours at hivers.lab\n\n#BuildOnBNB`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  return (
    <div className="px-6 py-12">
      <div className="max-w-3xl">
        <h3
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            fontSize: 'clamp(28px, 4vw, 44px)',
            color: C.ink,
            letterSpacing: '-0.01em',
            marginBottom: 8,
          }}
        >
          MY $BOB IMPACT
        </h3>
        <p
          className="text-xs uppercase mb-8"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: C.ink,
            opacity: 0.55,
            letterSpacing: '0.25em',
          }}
        >
          // paste a wallet address · generate a shareable card
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value.trim())}
            placeholder="0x..."
            className="flex-1 px-4 py-3"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.bgSoft,
              color: C.ink,
              border: `1px solid ${C.line}`,
              outline: 'none',
              fontSize: '14px',
            }}
            onKeyDown={(e) => e.key === 'Enter' && onCheck()}
          />
          <button
            onClick={onCheck}
            className="px-6 py-3 text-xs tracking-widest"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: C.yellow,
              color: '#0A0A09',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {loading ? 'CHECKING…' : 'CHECK ON-CHAIN'}
          </button>
        </div>

        {error && (
          <p
            className="text-xs mb-6"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: C.red }}
          >
            ⚠ {error}
          </p>
        )}

        {balance !== null && (
          <>
            {/* Card preview */}
            <div
              ref={cardRef}
              className="relative overflow-hidden"
              style={{
                background: C.bg,
                border: `2px solid ${C.line}`,
                aspectRatio: '1200 / 630',
                width: '100%',
                maxWidth: '720px',
                marginBottom: '24px',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '12px',
                  background: `repeating-linear-gradient(135deg, ${C.yellow} 0 18px, #0A0A09 18px 36px)`,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '12px',
                  background: `repeating-linear-gradient(135deg, ${C.yellow} 0 18px, #0A0A09 18px 36px)`,
                }}
              />
              <div className="p-6 md:p-10 relative h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <HiversMark size={28} />
                  <div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontWeight: 700,
                        color: C.ink,
                        fontSize: '14px',
                      }}
                    >
                      hivers.lab
                    </div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        color: C.ink,
                        opacity: 0.55,
                        fontSize: '11px',
                        letterSpacing: '0.2em',
                      }}
                    >
                      // $BOB IMPACT CARD
                    </div>
                  </div>
                </div>
                <div
                  className="text-xs uppercase mb-2"
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: C.yellow,
                    letterSpacing: '0.25em',
                  }}
                >
                  // holdings on bnb chain
                </div>
                <div
                  style={{
                    fontFamily: 'Bowlby One, Impact, sans-serif',
                    color: C.ink,
                    fontSize: 'clamp(36px, 7vw, 80px)',
                    lineHeight: 1,
                    marginBottom: 12,
                  }}
                >
                  {formatBig(balance)} BOB
                </div>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: C.ink,
                    opacity: 0.6,
                    fontSize: 'clamp(9px, 1.5vw, 12px)',
                    marginBottom: 'auto',
                    wordBreak: 'break-all',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {addr}
                </div>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: C.ink,
                    fontSize: '14px',
                    marginTop: 16,
                  }}
                >
                  I'm building with $BOB.
                  <br />
                  <span style={{ color: C.yellow }}>Make BSC great again.</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={onDownload}
                className="px-5 py-3 text-xs tracking-widest"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  background: C.yellow,
                  color: '#0A0A09',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ↓ STEP 1 — DOWNLOAD CARD
              </button>
              <button
                onClick={onTweet}
                className="px-5 py-3 text-xs tracking-widest"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'transparent',
                  color: C.ink,
                  border: `1px solid ${C.line}`,
                  cursor: 'pointer',
                }}
              >
                ✦ STEP 2 — POST ON X
              </button>
            </div>
            <p
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                color: C.ink,
                opacity: 0.5,
                fontSize: '11px',
                marginTop: 12,
                letterSpacing: '0.05em',
              }}
            >
              // X doesn't allow auto-attach. Download the card first, then drag &amp; drop it into the tweet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// FOOTER + COMMUNITY
// ============================================================
function Footer({ githubUrl }) {
  return (
    <>
      <section className="px-6 py-12" style={{ background: C.bgSoft }}>
        <div
          className="text-xs uppercase mb-6"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: C.yellow,
            letterSpacing: '0.3em',
          }}
        >
          // join the build
        </div>
        <h3
          style={{
            fontFamily: 'Bowlby One, Impact, sans-serif',
            fontSize: 'clamp(28px, 5vw, 56px)',
            color: C.ink,
            lineHeight: 1,
            marginBottom: 32,
            letterSpacing: '-0.02em',
          }}
        >
          BOB IS COMMUNITY-OWNED.<br />
          <span style={{ color: C.yellow }}>SO IS THIS LAB.</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <a
            href="https://t.me/BuildOnBNBBOB"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-6"
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              textDecoration: 'none',
              color: C.ink,
            }}
          >
            <div style={{ fontFamily: 'Bowlby One, Impact, sans-serif', fontSize: 22 }}>
              TELEGRAM →
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              official $BOB community
            </div>
          </a>
          <a
            href="https://x.com/BuildOnBNBBOB"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-6"
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              textDecoration: 'none',
              color: C.ink,
            }}
          >
            <div style={{ fontFamily: 'Bowlby One, Impact, sans-serif', fontSize: 22 }}>
              X / TWITTER →
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              follow @BuildOnBNBBOB
            </div>
          </a>
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-6"
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              textDecoration: 'none',
              color: C.ink,
            }}
          >
            <div style={{ fontFamily: 'Bowlby One, Impact, sans-serif', fontSize: 22 }}>
              GITHUB →
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              code is open · fork freely
            </div>
          </a>
          <a
            href="https://t.me/hivers_Builds"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-6"
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              textDecoration: 'none',
              color: C.ink,
            }}
          >
            <div style={{ fontFamily: 'Bowlby One, Impact, sans-serif', fontSize: 22 }}>
              DM HIVERS →
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              feedback · suggestions · bugs
            </div>
            </a>
        </div>
      </section>

      <StripeBar />

      <footer
        className="px-6 py-10"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: C.ink }}
      >
        <div className="flex items-center gap-3 mb-4">
          <HiversMark size={24} />
          <span style={{ fontWeight: 700 }}>hivers.lab</span>
          <span style={{ opacity: 0.4 }}>v0.1</span>
        </div>
        <p style={{ fontSize: 12, opacity: 0.55, lineHeight: 1.7, maxWidth: '700px' }}>
          Independent fan project. Not affiliated with Binance or the BOB community core
          team. Token data fetched from public BSC RPCs. Always verify on BscScan. $BOB is
          a memecoin — crypto is volatile and you can lose everything. Nothing here is
          financial advice.
        </p>
        <p style={{ fontSize: 11, opacity: 0.4, marginTop: 16, letterSpacing: '0.2em' }}>
          // BUILT BY @HIVERS_BUILDS · OPEN-SOURCE · NO PROMISES
        </p>
      </footer>
    </>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [tab, setTab] = useState('burn');

  // ⚠ Replace with your real GitHub URL once the repo is created
  const GITHUB_URL = 'https://github.com/hiversBuilds/hivers-lab';

  return (
    <div
      className="min-h-screen w-full relative"
      style={{
        background: C.bg,
        color: C.ink,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bowlby+One&family=Anton&family=JetBrains+Mono:wght@400;700&display=swap');
        @keyframes hivpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes scrollx { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        ::selection { background: ${C.yellow}; color: #0A0A09; }
        html { scroll-behavior: smooth; }
        /* Tabs: long label on desktop, short on mobile */
        .hivlab-tab-short { display: none; }
        @media (max-width: 640px) {
          .hivlab-tab-long { display: none; }
          .hivlab-tab-short { display: inline; }
          .hivlab-tab { padding: 12px 4px !important; font-size: 10px !important; letter-spacing: 0.08em !important; }
        }
        /* MetaCell: kill orphan left border on mobile when stacked */
        @media (max-width: 768px) {
          .hivlab-metacell { border-left: none !important; border-top: 2px solid ${C.line} !important; }
        }
        /* Hide header GitHub link on small screens (still in footer) */
        @media (max-width: 640px) {
          .hivlab-github-link { display: none !important; }
        }
      `}</style>

      <StripeBar />

      <header
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          borderBottom: `2px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <HiversMark size={36} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'Bowlby One, Impact, sans-serif',
                fontSize: 22,
                lineHeight: 1,
                letterSpacing: '-0.01em',
              }}
            >
              HIVERS.LAB
            </div>
            <div
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                opacity: 0.55,
                letterSpacing: '0.25em',
                marginTop: 4,
              }}
            >
              tools for $bob · v0.1
            </div>
          </div>
        </div>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hivlab-github-link"
          style={{
            color: C.ink,
            border: `1px solid ${C.line}`,
            textDecoration: 'none',
            padding: '8px 12px',
            fontSize: '11px',
            letterSpacing: '0.2em',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          GITHUB ↗
        </a>
      </header>

      <div
        style={{
          background: C.bgSoft,
          borderBottom: `2px solid ${C.line}`,
          padding: '8px 0',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            animation: 'scrollx 40s linear infinite',
            paddingLeft: '100%',
          }}
        >
          {Array.from({ length: 2 }).map((_, i) => (
            <span
              key={i}
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                opacity: 0.6,
                letterSpacing: '0.3em',
              }}
            >
              ▲ BUILD WITH BOB &nbsp;·&nbsp; MAKE BSC GREAT AGAIN &nbsp;·&nbsp; COMMUNITY OWNED
              &nbsp;·&nbsp; ▲ BURN · BUILD · REPEAT &nbsp;·&nbsp; THIS IS NOT FINANCIAL
              ADVICE &nbsp;·&nbsp; ▲ &nbsp;
            </span>
          ))}
        </div>
      </div>

      <Hero />
      <AboutBob />

      <div id="tools">
        <nav style={{ display: 'flex', borderBottom: `2px solid ${C.line}` }}>
          <TabBtn active={tab === 'burn'} onClick={() => setTab('burn')} label="01 / BURN TRACKER" short="01 / BURN" />
          <TabBtn active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')} label="02 / LEADERBOARD" short="02 / TOP" />
          <TabBtn active={tab === 'meme'} onClick={() => setTab('meme')} label="03 / MEME FACTORY" short="03 / MEMES" />
          <TabBtn active={tab === 'impact'} onClick={() => setTab('impact')} label="04 / MY IMPACT" short="04 / IMPACT" />
        </nav>
        <main>
          {tab === 'burn' && <BurnTracker />}
          {tab === 'leaderboard' && <BurnLeaderboard />}
          {tab === 'meme' && <MemeFactory />}
          {tab === 'impact' && <MyImpact />}
        </main>
      </div>

      <Footer githubUrl={GITHUB_URL} />
    </div>
  );
}

const TabBtn = ({ active, onClick, label, short }) => (
  <button
    onClick={onClick}
    className="hivlab-tab"
    style={{
      fontFamily: 'JetBrains Mono, monospace',
      background: active ? C.yellow : 'transparent',
      color: active ? '#0A0A09' : C.ink,
      border: 'none',
      borderRight: `2px solid ${C.line}`,
      cursor: 'pointer',
      fontWeight: active ? 700 : 400,
      letterSpacing: '0.14em',
      flex: '1 1 0',
      minWidth: 0,
      whiteSpace: 'nowrap',
      padding: '14px 8px',
      fontSize: '11px',
    }}
  >
    <span className="hivlab-tab-long">{label}</span>
    <span className="hivlab-tab-short">{short || label}</span>
  </button>
);