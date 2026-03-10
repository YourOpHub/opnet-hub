import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../logger';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Quest {
    id: string; icon: string; title: string; desc: string; xp: number;
    reward: string; done: boolean; check: () => boolean; tab?: string;
    tier: 'beginner' | 'explorer' | 'builder';
}

const TIERS = {
    beginner: { label: 'Getting Started', color: 'var(--g)', icon: '🌱' },
    explorer: { label: 'Deep Dive', color: 'var(--c)', icon: '🔍' },
    builder: { label: 'Builder Path', color: 'var(--o)', icon: '🏗️' },
};

const makeQuests = (): Quest[] => [
    { id: 'q1', icon: '🔗', title: 'Connect Wallet', desc: 'Link OP_WALLET to access consensus features and sign transactions.', xp: 50, reward: '🏷️ Wallet Badge', done: false, check: () => !!localStorage.getItem('hub_wallet'), tier: 'beginner' },
    { id: 'q2', icon: '🤖', title: 'Chat with Bob', desc: 'Ask Bob AI about OP_NET — learn how consensus differs from indexers.', xp: 30, reward: '🧠 Knowledge Seeker', done: false, check: () => !!localStorage.getItem('hub_bob_used'), tab: 'bob', tier: 'beginner' },
    { id: 'q8', icon: '📰', title: 'Read the News', desc: 'Stay informed on OP_NET protocol updates and ecosystem growth.', xp: 20, reward: '📰 Informed', done: false, check: () => !!localStorage.getItem('hub_news_visited'), tab: 'news', tier: 'beginner' },
    { id: 'q4', icon: '🔧', title: 'Use Developer Tools', desc: 'Convert BTC/sats, inspect wallets, or check gas parameters.', xp: 20, reward: '🔧 Analyst', done: false, check: () => !!localStorage.getItem('hub_tools_used'), tab: 'tools', tier: 'explorer' },
    { id: 'q6', icon: '🌐', title: 'Explore Ecosystem', desc: 'Browse 26+ dApps built on OP_NET consensus layer.', xp: 30, reward: '🌐 Explorer', done: false, check: () => !!localStorage.getItem('hub_eco_visited'), tab: 'eco', tier: 'explorer' },
    { id: 'q3', icon: '⛏️', title: 'Mine 100 Sats', desc: 'Learn about epochs by mining in the interactive Epoch Miner game.', xp: 40, reward: '💎 Miner', done: false, check: () => { try { return JSON.parse(localStorage.getItem('sm_t') || '0') >= 100 } catch (e) { logger.warn('[Quests] Failed to parse mined sats from localStorage:', e); return false } }, tab: 'game', tier: 'explorer' },
    { id: 'q7', icon: '⬆️', title: 'Buy an Upgrade', desc: 'Invest sats in WASM, consensus, or mining infrastructure.', xp: 50, reward: '⬆️ Builder', done: false, check: () => !!localStorage.getItem('sm_upgraded'), tab: 'game', tier: 'builder' },
    { id: 'q5', icon: '🚀', title: 'Deploy a Token', desc: 'Configure and launch an OP-20 token on Bitcoin L1.', xp: 100, reward: '🚀 Creator', done: false, check: () => !!localStorage.getItem('hub_token_launched'), tab: 'launch', tier: 'builder' },
];

const QuestPanel: React.FC<{ open: boolean; onClose: () => void; onNav: (t: string) => void }> = ({ open, onClose, onNav }) => {
    const trapRef = useFocusTrap(open, onClose);
    const [quests, setQuests] = useState<Quest[]>(() => {
        const saved = localStorage.getItem('hub_quest_state');
        const init = makeQuests();
        if (saved) { try { const ids: string[] = JSON.parse(saved); return init.map(q => ({ ...q, done: ids.includes(q.id) })) } catch (e) { logger.warn('[Quests] Failed to parse quest state from localStorage:', e); return init } }
        return init;
    });

    const verify = useCallback(() => {
        setQuests(prev => {
            let changed = false;
            const next = prev.map(q => { if (!q.done && q.check()) { changed = true; return { ...q, done: true } } return q });
            if (changed) localStorage.setItem('hub_quest_state', JSON.stringify(next.filter(q => q.done).map(q => q.id)));
            return changed ? next : prev;
        });
    }, []);

    useEffect(() => { verify(); const iv = setInterval(verify, 2000); return () => clearInterval(iv) }, [verify]);

    const totalXP = quests.filter(q => q.done).reduce((s, q) => s + q.xp, 0);
    const maxXP = quests.reduce((s, q) => s + q.xp, 0);
    const done = quests.filter(q => q.done).length;
    const level = Math.floor(totalXP / 100) + 1;
    const pct = Math.round((totalXP / maxXP) * 100);
    const tierOrder: Array<'beginner' | 'explorer' | 'builder'> = ['beginner', 'explorer', 'builder'];

    return (
        <>
            {open && <div className="qp-overlay" aria-hidden="true" onClick={onClose} />}
            <div ref={trapRef} className={`qp ${open ? 'qp-open' : ''}`} role="dialog" aria-modal="true" aria-label="Quests panel" aria-hidden={!open}>
                <div className="qp-head">
                    <div>
                        <div className="fw-800 fs-100">🎯 OP_NET Onboarding</div>
                        <div className="fs-65 c-t3">Master Bitcoin L1 — earn proof of knowledge</div>
                    </div>
                    <button className="qp-close" aria-label="Close quests panel" onClick={onClose}>✕</button>
                </div>

                <div className="qp-stats">
                    <div className="qp-stat"><div className="qp-stat-v c-y">Lv.{level}</div><div className="qp-stat-l">Level</div></div>
                    <div className="qp-stat"><div className="qp-stat-v c-o">{done}/{quests.length}</div><div className="qp-stat-l">Done</div></div>
                    <div className="qp-stat"><div className="qp-stat-v c-c">{totalXP}</div><div className="qp-stat-l">XP</div></div>
                </div>
                <div className="py-0-px-18" style={{ paddingBottom: 12 }}>
                    <div className="hb"><div className="hf" style={{ width: `${pct}%` }} /></div>
                </div>

                {done === quests.length ? (
                    <div className="qp-all-done">
                        <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>🏆</div>
                        <div>OP_NET Master — All quests complete!</div>
                        <div className="fs-62 c-t3 fw-500 mt-4">You've proven deep knowledge of Bitcoin's consensus layer</div>
                    </div>
                ) : (
                    <div className="qp-hint">
                        Complete quests to prove you understand OP_NET.<br />Each badge demonstrates a real skill on Bitcoin L1.
                    </div>
                )}

                <div className="qp-list" role="list" aria-label="Quest items">
                    {tierOrder.map(tier => {
                        const tierQuests = quests.filter(q => q.tier === tier);
                        const tierDone = tierQuests.filter(q => q.done).length;
                        const t = TIERS[tier];
                        return (
                            <React.Fragment key={tier}>
                                <div className="qp-tier-hdr" style={{ color: t.color }}>
                                    <span>{t.icon}</span> {t.label} <span className="c-t4 fw-500">({tierDone}/{tierQuests.length})</span>
                                </div>
                                {tierQuests.map(q => (
                                    <div key={q.id} className={`qp-item ${q.done ? 'qp-done' : ''}`} role="listitem" aria-label={`${q.title}${q.done ? ' — completed' : ''}`} onClick={() => { if (!q.done && q.tab) { onNav(q.tab); onClose() } }}>
                                        <div className="qp-item-icon">{q.done ? '✅' : q.icon}</div>
                                        <div className="qp-item-body">
                                            <div className="qp-item-title">{q.title}</div>
                                            <div className="qp-item-desc">{q.done ? q.reward : q.desc}</div>
                                        </div>
                                        <div className="qp-item-xp">+{q.xp}</div>
                                    </div>
                                ))}
                            </React.Fragment>
                        );
                    })}
                </div>

                <div className="qp-footer">
                    <a href="https://vibecode.finance/challenge" target="_blank" rel="noopener noreferrer"
                        className="qp-cta">
                        🏆 Join the Vibecoding Challenge → win Motocats + $PILL
                    </a>
                </div>
            </div>
        </>
    );
};
export default React.memo(QuestPanel);
