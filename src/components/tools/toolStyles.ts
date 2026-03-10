import type React from 'react';
import { logger } from '../../logger';

export const monoSm: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace", fontSize: '.68rem', wordBreak: 'break-all' };
export const cardS: React.CSSProperties = { background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 16, padding: '16px 18px', marginBottom: 10 };
export const rowS: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.72rem' };
export const labelS: React.CSSProperties = { color: 'var(--t3)', fontSize: '.68rem' };
export const valueS: React.CSSProperties = { ...monoSm, color: '#fff', fontWeight: 600, textAlign: 'right' as const, maxWidth: '60%' };
export const btnS: React.CSSProperties = { padding: '8px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #F7931A, #ffab40)', color: '#000', fontWeight: 700, fontSize: '.72rem', transition: '.2s' };
export const inputS: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: '#fff', fontSize: '.75rem', fontFamily: "'JetBrains Mono', monospace", outline: 'none', boxSizing: 'border-box' as const };
export const copyBtnS: React.CSSProperties = { background: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'var(--t3)', fontSize: '.6rem', padding: '2px 8px', cursor: 'pointer', marginLeft: 6 };

export function parseHex(s: string): string {
  if (typeof s !== 'string') return '—';
  if (s.startsWith('0x')) { try { return Number(BigInt(s)).toLocaleString(); } catch (e) { logger.warn('[TokenTools] Failed to parse hex value as BigInt:', e); return s; } }
  return s;
}

export function formatBigNum(s: string): string {
  try {
    const n = BigInt(s);
    if (n >= BigInt(1e18)) return (Number(n) / 1e18).toFixed(2) + 'e18';
    if (n >= BigInt(1e15)) return (Number(n) / 1e15).toFixed(2) + 'e15';
    if (n >= BigInt(1e12)) return (Number(n) / 1e12).toFixed(2) + 'T';
    if (n >= BigInt(1e9)) return (Number(n) / 1e9).toFixed(2) + 'B';
    if (n >= BigInt(1e6)) return (Number(n) / 1e6).toFixed(2) + 'M';
    if (n >= 1000n) return (Number(n) / 1e3).toFixed(2) + 'K';
    return n.toString();
  } catch (e) { logger.warn('[TokenTools] Failed to format big number:', e); return s; }
}
