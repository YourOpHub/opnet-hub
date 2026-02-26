import React, { useState, useEffect, useCallback } from 'react';

interface Quest {
    id: string; icon: string; title: string; desc: string; xp: number;
    reward: string; done: boolean; check: () => boolean; tab?: string;
}

const makeQuests = (): Quest[] => [
    { id: 'q1', icon: '🔗', title: 'Connect Wallet', desc: 'Link OPWallet for consensus features.', xp: 50, reward: '🏷️ Wallet Badge', done: false, check: () => !!localStorage.getItem('hub_wallet') },
    { id: 'q2', icon: '🤖', title: 'Ask Bob AI', desc: 'Learn about OP_NET from the copilot.', xp: 30, reward: '🧠 Knowledge', done: false, check: () => !!localStorage.getItem('hub_bob_used'), tab: 'bob' },
    { id: 'q3', icon: '⛏️', title: 'Mine 100 Sats', desc: 'Earn 100 sats in Epoch Miner.', xp: 40, reward: '💎 Miner', done: false, check: () => { try { return JSON.parse(localStorage.getItem('sm_t') || '0') >= 100 } catch { return false } }, tab: 'game' },
    { id: 'q4', icon: '🔧', title: 'Use Tools', desc: 'Try the BTC/Sats converter.', xp: 20, reward: '🔧 Analyst', done: false, check: () => !!localStorage.getItem('hub_tools_used'), tab: 'tools' },
    { id: 'q5', icon: '🚀', title: 'Deploy Token', desc: 'Launch an OP-20 on Bitcoin L1.', xp: 100, reward: '🚀 Creator', done: false, check: () => !!localStorage.getItem('hub_token_launched'), tab: 'launch' },
    { id: 'q6', icon: '🌐', title: 'Explore dApps', desc: 'Browse the OP_NET ecosystem.', xp: 30, reward: '🌐 Explorer', done: false, check: () => !!localStorage.getItem('hub_eco_visited'), tab: 'eco' },
    { id: 'q7', icon: '⬆️', title: 'Buy Upgrade', desc: 'Get a miner upgrade.', xp: 50, reward: '⬆️ Builder', done: false, check: () => !!localStorage.getItem('sm_upgraded'), tab: 'game' },
    { id: 'q8', icon: '📰', title: 'Read News', desc: 'Check OP_NET news.', xp: 20, reward: '📰 Informed', done: false, check: () => !!localStorage.getItem('hub_news_visited'), tab: 'news' },
];

const QuestPanel: React.FC<{ open: boolean; onClose: () => void; onNav: (t: string) => void }> = ({ open, onClose, onNav }) => {
    const [quests, setQuests] = useState<Quest[]>(() => {
        const saved = localStorage.getItem('hub_quest_state');
        const init = makeQuests();
        if (saved) { try { const ids: string[] = JSON.parse(saved); return init.map(q => ({ ...q, done: ids.includes(q.id) })) } catch { return init } }
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

    return (
        <>
            {open && <div className="qp-overlay" onClick={onClose} />}
            <div className={`qp ${open ? 'qp-open' : ''}`}>
                <div className="qp-head">
                    <div>
                        <div style={{ fontWeight: 800, fontSize: '1rem' }}>🎯 Quests</div>
                        <div style={{ fontSize: '.65rem', color: 'var(--t3)' }}>Learn OP_NET, unlock badges</div>
                    </div>
                    <button className="qp-close" onClick={onClose}>✕</button>
                </div>

                <div className="qp-stats">
                    <div className="qp-stat"><div className="qp-stat-v" style={{ color: 'var(--y)' }}>Lv.{level}</div><div className="qp-stat-l">Level</div></div>
                    <div className="qp-stat"><div className="qp-stat-v" style={{ color: 'var(--o)' }}>{done}/{quests.length}</div><div className="qp-stat-l">Done</div></div>
                    <div className="qp-stat"><div className="qp-stat-v" style={{ color: 'var(--c)' }}>{pct}%</div><div className="qp-stat-l">Progress</div></div>
                </div>
                <div className="hb" style={{ margin: '0 0 12px' }}><div className="hf" style={{ width: `${pct}%` }} /></div>

                {done === quests.length && (
                    <div style={{ textAlign: 'center', padding: '12px', background: 'var(--gG)', border: '1px solid var(--gB)', borderRadius: 'var(--rad)', marginBottom: 10, fontSize: '.78rem', color: 'var(--g)', fontWeight: 700 }}>
                        🏆 OP_NET Master — All quests complete!
                    </div>
                )}

                <div className="qp-list">
                    {quests.map(q => (
                        <div key={q.id} className={`qp-item ${q.done ? 'qp-done' : ''}`} onClick={() => { if (!q.done && q.tab) { onNav(q.tab); onClose() } }}>
                            <div className="qp-item-icon">{q.done ? '✅' : q.icon}</div>
                            <div className="qp-item-body">
                                <div className="qp-item-title">{q.title}</div>
                                <div className="qp-item-desc">{q.done ? q.reward : q.desc}</div>
                            </div>
                            <div className="qp-item-xp">+{q.xp}</div>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '10px 0', textAlign: 'center', fontSize: '.6rem', color: 'var(--t4)' }}>
                    Quests unlock badges that prove you know OP_NET
                </div>
            </div>
        </>
    );
};
export default QuestPanel;
