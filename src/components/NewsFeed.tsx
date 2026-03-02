import React, { useState, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   Twitter-style feed with posts, replies, quotes, comments
   Each account has its own hot events and contextual content
   ═══════════════════════════════════════════════════════════════ */

type PostType = 'post' | 'reply' | 'quote' | 'comment';

interface FeedItem {
    id: number;
    account: string;
    handle: string;
    avatar: string;
    type: PostType;
    text: string;
    time: string;
    likes: number;
    retweets: number;
    replies: number;
    url: string;
    tag?: string;
    pinned?: boolean;
    // For quotes — the original post being quoted
    quotedAccount?: string;
    quotedHandle?: string;
    quotedText?: string;
    // For replies — who they're replying to
    replyTo?: string;
    // Media
    media?: string;
}

const FEED: FeedItem[] = [
    // ── OP_NET (@opaborat) — protocol news, tech breakthroughs, ecosystem milestones ──
    {
        id: 1, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'post', pinned: true, tag: 'Breaking',
        text: '🚨 OP_NET Mainnet Beta goes live March 15th.\n\nAfter 8 months of testnet, 3,500+ blocks processed, and zero consensus failures — we\'re ready.\n\nBitcoin L1 smart contracts. Post-quantum security. Deterministic state.\n\nThis is not a sidechain. This is Bitcoin.',
        time: '2h', likes: 2847, retweets: 891, replies: 342, url: 'https://docs.opnet.org',
    },
    {
        id: 2, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'reply', replyTo: '@VitalikButerin',
        text: '"Bitcoin can\'t have smart contracts" — We just proved otherwise.\n\nOP_NET runs WASM contracts directly on Bitcoin L1 via Tapscript calldata. No bridge. No sidechain. No trust assumptions.\n\nEvery node derives identical state. Mathematical certainty > indexer hope.',
        time: '4h', likes: 5103, retweets: 1247, replies: 687, url: 'https://x.com/opaborat',
    },
    {
        id: 3, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'quote', quotedAccount: 'Bitcoin Magazine', quotedHandle: '@BitcoinMagazine',
        quotedText: 'BREAKING: Bitcoin surpasses $105K. ETF inflows hit $2.1B in a single day.',
        text: 'And yet most of this capital has nowhere to go on-chain.\n\nWith OP_NET, $105K Bitcoin isn\'t just a store of value — it\'s programmable capital.\n\nDeFi. NFTs. DAOs. All on L1. All post-quantum secured.',
        time: '5h', likes: 1892, retweets: 543, replies: 198, url: 'https://x.com/opaborat', tag: 'Markets',
    },
    {
        id: 4, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'comment',
        text: 'ML-DSA (Module-Lattice Digital Signatures) is now MANDATORY for all OP_NET interactions.\n\nWhile Ethereum debates quantum resistance timelines, every OP_NET contract is quantum-proof TODAY.\n\nNIST FIPS 204 compliant. Not optional. Not someday.',
        time: '8h', likes: 967, retweets: 312, replies: 89, url: 'https://docs.opnet.org', tag: 'Security',
    },
    {
        id: 5, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'reply', replyTo: '@saborat',
        text: 'Epoch 704 just finalized. 3,520 blocks deep.\n\nEvery epoch = 5-block checkpoint. State attestation 4 epochs deep means forks are mathematically impossible after ~21 blocks.\n\nSHA-1 PoW miners earn rewards but CANNOT influence consensus. That\'s the design.',
        time: '12h', likes: 634, retweets: 189, replies: 67, url: 'https://x.com/opaborat',
    },
    {
        id: 6, account: 'OP_NET', handle: '@opaborat', avatar: '🔗',
        type: 'post',
        text: '📊 Testnet Stats (Week 12):\n\n• 3,526 blocks processed\n• 14,200+ transactions\n• 47 unique contracts deployed\n• 0 consensus disagreements\n• 12 active dApps in production\n\nThe network has never been more stable. Mainnet is inevitable.',
        time: '1d', likes: 1543, retweets: 478, replies: 156, url: 'https://testnet.opscan.org', tag: 'Stats',
    },

    // ── MotoSwap (@maboratmarket) — DEX updates, liquidity events, trading features ──
    {
        id: 10, account: 'MotoSwap', handle: '@maboratmarket', avatar: '🏍️',
        type: 'post', pinned: true, tag: 'DeFi',
        text: '🔥 MotoSwap V3 is HERE.\n\nConcentrated liquidity on Bitcoin L1. Yes, you read that right.\n\n• Tick-based positions like Uni V3\n• 4x capital efficiency vs V2\n• Consensus-verified prices (no oracle manipulation)\n• All on Bitcoin. All trustless.\n\nThe DEX endgame.',
        time: '1h', likes: 3201, retweets: 1102, replies: 445, url: 'https://motoswap.org',
    },
    {
        id: 11, account: 'MotoSwap', handle: '@maboratmarket', avatar: '🏍️',
        type: 'quote', quotedAccount: 'OP_NET', quotedHandle: '@opaborat',
        quotedText: 'OP_NET Mainnet Beta goes live March 15th.',
        text: 'MotoSwap will be the FIRST DEX on OP_NET mainnet.\n\nDay 1 pools:\n• BTC/WBTC\n• MINE/VIBE\n• PILL/BTC\n\nLP farming starts block 1. Early LPs get 3x MOTO rewards for 30 days.\n\nWho\'s providing liquidity? 👇',
        time: '3h', likes: 2456, retweets: 789, replies: 534, url: 'https://motoswap.org', tag: 'Launch',
    },
    {
        id: 12, account: 'MotoSwap', handle: '@maboratmarket', avatar: '🏍️',
        type: 'reply', replyTo: '@CryptoWhale',
        text: 'Yes, swap prices on MotoSwap are cryptographically proven correct.\n\nNo MEV. No sandwich attacks. No front-running.\n\nBecause every swap is verified by OP_NET consensus nodes. If the math doesn\'t check out, the transaction reverts.\n\nTry doing that on Uniswap.',
        time: '6h', likes: 1876, retweets: 567, replies: 234, url: 'https://x.com/maboratmarket',
    },
    {
        id: 13, account: 'MotoSwap', handle: '@maboratmarket', avatar: '🏍️',
        type: 'comment',
        text: '📈 MINE/VIBE pool stats:\n\nReserves: 5M MINE / 25M VIBE\nRate: 1 MINE = 5 VIBE\nFee: 0.3% (all to LPs)\n24h volume: 847K MINE equivalent\n\nThe deepest liquidity pool on Bitcoin L1. And it\'s just the testnet.',
        time: '9h', likes: 987, retweets: 234, replies: 123, url: 'https://motoswap.org', tag: 'Stats',
    },
    {
        id: 14, account: 'MotoSwap', handle: '@maboratmarket', avatar: '🏍️',
        type: 'post',
        text: 'NativeSwap Factory is LIVE on testnet.\n\nAnyone can create a liquidity pool for ANY OP-20 token pair. No permission needed.\n\n1. Pick two tokens\n2. Set initial liquidity\n3. Deploy\n\nYour pool earns 0.3% on every swap. Fully on-chain. Fully trustless.\n\nLFG 🏍️',
        time: '14h', likes: 1234, retweets: 456, replies: 178, url: 'https://motoswap.org',
    },

    // ── Vibecode (@vibaborat) — hackathon updates, builder spotlights, community ──
    {
        id: 20, account: 'Vibecode', handle: '@vibaborat', avatar: '⚡',
        type: 'post', pinned: true, tag: 'Hackathon',
        text: '🏆 VIBECODE CHALLENGE — WEEK 4 RESULTS\n\n32 projects submitted. 8 finalists selected.\n\nTop 3:\n🥇 OpLend — Lending protocol with flash loans\n🥈 BitNFT — Fully on-chain NFT marketplace\n🥉 OpDAO — Governance framework for Bitcoin\n\nPrizes: 50K PILL + 5 Motocats NFTs\n\nWeek 5 theme: CROSS-CHAIN BRIDGES',
        time: '3h', likes: 1567, retweets: 678, replies: 312, url: 'https://vibecode.finance',
    },
    {
        id: 21, account: 'Vibecode', handle: '@vibaborat', avatar: '⚡',
        type: 'quote', quotedAccount: 'OpLend', quotedHandle: '@OpLendBTC',
        quotedText: 'We just deployed flash loans on Bitcoin L1. No collateral needed for same-block repayment. Built on OP_NET.',
        text: 'This is INSANE. Flash loans on Bitcoin.\n\nThe Vibecode Challenge is producing real innovation. OpLend went from idea to working prototype in 6 days.\n\n@opaborat — your platform is enabling things nobody thought possible on Bitcoin.',
        time: '5h', likes: 2134, retweets: 876, replies: 345, url: 'https://vibecode.finance',
    },
    {
        id: 22, account: 'Vibecode', handle: '@vibaborat', avatar: '⚡',
        type: 'reply', replyTo: '@newdev_btc',
        text: 'You don\'t need to know Solidity. You don\'t even need to know AssemblyScript.\n\nBob AI writes your entire contract from a plain English description. Then compiles to WASM. Then deploys to Bitcoin L1.\n\nSeriously — try it: ai.opnet.org\n\nThe future of building is conversational.',
        time: '7h', likes: 876, retweets: 234, replies: 156, url: 'https://ai.opnet.org',
    },
    {
        id: 23, account: 'Vibecode', handle: '@vibaborat', avatar: '⚡',
        type: 'comment',
        text: 'Builder spotlight: @motocats_nft\n\nThey built a fully on-chain NFT collection on Bitcoin using OP_NET. Not inscriptions — actual smart contract NFTs with royalties, traits, and marketplace.\n\n"We considered Ethereum but the gas was insane. On OP_NET we deployed for < $2."\n\nBased.',
        time: '10h', likes: 1432, retweets: 543, replies: 267, url: 'https://vibecode.finance',
    },

    // ── Community / Dev (@opnet_dev) — tutorials, tips, technical deep dives ──
    {
        id: 30, account: 'Dev', handle: '@opnet_dev', avatar: '🤖',
        type: 'post', tag: 'Tutorial',
        text: '🧵 THREAD: Deploy your first OP-20 token in 5 minutes\n\n1/ Install the OP_NET CLI\n2/ Write a MintableToken in AssemblyScript (12 lines)\n3/ Compile to WASM\n4/ Deploy with ML-DSA keys\n5/ Verify on OPScan\n\nFull guide with code 👇\n\nYes, it\'s really that simple.',
        time: '2h', likes: 1876, retweets: 654, replies: 234, url: 'https://docs.opnet.org',
    },
    {
        id: 31, account: 'Dev', handle: '@opnet_dev', avatar: '🤖',
        type: 'reply', replyTo: '@rust_dev_42',
        text: 'Great question. OP_NET uses Tapscript (OP_FALSE OP_IF) for calldata encoding — NOT OP_RETURN, NOT inscriptions.\n\nThe entire VM state is derived deterministically by every node. There\'s no "indexer" that can disagree.\n\nThink of it as an embedded consensus layer inside Bitcoin itself.',
        time: '4h', likes: 543, retweets: 189, replies: 78, url: 'https://docs.opnet.org',
    },
    {
        id: 32, account: 'Dev', handle: '@opnet_dev', avatar: '🤖',
        type: 'quote', quotedAccount: 'Ethereum', quotedHandle: '@ethereum',
        quotedText: 'EIP-7702 brings account abstraction to mainnet.',
        text: 'Cool. OP_NET has had account abstraction since day 1.\n\nEvery interaction requires ML-DSA + Schnorr dual signatures. Wallets manage keys. Contracts manage logic.\n\nNo EIPs. No committee votes. Just math.\n\n(Also post-quantum secure, which EIP-7702 is not)',
        time: '8h', likes: 2345, retweets: 876, replies: 432, url: 'https://docs.opnet.org',
    },
    {
        id: 33, account: 'Dev', handle: '@opnet_dev', avatar: '🤖',
        type: 'comment',
        text: '⚠️ Common mistake: using `signer` in frontend transaction params.\n\nThe wallet handles signing via InteractionParametersWithoutSigner. If you pass signer (even as null), OP_WALLET rejects it.\n\nCorrect:\n```\n{ refundTo, network, feeRate, priorityFee }\n```\n\nNo signer. No mldsaSigner. No challenge.',
        time: '11h', likes: 432, retweets: 167, replies: 89, url: 'https://docs.opnet.org', tag: 'Tip',
    },
    {
        id: 34, account: 'Dev', handle: '@opnet_dev', avatar: '🤖',
        type: 'post',
        text: '🔬 Gas optimization tip:\n\nOP_NET gas = baseGas + (gasPerSat × satoshis)\n\nFor testnet, use the "low" recommended fee. For mainnet, "medium" is safe.\n\nPriority fee range: 500-10,000 sats.\nMax spend per tx: 50,000 sats (safety cap).\n\nDon\'t overpay. The network is efficient.',
        time: '16h', likes: 654, retweets: 213, replies: 67, url: 'https://docs.opnet.org',
    },
];

const SOCIAL_LINKS = [
    { name: 'OP_NET', icon: '𝕏', url: 'https://x.com/opaborat', handle: '@opaborat', color: '#F7931A' },
    { name: 'MotoSwap', icon: '𝕏', url: 'https://x.com/maboratmarket', handle: '@maboratmarket', color: '#0ea5e9' },
    { name: 'Telegram', icon: '✈', url: 'https://t.me/opaborat', handle: 't.me/opaborat', color: '#38bdf8' },
    { name: 'Discord', icon: '💬', url: 'https://discord.gg/opnet', handle: 'discord.gg/opnet', color: '#a78bfa' },
];

const ACCOUNTS = ['All', 'OP_NET', 'MotoSwap', 'Vibecode', 'Dev'] as const;

const TYPE_LABELS: Record<PostType, { icon: string; label: string; color: string }> = {
    post:    { icon: '📝', label: 'Post',    color: 'var(--t3)' },
    reply:   { icon: '↩️', label: 'Reply',   color: 'var(--c)' },
    quote:   { icon: '🔁', label: 'Quote',   color: 'var(--o)' },
    comment: { icon: '💬', label: 'Comment', color: 'var(--p)' },
};

function formatCount(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

/* ─── Single Post Card ─── */
function PostCard({ item }: { item: FeedItem }) {
    const tl = TYPE_LABELS[item.type];
    return (
        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div className="Pg" style={{ padding: '16px 18px', transition: '.2s', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = ''; }}>

                {/* Pinned badge */}
                {item.pinned && (
                    <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>📌</span> Pinned post
                    </div>
                )}

                {/* Reply indicator */}
                {item.type === 'reply' && item.replyTo && (
                    <div style={{ fontSize: '.6rem', color: 'var(--t4)', marginBottom: 6 }}>
                        Replying to <span style={{ color: 'var(--c)' }}>{item.replyTo}</span>
                    </div>
                )}

                {/* Header: avatar + name + handle + time + type badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255,255,255,.04)', fontSize: '1.1rem', flexShrink: 0,
                    }}>{item.avatar}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: '.78rem', color: '#fff' }}>{item.account}</span>
                            <span style={{ fontSize: '.65rem', color: 'var(--t3)' }}>{item.handle}</span>
                            <span style={{ fontSize: '.58rem', color: 'var(--t4)' }}>· {item.time}</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        {item.tag && <span className="ntag">{item.tag}</span>}
                        <span style={{
                            fontSize: '.55rem', padding: '2px 7px', borderRadius: 6,
                            background: `color-mix(in srgb, ${tl.color} 10%, transparent)`,
                            color: tl.color, fontWeight: 600,
                        }}>{tl.icon} {tl.label}</span>
                    </div>
                </div>

                {/* Post text */}
                <div style={{ fontSize: '.8rem', color: 'var(--t1)', lineHeight: 1.55, whiteSpace: 'pre-line', marginBottom: 8, wordBreak: 'break-word' }}>
                    {item.text}
                </div>

                {/* Quoted post */}
                {item.type === 'quote' && item.quotedText && (
                    <div style={{
                        padding: '10px 14px', borderRadius: 12, marginBottom: 8,
                        background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: '.68rem', color: 'var(--t2)' }}>{item.quotedAccount}</span>
                            <span style={{ fontSize: '.6rem', color: 'var(--t4)' }}>{item.quotedHandle}</span>
                        </div>
                        <div style={{ fontSize: '.72rem', color: 'var(--t3)', lineHeight: 1.4 }}>{item.quotedText}</div>
                    </div>
                )}

                {/* Engagement bar */}
                <div style={{ display: 'flex', gap: 20, fontSize: '.62rem', color: 'var(--t4)' }}>
                    <span>💬 {formatCount(item.replies)}</span>
                    <span>🔁 {formatCount(item.retweets)}</span>
                    <span>❤️ {formatCount(item.likes)}</span>
                </div>
            </div>
        </a>
    );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN NEWS FEED
   ═══════════════════════════════════════════════════════════════ */
const NewsFeed: React.FC = () => {
    const [filter, setFilter] = useState<string>('All');
    const [typeFilter, setTypeFilter] = useState<PostType | 'all'>('all');
    useEffect(() => { localStorage.setItem('hub_news_visited', '1') }, []);

    let items = filter === 'All' ? FEED : FEED.filter(n => n.account === filter);
    if (typeFilter !== 'all') items = items.filter(n => n.type === typeFilter);

    // Pinned items first, then by time
    const pinned = items.filter(i => i.pinned);
    const rest = items.filter(i => !i.pinned);

    return (
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
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = s.color + '40'; e.currentTarget.style.color = s.color; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'var(--t2)'; }}
                    >
                        <span style={{ fontSize: '.7rem' }}>{s.icon}</span>
                        {s.handle} ↗
                    </a>
                ))}
            </div>

            {/* Account filter */}
            <div className="fb">
                {ACCOUNTS.map(x => (
                    <button key={x} className={`fbn ${filter === x ? 'on' : ''}`} onClick={() => setFilter(x)}>{x}</button>
                ))}
            </div>

            {/* Type filter */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
                {([['all', 'All Types'], ['post', '📝 Posts'], ['reply', '↩️ Replies'], ['quote', '🔁 Quotes'], ['comment', '💬 Comments']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTypeFilter(k as PostType | 'all')}
                        style={{
                            padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: typeFilter === k ? 'rgba(247,147,26,.1)' : 'rgba(255,255,255,.02)',
                            color: typeFilter === k ? 'var(--o)' : 'var(--t3)',
                            fontSize: '.62rem', fontWeight: typeFilter === k ? 700 : 500, transition: '.2s',
                        }}>
                        {l}
                    </button>
                ))}
            </div>

            {/* Feed */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pinned.map(item => <PostCard key={item.id} item={item} />)}
                {rest.map(item => <PostCard key={item.id} item={item} />)}
            </div>

            {items.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--t4)', fontSize: '.78rem' }}>
                    No posts matching this filter.
                </div>
            )}
        </div>
    );
};
export default NewsFeed;
