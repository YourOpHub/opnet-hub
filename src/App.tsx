import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import logoUrl from './assets/logo.png';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, OP_20_ABI, type IOP20Contract } from 'opnet';
import { NETWORK, CURRENT_ENV } from './config';
import { getProvider } from './contractCache';
import Landing from './components/Landing';
import QuestPanel from './components/Quests';
import OpsPanel from './components/OpsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { OpsProvider } from './contexts/OpsContext';
import { TESTNET_CONTRACTS, OPSCAN_EXPLORER_URL } from './contracts';
import { fetchHolderBalances, type HolderBalance } from './tokenApi';

const BobChat = lazy(() => import('./components/BobChat'));
const NewsFeed = lazy(() => import('./components/NewsFeed'));
const TokenTools = lazy(() => import('./components/TokenTools'));
const SatoshiMiner = lazy(() => import('./components/SatoshiMiner'));
const EcosystemDir = lazy(() => import('./components/EcosystemDir'));
const Portfolio = lazy(() => import('./components/Portfolio'));
const Launchpad = lazy(() => import('./components/Launchpad'));
const SwapUI = lazy(() => import('./components/SwapUI'));
const Analytics = lazy(() => import('./components/Analytics'));
const Staking = lazy(() => import('./components/Staking'));
const Marketplace = lazy(() => import('./components/Marketplace'));
const MultiSender = lazy(() => import('./components/MultiSender'));
const CrossChainMarketplace = lazy(() => import('./components/CrossChainMarketplace'));
const TokenGallery = lazy(() => import('./components/TokenGallery'));

const LazyFallback = () => (
    <div style={{ padding: '40px 0' }}>
        <div className="skeleton-block" style={{ height: 180, borderRadius: 20, marginBottom: 16 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="skeleton-block" style={{ height: 80, borderRadius: 14 }} />
            <div className="skeleton-block" style={{ height: 80, borderRadius: 14 }} />
            <div className="skeleton-block" style={{ height: 80, borderRadius: 14 }} />
        </div>
        <div className="skeleton-block" style={{ height: 120, borderRadius: 16 }} />
    </div>
);

/* ── Grouped navigation ── */
interface NavGroup {
    id: string;
    label: string;
    icon: string;
    items: { id: string; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        id: 'defi', label: 'DeFi', icon: '\u25C8',
        items: [
            { id: 'swap', label: 'Swap' },
            { id: 'staking', label: 'Stake' },
            { id: 'market', label: 'Market' },
            { id: 'xchain', label: 'Cross-Chain' },
        ],
    },
    {
        id: 'tokens', label: 'Tokens', icon: '\u2B22',
        items: [
            { id: 'explorer', label: 'Explorer' },
            { id: 'launch', label: 'Launchpad' },
            { id: 'tools', label: 'Tools' },
            { id: 'multisend', label: 'MultiSend' },
        ],
    },
    {
        id: 'explore', label: 'Explore', icon: '\u2606',
        items: [
            { id: 'analytics', label: 'Analytics' },
            { id: 'eco', label: 'Ecosystem' },
            { id: 'news', label: 'News' },
        ],
    },
    {
        id: 'play', label: 'Play', icon: '\u25B7',
        items: [
            { id: 'game', label: 'Miner' },
            { id: 'bob', label: 'Bob AI' },
        ],
    },
];

function findGroup(tabId: string): string | null {
    for (const g of NAV_GROUPS) {
        if (g.items.some(i => i.id === tabId)) return g.id;
    }
    return null;
}

const App: React.FC = () => {
    const [tab, setTab] = useState('home');
    const [qOpen, setQOpen] = useState(false);
    const [openGroup, setOpenGroup] = useState<string | null>(null);

    const {
        openConnectModal,
        disconnect,
        walletAddress,
        connecting,
        address: senderAddr,
        publicKey,
        hashedMLDSAKey,
    } = useWalletConnect();

    useEffect(() => {
        if (walletAddress) {
            localStorage.setItem('hub_wallet', walletAddress);
        } else {
            localStorage.removeItem('hub_wallet');
        }
    }, [walletAddress]);

    const wAddr = walletAddress ?? '';
    const wOn = !!walletAddress;
    const [wDrop, setWDrop] = useState(false);
    const [balances, setBalances] = useState<Record<string, string>>({});
    const dropRef = useRef<HTMLDivElement>(null);
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const navGroupTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const sdkProvider = useMemo(() => getProvider(), []);

    const openDrop = useCallback(() => { clearTimeout(hoverTimer.current); setWDrop(true); }, []);
    const closeDrop = useCallback(() => { hoverTimer.current = setTimeout(() => setWDrop(false), 300); }, []);

    const [indexerBalances, setIndexerBalances] = useState<HolderBalance[]>([]);

    useEffect(() => {
        if (!wDrop || !wAddr || !senderAddr) return;
        let cancelled = false;

        // Try indexer API first for ALL tokens
        const mldsaHex = hashedMLDSAKey ? (hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey) : '';
        const tweakedHex = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : '';
        if (mldsaHex) {
            fetchHolderBalances(mldsaHex, tweakedHex).then(results => {
                if (cancelled) return;
                setIndexerBalances(results);
                for (const r of results) {
                    const human = (Number(BigInt(r.balance)) / Math.pow(10, r.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    setBalances(prev => ({ ...prev, [r.symbol]: human }));
                }
            }).catch(() => {});
        }

        // Fallback: hardcoded tokens via SDK (always runs as backup)
        Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
            (async () => {
                try {
                    const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, sdkProvider, NETWORK, senderAddr);
                    const sim = await op20.balanceOf(senderAddr);
                    const bal = sim?.properties?.balance ?? 0n;
                    const human = (Number(BigInt(bal.toString())) / Math.pow(10, tok.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    if (!cancelled) setBalances(prev => ({ ...prev, [sym]: human }));
                } catch { /* ignore */ }
            })();
        });
        return () => { cancelled = true; };
    }, [wDrop, wAddr, senderAddr, sdkProvider, hashedMLDSAKey, publicKey]);

    const handleWallet = useCallback(() => {
        if (wOn) disconnect();
        else openConnectModal();
    }, [wOn, disconnect, openConnectModal]);

    const navigate = useCallback((id: string) => {
        setTab(id);
        // auto-expand group for active tab
        const g = findGroup(id);
        if (g) setOpenGroup(g);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // close group dropdown on outside click
    useEffect(() => {
        if (!openGroup) return;
        const h = (e: MouseEvent) => {
            const nav = document.querySelector('.N');
            if (nav && !nav.contains(e.target as Node)) setOpenGroup(null);
        };
        document.addEventListener('click', h);
        return () => document.removeEventListener('click', h);
    }, [openGroup]);

    const activeGroup = findGroup(tab);

    const P = () => {
        switch (tab) {
            case 'home': return <Landing onNav={navigate} />;
            case 'portfolio': return <Portfolio walletAddress={wAddr} senderAddress={senderAddr} />;
            case 'bob': return <BobChat />;
            case 'tools': return <TokenTools />;
            case 'swap': return <SwapUI />;
            case 'staking': return <Staking />;
            case 'analytics': return <Analytics />;
            case 'launch': return <Launchpad />;
            case 'market': return <Marketplace />;
            case 'xchain': return <CrossChainMarketplace />;
            case 'game': return <SatoshiMiner />;
            case 'news': return <NewsFeed />;
            case 'eco': return <EcosystemDir />;
            case 'multisend': return <MultiSender />;
            case 'explorer': return <TokenGallery />;
            default: return <Landing onNav={navigate} />;
        }
    };

    return (
        <ToastProvider>
        <OpsProvider>
            <div className="site-bg" />
            <div className="particles"><span /><span /><span /><span /><span /><span /><span /><span /></div>

            <header className="H">
                <div className="Hi">
                    <div className="Lo" onClick={() => { navigate('home'); setOpenGroup(null); }}>
                        <img src={logoUrl} alt="OPNet Hub" style={{ height: 32, objectFit: 'contain' }} />
                    </div>
                    {CURRENT_ENV !== 'mainnet' && (
                        <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: '.55rem', fontWeight: 800,
                            background: CURRENT_ENV === 'testnet' ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)',
                            color: CURRENT_ENV === 'testnet' ? '#f59e0b' : '#ef4444',
                            letterSpacing: '.08em', textTransform: 'uppercase',
                        }}>{CURRENT_ENV}</span>
                    )}

                    {/* Grouped nav — desktop */}
                    <nav className="N nav-desktop">
                        <div className="Ni">
                            <button
                                className={`Nt ${tab === 'home' ? 'on' : ''}`}
                                onClick={() => { navigate('home'); setOpenGroup(null); }}
                            >
                                Home
                            </button>
                            {NAV_GROUPS.map(g => (
                                <div key={g.id} className="nav-group"
                                    onMouseEnter={() => { clearTimeout(navGroupTimer.current); setOpenGroup(g.id); }}
                                    onMouseLeave={() => { navGroupTimer.current = setTimeout(() => setOpenGroup(null), 250); }}
                                >
                                    <button
                                        className={`Nt ${activeGroup === g.id ? 'on' : ''}`}
                                        onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
                                    >
                                        <span className="nav-group-icon">{g.icon}</span>
                                        {g.label}
                                        <span className={`nav-chevron ${openGroup === g.id ? 'open' : ''}`} />
                                    </button>
                                    {openGroup === g.id && (
                                        <div className="nav-dropdown">
                                            {g.items.map(item => (
                                                <button
                                                    key={item.id}
                                                    className={`nav-drop-item ${tab === item.id ? 'active' : ''}`}
                                                    onClick={() => { navigate(item.id); setOpenGroup(null); }}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </nav>

                    <div className="Hr">
                        <div ref={dropRef} style={{ position: 'relative' }}
                            onMouseEnter={wOn ? openDrop : undefined}
                            onMouseLeave={wOn ? closeDrop : undefined}
                        >
                            <button className={`Wb ${wOn ? 'on' : ''}`}
                                onClick={wOn ? () => setWDrop(v => !v) : handleWallet}
                                disabled={connecting}
                            >
                                {connecting ? 'Connecting...' : wOn ? `${wAddr.slice(0, 6)}...${wAddr.slice(-4)}` : 'Connect Wallet'}
                            </button>
                            {wDrop && wOn && (
                                <div className="wallet-dropdown">
                                    <div className="wd-addr">{wAddr}</div>
                                    {/* Hardcoded tokens first */}
                                    {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => (
                                        <div key={sym} className="wd-row">
                                            <span className="wd-token">{tok.icon} {sym}</span>
                                            <span className="wd-bal">{balances[sym] ?? '...'}</span>
                                        </div>
                                    ))}
                                    {/* Extra tokens from indexer (not in hardcoded list) */}
                                    {indexerBalances
                                        .filter(b => !Object.keys(TESTNET_CONTRACTS).includes(b.symbol))
                                        .map(b => (
                                            <div key={b.token} className="wd-row">
                                                <span className="wd-token">{b.symbol}</span>
                                                <span className="wd-bal">{balances[b.symbol] ?? '...'}</span>
                                            </div>
                                        ))
                                    }
                                    <div className="wd-actions">
                                        <button className="wd-btn-primary" onClick={() => { navigate('portfolio'); setWDrop(false); }}>
                                            Portfolio
                                        </button>
                                        <button className="wd-btn-danger" onClick={() => { disconnect(); setWDrop(false); }}>
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Mobile bottom nav */}
            <nav className="mobile-nav">
                <button className={`mn-item ${tab === 'home' ? 'on' : ''}`} onClick={() => navigate('home')}>
                    <span className="mn-icon">{'\u2302'}</span><span className="mn-label">Home</span>
                </button>
                {NAV_GROUPS.map(g => (
                    <button key={g.id} className={`mn-item ${activeGroup === g.id ? 'on' : ''}`}
                        onClick={() => {
                            if (activeGroup === g.id && openGroup === g.id) {
                                setOpenGroup(null);
                            } else {
                                setOpenGroup(g.id);
                                // navigate to first item if not already in group
                                if (activeGroup !== g.id) navigate(g.items[0].id);
                            }
                        }}
                    >
                        <span className="mn-icon">{g.icon}</span><span className="mn-label">{g.label}</span>
                    </button>
                ))}
            </nav>

            {/* Sub-nav for active group on mobile */}
            {activeGroup && (
                <div className="mobile-subnav">
                    {NAV_GROUPS.find(g => g.id === activeGroup)?.items.map(item => (
                        <button key={item.id}
                            className={`msn-item ${tab === item.id ? 'on' : ''}`}
                            onClick={() => navigate(item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}

            <main className="M" key={tab}>
                <ErrorBoundary onReset={() => setTab('home')}>
                    <Suspense fallback={<LazyFallback />}>{P()}</Suspense>
                </ErrorBoundary>
            </main>

            <footer className="site-footer">
                <div className="footer-links">
                    {[
                        ['Docs', 'https://docs.opnet.org'],
                        ['OPScan', OPSCAN_EXPLORER_URL],
                        ['GitHub', 'https://github.com/btc-vision'],
                        ['Faucet', 'https://faucet.opnet.org'],
                    ].map(([l, u]) => (
                        <a key={l} href={u} target="_blank" rel="noopener noreferrer" className="footer-link">
                            {l}
                        </a>
                    ))}
                </div>
                <div className="footer-copy">
                    OPNet Hub &middot; Bitcoin L1 DeFi &middot; Powered by OP_NET
                </div>
            </footer>

            <button className="q-fab" onClick={() => setQOpen(!qOpen)}>
                <span>{'\u2737'}</span>
            </button>

            <QuestPanel open={qOpen} onClose={() => setQOpen(false)} onNav={navigate} />
            <OpsPanel />
        </OpsProvider>
        </ToastProvider>
    );
};
export default App;
