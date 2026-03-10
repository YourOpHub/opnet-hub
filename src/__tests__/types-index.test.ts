/**
 * types-index.test.ts -- Tests for src/types/index.ts
 *
 * Covers: Particle, GameState, LeaderboardEntry, ScorePopup type interface exports
 * (type-only exports don't produce runtime code, but importing the file covers its lines)
 */
import { describe, it, expect } from 'vitest';

import type { Particle, GameState, LeaderboardEntry, ScorePopup } from '../types/index';

describe('types/index', () => {
  it('Particle type is usable', () => {
    const p: Particle = {
      id: 1,
      x: 10,
      y: 20,
      radius: 5,
      color: '#fff',
      glowColor: 'rgba(255,255,255,0.6)',
      vx: 1,
      vy: 1,
      activated: false,
      activatedAt: 0,
      explosionRadius: 50,
      points: 10,
      type: 'normal',
    };
    expect(p.id).toBe(1);
    expect(p.type).toBe('normal');
    expect(['normal', 'bitcoin', 'lightning', 'mega']).toContain(p.type);
  });

  it('GameState type is usable', () => {
    const state: GameState = {
      particles: [],
      score: 0,
      chain: 0,
      maxChain: 0,
      level: 1,
      clicksRemaining: 3,
      totalClicks: 3,
      gamePhase: 'idle',
      combo: 0,
      particlesActivated: 0,
    };
    expect(state.gamePhase).toBe('idle');
    expect(['idle', 'playing', 'chain-reacting', 'ended']).toContain(state.gamePhase);
  });

  it('LeaderboardEntry type is usable', () => {
    const entry: LeaderboardEntry = {
      rank: 1,
      address: 'opt1test',
      score: 1000,
      chain: 10,
      level: 5,
      date: '2026-03-10',
    };
    expect(entry.rank).toBe(1);
  });

  it('ScorePopup type is usable', () => {
    const popup: ScorePopup = {
      id: 1,
      x: 100,
      y: 200,
      text: '+100',
      createdAt: Date.now(),
    };
    expect(popup.text).toBe('+100');
  });
});
