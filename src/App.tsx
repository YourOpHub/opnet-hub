import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { logger } from './logger';
import logoUrl from './assets/logo.png';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, OP_20_ABI, type IOP20Contract } from 'opnet';
import { NETWORK, CURRENT_ENV } from './config';
import { getProvider } from './contractCache';
import Landing from './components/Landing';
import OpsPanel from './components/OpsPanel';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { ToastProvider } from './components/Toast';
import { OpsProvider } from './contexts/OpsContext';
import { DEPLOYED_CONTRACTS, OPSCAN_EXPLORER_URL, type ContractTokenInfo } from './contracts';
import { fetchHolderBalances, type HolderBalance } from './tokenApi';

// Global error handlers — executed once at module load
window.addEventListener('unhandledrejection', (event) => {
    logger.error('[Unhandled Rejection]', event.reason);
});

window.addEventListener('error', (event) => {
    logger.error('[Uncaught Error]', (event.error as unknown) != null ? event.error : event.message);
});

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

const LazyFallback = (): React.ReactElement => (
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
        id: 'launchpad', label: 'Launchpad', icon: '\u{1F680}',
        items: [
            { id: 'launch', label: 'Deploy' },
            { id: 'explorer', label: 'Explorer' },
        ],
    },
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
    const [balRefreshKey, setBalRefreshKey] = useState(0);

    // Listen for global balance refresh events (fired by any component after TX confirmation)
    useEffect(() => {
        const handler = (): void => setBalRefreshKey(k => k + 1);
        window.addEventListener('opnet:balance-refresh', handler);
        return () => window.removeEventListener('opnet:balance-refresh', handler);
    }, []);

    useEffect(() => {
        // Refresh on dropdown open OR on global balance refresh (even if dropdown closed)
        if ((!wDrop && balRefreshKey === 0) || !wAddr || !senderAddr) return;
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
            }).catch((e) => { logger.warn('[App] Indexer balance fetch error:', e); });
        }

        // Fallback: hardcoded tokens via SDK (always runs as backup)
        (Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]).forEach(([sym, tok]) => {
            void (async () => {
                try {
                    const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, sdkProvider, NETWORK, senderAddr);
                    const sim = await op20.balanceOf(senderAddr);
                    const bal = sim?.properties?.balance ?? 0n;
                    const human = (Number(BigInt(bal.toString())) / Math.pow(10, tok.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    if (!cancelled) setBalances(prev => ({ ...prev, [sym]: human }));
                } catch (e) { logger.warn('[App] Failed to fetch token balance:', e); }
            })();
        });
        return () => { cancelled = true; };
    }, [wDrop, wAddr, senderAddr, sdkProvider, hashedMLDSAKey, publicKey, balRefreshKey]);

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
        const h = (e: MouseEvent): void => {
            const nav = document.querySelector('.N');
            if (nav && !nav.contains(e.target as Node)) setOpenGroup(null);
        };
        document.addEventListener('click', h);
        return () => document.removeEventListener('click', h);
    }, [openGroup]);

    const activeGroup = findGroup(tab);

    const wrap = (child: React.ReactNode, routeName: string): React.ReactElement => (
        <RouteErrorBoundary routeName={routeName} onReset={() => setTab('home')}>
            <Suspense fallback={<LazyFallback />}>{child}</Suspense>
        </RouteErrorBoundary>
    );

    const P = (): React.ReactElement => {
        switch (tab) {
            case 'home': return wrap(<Landing onNav={navigate} />, 'Home');
            case 'portfolio': return wrap(<Portfolio walletAddress={wAddr} senderAddress={senderAddr} />, 'Portfolio');
            case 'bob': return wrap(<BobChat />, 'Bob AI');
            case 'tools': return wrap(<TokenTools />, 'Token Tools');
            case 'swap': return wrap(<SwapUI />, 'Swap');
            case 'staking': return wrap(<Staking />, 'Staking');
            case 'analytics': return wrap(<Analytics />, 'Analytics');
            case 'launch': return wrap(<Launchpad />, 'Launchpad');
            case 'market': return wrap(<Marketplace />, 'Marketplace');
            case 'xchain': return wrap(<CrossChainMarketplace />, 'Cross-Chain');
            case 'game': return wrap(<SatoshiMiner />, 'Satoshi Miner');
            case 'news': return wrap(<NewsFeed />, 'News');
            case 'eco': return wrap(<EcosystemDir />, 'Ecosystem');
            case 'multisend': return wrap(<MultiSender />, 'MultiSend');
            case 'explorer': return wrap(<TokenGallery />, 'Token Explorer');
            default: return wrap(<Landing onNav={navigate} />, 'Home');
        }
    };

    return (
        <ToastProvider>
        <OpsProvider>
            <a href="#main-content" className="skip-link">Skip to content</a>
            <div className="site-bg" />
            <div className="particles"><span /><span /><span /><span /><span /><span /><span /><span /></div>

            <header className="H" role="banner">
                <div className="Hi">
                    <div className="Lo" onClick={() => { navigate('home'); setOpenGroup(null); }} role="button" tabIndex={0} aria-label="Go to home page" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('home'); setOpenGroup(null); } }}>
                        <img src={logoUrl} alt="OPNet Hub logo" style={{ height: 32, objectFit: 'contain' }} />
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
                    <nav className="N nav-desktop" role="navigation" aria-label="Main navigation">
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
                                        aria-expanded={openGroup === g.id}
                                        aria-haspopup="true"
                                        aria-label={`${g.label} menu`}
                                    >
                                        <span className="nav-group-icon" aria-hidden="true">{g.icon}</span>
                                        {g.label}
                                        <span className={`nav-chevron ${openGroup === g.id ? 'open' : ''}`} aria-hidden="true" />
                                    </button>
                                    {openGroup === g.id && (
                                        <div className="nav-dropdown" role="menu" aria-label={`${g.label} submenu`}>
                                            {g.items.map(item => (
                                                <button
                                                    key={item.id}
                                                    className={`nav-drop-item ${tab === item.id ? 'active' : ''}`}
                                                    onClick={() => { navigate(item.id); setOpenGroup(null); }}
                                                    role="menuitem"
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
                                aria-label={connecting ? 'Connecting wallet' : wOn ? 'Wallet menu' : 'Connect wallet'}
                                aria-expanded={wDrop && wOn}
                                aria-haspopup={wOn ? 'true' : undefined}
                            >
                                {connecting ? 'Connecting...' : wOn ? `${wAddr.slice(0, 6)}...${wAddr.slice(-4)}` : 'Connect Wallet'}
                            </button>
                            {wDrop && wOn && (
                                <div className="wallet-dropdown" role="menu" aria-label="Wallet details">
                                    <div className="wd-addr">{wAddr}</div>
                                    {/* Hardcoded tokens first */}
                                    {(Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]).map(([sym, tok]) => (
                                        <div key={sym} className="wd-row">
                                            <span className="wd-token">{tok.icon} {sym}</span>
                                            <span className="wd-bal">{balances[sym] ?? '...'}</span>
                                        </div>
                                    ))}
                                    {/* Extra tokens from indexer (not in hardcoded list) */}
                                    {indexerBalances
                                        .filter(b => !Object.keys(DEPLOYED_CONTRACTS).includes(b.symbol))
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
            <nav className="mobile-nav" role="navigation" aria-label="Mobile navigation">
                <button className={`mn-item ${tab === 'home' ? 'on' : ''}`} onClick={() => navigate('home')} aria-label="Home" aria-current={tab === 'home' ? 'page' : undefined}>
                    <span className="mn-icon" aria-hidden="true">{'\u2302'}</span><span className="mn-label">Home</span>
                </button>
                {NAV_GROUPS.map(g => (
                    <button key={g.id} className={`mn-item ${activeGroup === g.id ? 'on' : ''}`}
                        aria-label={g.label}
                        aria-current={activeGroup === g.id ? 'true' : undefined}
                        onClick={() => {
                            if (activeGroup === g.id && openGroup === g.id) {
                                setOpenGroup(null);
                            } else {
                                setOpenGroup(g.id);
                                // navigate to first item if not already in group
                                if (activeGroup !== g.id && g.items[0]) navigate(g.items[0].id);
                            }
                        }}
                    >
                        <span className="mn-icon" aria-hidden="true">{g.icon}</span><span className="mn-label">{g.label}</span>
                    </button>
                ))}
            </nav>

            {/* Sub-nav for active group on mobile */}
            {activeGroup && (
                <div className="mobile-subnav" role="navigation" aria-label="Section navigation">
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

            <main id="main-content" className="M" key={tab} role="main" aria-label="Page content">
                {P()}
            </main>

            <footer className="site-footer" role="contentinfo">
                <div className="footer-links">
                    {[
                        ['Docs', 'https://docs.opnet.org'],
                        ['OPScan', OPSCAN_EXPLORER_URL],
                        ['GitHub', 'https://github.com/btc-vision'],
                        ...(CURRENT_ENV !== 'mainnet' ? [['Faucet', 'https://faucet.opnet.org']] : []),
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

            <OpsPanel />
        </OpsProvider>
        </ToastProvider>
    );
};
export default App;
