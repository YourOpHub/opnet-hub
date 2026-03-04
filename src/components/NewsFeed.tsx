import React, { useState, useEffect, useCallback } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, POOL_ADDRESS } from '../contracts';

/* ═══════════════════════════════════════════════════════════════
   News Feed — Live on-chain activity + curated social posts
   ═══════════════════════════════════════════════════════════════ */

type FeedMode = 'live' | 'social';

/* ── On-chain activity types ── */
interface ActivityItem {
    id: string;
    type: 'block' | 'tx' | 'pool' | 'mempool' | 'price' | 'epoch';
    title: string;
    detail: string;
    time: number; // timestamp ms
    value?: string;
    color: string;
    icon: string;
    link?: string;
}

/* ── Social post types (curated) ── */
interface SocialPost {
    id: number;
    account: string;
    handle: string;
    avatar: string;
    text: string;
    time: string;
    likes: number;
    retweets: number;
    tag?: string;
    pinned?: boolean;
    url: string;
}

const SOCIAL_FEED: SocialPost[] = [
    {
        id: 1, account: 'OP_NET', handle: '@opaborat', avatar: '\u{1F517}',
        pinned: true, tag: 'Breaking',
        text: '\u{1F6A8} OP_NET Mainnet Beta goes live March 15th.\n\nAfter 8 months of testnet, 3,500+ blocks processed, and zero consensus failures \u2014 we\'re ready.\n\nBitcoin L1 smart contracts. Post-quantum security. Deterministic state.',
        time: '2h', likes: 2847, retweets: 891, url: 'https://docs.opnet.org',
    },
    {
        id: 2, account: 'MotoSwap', handle: '@maboratmarket', avatar: '\u{1F3CD}\uFE0F',
        pinned: true, tag: 'DeFi',
        text: '\u{1F525} MotoSwap V3 is HERE.\n\nConcentrated liquidity on Bitcoin L1.\n\n\u2022 Tick-based positions like Uni V3\n\u2022 4x capital efficiency vs V2\n\u2022 Consensus-verified prices (no oracle manipulation)\n\nThe DEX endgame.',
        time: '1h', likes: 3201, retweets: 1102, url: 'https://motoswap.org',
    },
    {
        id: 3, account: 'Vibecode', handle: '@vibaborat', avatar: '\u26A1',
        tag: 'Hackathon',
        text: '\u{1F3C6} VIBECODE CHALLENGE \u2014 WEEK 4 RESULTS\n\n32 projects submitted. 8 finalists.\n\n\u{1F947} OpLend \u2014 Lending with flash loans\n\u{1F948} BitNFT \u2014 On-chain NFT marketplace\n\u{1F949} OpDAO \u2014 Governance for Bitcoin\n\nPrizes: 50K PILL + 5 Motocats NFTs',
        time: '3h', likes: 1567, retweets: 678, url: 'https://vibecode.finance',
    },
    {
        id: 4, account: 'Dev', handle: '@opnet_dev', avatar: '\u{1F916}',
        tag: 'Tutorial',
        text: '\u{1F9F5} Deploy your first OP-20 token in 5 minutes\n\n1/ Install the OP_NET CLI\n2/ Write a MintableToken in AssemblyScript (12 lines)\n3/ Compile to WASM\n4/ Deploy with ML-DSA keys\n5/ Verify on OPScan\n\nYes, it\'s really that simple.',
        time: '2h', likes: 1876, retweets: 654, url: 'https://docs.opnet.org',
    },
    {
        id: 5, account: 'OP_NET', handle: '@opaborat', avatar: '\u{1F517}',
        tag: 'Security',
        text: 'ML-DSA (Module-Lattice Digital Signatures) is now MANDATORY for all OP_NET interactions.\n\nWhile Ethereum debates quantum resistance timelines, every OP_NET contract is quantum-proof TODAY.\n\nNIST FIPS 204 compliant. Not optional.',
        time: '8h', likes: 967, retweets: 312, url: 'https://docs.opnet.org',
    },
    {
        id: 6, account: 'MotoSwap', handle: '@maboratmarket', avatar: '\u{1F3CD}\uFE0F',
        tag: 'Stats',
        text: '\u{1F4C8} MINE/VIBE pool stats:\n\nRate: 1 MINE = 5 VIBE\nFee: 0.3% (all to LPs)\n\nThe deepest liquidity pool on Bitcoin L1. And it\'s just the testnet.',
        time: '9h', likes: 987, retweets: 234, url: 'https://motoswap.org',
    },
    {
        id: 7, account: 'Dev', handle: '@opnet_dev', avatar: '\u{1F916}',
        tag: 'Tip',
        text: '\u26A0\uFE0F Common mistake: using `signer` in frontend transaction params.\n\nThe wallet handles signing. Use InteractionParametersWithoutSigner.\n\nCorrect: { refundTo, network, feeRate, priorityFee }\n\nNo signer. No mldsaSigner.',
        time: '11h', likes: 432, retweets: 167, url: 'https://docs.opnet.org',
    },
];

const SOCIAL_LINKS = [
    { name: 'OP_NET', icon: '\u{1D54F}', url: 'https://x.com/opaborat', handle: '@opaborat', color: '#F7931A' },
    { name: 'MotoSwap', icon: '\u{1D54F}', url: 'https://x.com/maboratmarket', handle: '@maboratmarket', color: '#0ea5e9' },
    { name: 'Telegram', icon: '\u2708', url: 'https://t.me/opaborat', handle: 't.me/opaborat', color: '#38bdf8' },
    { name: 'Discord', icon: '\u{1F4AC}', url: 'https://discord.gg/opnet', handle: 'discord.gg/opnet', color: '#a78bfa' },
];

function timeAgo(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
}

function formatCount(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

/* ── Live Activity Feed ── */
function LiveFeed() {
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(0);
    const [stats, setStats] = useState({ block: 0, txCount: 0, mempool: 0, btcPrice: 0 });

    const fetchLiveData = useCallback(async () => {
        const now = Date.now();
        const items: ActivityItem[] = [];

        try {
            // Fetch all data in parallel
            const [height, gasParams, mempoolInfo, btcPrice] = await Promise.all([
                opnet.getBlockHeight().catch(() => 0),
                opnet.getGasParameters().catch(() => null),
                opnet.getMempoolInfo().catch(() => null),
                fetchBtcPrice().catch(() => ({ usd: 0, usd_24h_change: 0 })),
            ]);

            // Block height activity
            if (height > 0) {
                items.push({
                    id: `block-${height}`, type: 'block',
                    title: `Block #${height.toLocaleString()} confirmed`,
                    detail: gasParams?.blockNumber ? `Base gas: ${Number(BigInt(gasParams.baseGas || '0')).toLocaleString()}` : 'New block on Bitcoin L1',
                    time: now, color: 'var(--g)', icon: '\u26D3\uFE0F',
                    link: `https://opscan.org/blocks/${height}?network=op_testnet`,
                });

                // Fetch recent blocks for activity
                for (let i = height; i > Math.max(0, height - 5); i--) {
                    try {
                        const block = await opnet.getBlockByNumber(i, false);
                        if (block) {
                            const txCount = Array.isArray(block.transactions) ? (block.transactions as unknown[]).length : 0;
                            if (txCount > 0) {
                                items.push({
                                    id: `block-txs-${i}`, type: 'block',
                                    title: `Block #${i.toLocaleString()} \u2014 ${txCount} transaction${txCount > 1 ? 's' : ''}`,
                                    detail: block.hash ? `Hash: ${String(block.hash).slice(0, 16)}...` : '',
                                    time: now - (height - i) * 30000, // ~30s per block
                                    color: 'var(--c)', icon: '\u{1F4E6}',
                                    link: `https://opscan.org/blocks/${i}?network=op_testnet`,
                                });
                            }
                        }
                    } catch { /* continue */ }
                }
            }

            // Pool reserves check
            try {
                const res = await opnet.callContract(POOL_ADDRESS, '06374bfc');
                if (res) {
                    const hex = res.startsWith('0x') ? res.slice(2) : res;
                    if (hex.length >= 128) {
                        const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
                        const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
                        if (r0 > 0 && r1 > 0) {
                            const rate = r1 / r0;
                            items.push({
                                id: `pool-${now}`, type: 'pool',
                                title: 'MINE/VIBE Pool Active',
                                detail: `Reserves: ${(r0 / 1e6).toFixed(2)}M MINE / ${(r1 / 1e6).toFixed(2)}M VIBE \u2022 Rate: 1:${rate.toFixed(2)}`,
                                time: now - 5000, color: 'var(--o)', icon: '\u{1F4CA}',
                            });
                        }
                    }
                }
            } catch { /* ok */ }

            // Token supply data
            for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
                try {
                    const supply = await opnet.getTokenTotalSupply(tok.address);
                    if (supply > 0n) {
                        const human = Number(supply) / Math.pow(10, tok.decimals);
                        items.push({
                            id: `supply-${sym}-${now}`, type: 'tx',
                            title: `${sym} Supply: ${human >= 1e6 ? (human / 1e6).toFixed(2) + 'M' : human.toLocaleString()}`,
                            detail: `${tok.name} \u2022 ${tok.decimals} decimals \u2022 On-chain verified`,
                            time: now - 10000, color: sym === 'MINE' ? 'var(--y)' : 'var(--c)',
                            icon: tok.icon,
                        });
                    }
                } catch { /* ok */ }
            }

            // Mempool activity
            if (mempoolInfo) {
                const count = (mempoolInfo as Record<string, number>).opnetCount ?? (mempoolInfo as Record<string, number>).count ?? 0;
                items.push({
                    id: `mempool-${now}`, type: 'mempool',
                    title: `Mempool: ${count} pending transaction${count !== 1 ? 's' : ''}`,
                    detail: 'Waiting for next block confirmation',
                    time: now - 2000, color: 'var(--y)', icon: '\u23F3',
                });
                setStats(prev => ({ ...prev, mempool: count }));
            }

            // BTC price
            if (btcPrice.usd > 0) {
                const change = btcPrice.usd_24h_change;
                items.push({
                    id: `btc-${now}`, type: 'price',
                    title: `Bitcoin: $${btcPrice.usd.toLocaleString()}`,
                    detail: `24h change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
                    time: now - 15000,
                    color: change >= 0 ? 'var(--g)' : 'var(--r)',
                    icon: '\u20BF',
                });
                setStats(prev => ({ ...prev, btcPrice: btcPrice.usd }));
            }

            // Epoch info
            try {
                const epoch = await opnet.getLatestEpoch();
                if (epoch && typeof epoch === 'object') {
                    const epochNum = (epoch as Record<string, unknown>).epochNumber ?? (epoch as Record<string, unknown>).number;
                    if (epochNum) {
                        items.push({
                            id: `epoch-${now}`, type: 'epoch',
                            title: `Epoch #${epochNum} active`,
                            detail: 'Checkpoint-based finality \u2022 5-block epochs',
                            time: now - 20000, color: 'var(--p)', icon: '\u{1F30A}',
                        });
                    }
                }
            } catch { /* ok */ }

            // Sort by time descending
            items.sort((a, b) => b.time - a.time);

            setActivities(items);
            setStats(prev => ({ ...prev, block: height, txCount: items.filter(i => i.type === 'block').length }));
            setLastUpdate(now);
        } catch (e) {
            console.error('Feed fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLiveData();
        const iv = setInterval(fetchLiveData, 30000);
        return () => clearInterval(iv);
    }, [fetchLiveData]);

    return (
        <div>
            {/* Live stats bar */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16,
            }}>
                {[
                    { label: 'Block Height', value: stats.block > 0 ? `#${stats.block.toLocaleString()}` : '...', color: 'var(--g)' },
                    { label: 'BTC Price', value: stats.btcPrice > 0 ? `$${stats.btcPrice.toLocaleString()}` : '...', color: 'var(--o)' },
                    { label: 'Pending TXs', value: String(stats.mempool), color: 'var(--y)' },
                    { label: 'Last Update', value: lastUpdate > 0 ? timeAgo(lastUpdate) : '...', color: 'var(--c)' },
                ].map(s => (
                    <div key={s.label} className="stat-card">
                        <div className="stat-label">{s.label}</div>
                        <div className="stat-value" style={{ color: s.color, fontSize: '.88rem' }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Refresh button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--g)', boxShadow: '0 0 6px var(--g)', marginRight: 6, animation: 'blink 2s infinite' }} />
                    Live on-chain activity
                </div>
                <button onClick={fetchLiveData} className="btn-s" style={{ padding: '5px 14px', fontSize: '.65rem' }}>
                    {loading ? '\u23F3' : '\u{1F504}'} Refresh
                </button>
            </div>

            {/* Activity list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {loading && activities.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="skeleton-block" style={{ height: 72, borderRadius: 16 }} />
                    ))
                ) : activities.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--t4)' }}>
                        No activity found. Network may be paused.
                    </div>
                ) : (
                    activities.map(item => (
                        <div key={item.id} className="P" style={{ padding: '14px 18px', cursor: item.link ? 'pointer' : 'default' }}
                            onClick={() => { if (item.link) window.open(item.link, '_blank'); }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 38, height: 38, borderRadius: 12, display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                    background: `color-mix(in srgb, ${item.color} 10%, transparent)`,
                                    fontSize: '1.1rem', flexShrink: 0,
                                }}>
                                    {item.icon}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '.8rem', color: 'var(--w)', marginBottom: 2 }}>
                                        {item.title}
                                    </div>
                                    <div style={{ fontSize: '.68rem', color: 'var(--t3)', lineHeight: 1.4 }}>
                                        {item.detail}
                                    </div>
                                </div>
                                <div style={{ fontSize: '.58rem', color: 'var(--t4)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {timeAgo(item.time)}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

/* ── Social Post Card ── */
function PostCard({ item }: { item: SocialPost }) {
    return (
        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div className="Pg" style={{ padding: '16px 18px', transition: '.2s', cursor: 'pointer' }}>
                {item.pinned && (
                    <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{'\u{1F4CC}'}</span> Pinned post
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255,255,255,.04)', fontSize: '1.1rem', flexShrink: 0,
                    }}>{item.avatar}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: '.78rem', color: '#fff' }}>{item.account}</span>
                            <span style={{ fontSize: '.65rem', color: 'var(--t3)' }}>{item.handle}</span>
                            <span style={{ fontSize: '.58rem', color: 'var(--t4)' }}>\u00B7 {item.time}</span>
                        </div>
                    </div>
                    {item.tag && <span className="ntag">{item.tag}</span>}
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--t1)', lineHeight: 1.55, whiteSpace: 'pre-line', marginBottom: 8, wordBreak: 'break-word' }}>
                    {item.text}
                </div>
                <div style={{ display: 'flex', gap: 20, fontSize: '.62rem', color: 'var(--t4)' }}>
                    <span>{'\u{1F4AC}'} {formatCount(item.retweets)}</span>
                    <span>{'\u2764\uFE0F'} {formatCount(item.likes)}</span>
                </div>
            </div>
        </a>
    );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN NEWS FEED
   ═══════════════════════════════════════════════════════════════ */
const NewsFeed: React.FC = () => {
    const [mode, setMode] = useState<FeedMode>('live');
    useEffect(() => { localStorage.setItem('hub_news_visited', '1'); }, []);

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', padding: '20px 0 16px' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, background: 'linear-gradient(135deg, #F7931A, #ffab40)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Network Feed
                </div>
                <div style={{ fontSize: '.75rem', color: 'var(--t3)', marginTop: 4 }}>
                    Live on-chain activity & ecosystem news
                </div>
            </div>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <button className={`fbn ${mode === 'live' ? 'on' : ''}`}
                    onClick={() => setMode('live')}
                    style={{ padding: '8px 20px', fontSize: '.75rem' }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: mode === 'live' ? 'var(--g)' : 'var(--t4)', marginRight: 6, boxShadow: mode === 'live' ? '0 0 6px var(--g)' : 'none' }} />
                    Live Activity
                </button>
                <button className={`fbn ${mode === 'social' ? 'on' : ''}`}
                    onClick={() => setMode('social')}
                    style={{ padding: '8px 20px', fontSize: '.75rem' }}>
                    Social Feed
                </button>
            </div>

            {/* Content */}
            {mode === 'live' ? (
                <LiveFeed />
            ) : (
                <div>
                    {/* Social links */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                        {SOCIAL_LINKS.map(s => (
                            <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                                style={{
                                    padding: '6px 14px', borderRadius: 10, textDecoration: 'none',
                                    background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
                                    color: 'var(--t2)', fontSize: '.65rem', fontWeight: 600, transition: '.2s',
                                    display: 'flex', alignItems: 'center', gap: 5,
                                }}>
                                <span style={{ fontSize: '.7rem' }}>{s.icon}</span>
                                {s.handle} \u2197
                            </a>
                        ))}
                    </div>

                    {/* Posts */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {SOCIAL_FEED.filter(p => p.pinned).map(item => <PostCard key={item.id} item={item} />)}
                        {SOCIAL_FEED.filter(p => !p.pinned).map(item => <PostCard key={item.id} item={item} />)}
                    </div>
                </div>
            )}
        </div>
    );
};
export default NewsFeed;
