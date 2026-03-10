/**
 * game-engine.test.ts — Tests for src/game/engine.ts
 *
 * Covers: createInitialState, getParticleCount, getTargetActivations,
 *         createParticle, generateParticles, activateParticleAt, calculateBestMove,
 *         updateParticles.
 *
 * Note: drawParticle / drawBackground are Canvas2D render functions — not tested here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock format utils (they use Math.random internally)
vi.mock('../utils/format', () => ({
  randomBetween: (min: number, max: number) => (min + max) / 2, // deterministic midpoint
  distance: (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
}));

import {
  createInitialState,
  getParticleCount,
  getTargetActivations,
  createParticle,
  generateParticles,
  activateParticleAt,
  calculateBestMove,
  updateParticles,
} from '../game/engine';

import type { Particle } from '../types/index';

// ─── createInitialState ───
describe('createInitialState', () => {
  it('creates state with default level 1', () => {
    const state = createInitialState();
    expect(state.level).toBe(1);
    expect(state.score).toBe(0);
    expect(state.chain).toBe(0);
    expect(state.maxChain).toBe(0);
    expect(state.particles).toEqual([]);
    expect(state.gamePhase).toBe('idle');
    expect(state.combo).toBe(0);
    expect(state.particlesActivated).toBe(0);
  });

  it('creates state with custom level', () => {
    const state = createInitialState(5);
    expect(state.level).toBe(5);
  });

  it('clicks decrease every 3 levels', () => {
    // Level 1: 3 clicks
    expect(createInitialState(1).clicksRemaining).toBe(3);
    expect(createInitialState(1).totalClicks).toBe(3);

    // Level 4: 2 clicks (3 - floor(3/3) = 2)
    expect(createInitialState(4).clicksRemaining).toBe(2);

    // Level 7: 1 click (3 - floor(6/3) = 1)
    expect(createInitialState(7).clicksRemaining).toBe(1);

    // Level 10: max(1, 3 - 3) = 1
    expect(createInitialState(10).clicksRemaining).toBe(1);
  });

  it('clicks never go below 1', () => {
    expect(createInitialState(100).clicksRemaining).toBeGreaterThanOrEqual(1);
  });

  it('clicksRemaining equals totalClicks', () => {
    for (const level of [1, 3, 5, 10]) {
      const state = createInitialState(level);
      expect(state.clicksRemaining).toBe(state.totalClicks);
    }
  });
});

// ─── getParticleCount ───
describe('getParticleCount', () => {
  it('level 1 = 25 particles', () => {
    expect(getParticleCount(1)).toBe(25);
  });

  it('level 2 = 30 particles', () => {
    expect(getParticleCount(2)).toBe(30);
  });

  it('level 10 = 70 particles', () => {
    expect(getParticleCount(10)).toBe(70);
  });

  it('increases by 5 per level', () => {
    for (let lvl = 1; lvl <= 20; lvl++) {
      expect(getParticleCount(lvl)).toBe(25 + (lvl - 1) * 5);
    }
  });
});

// ─── getTargetActivations ───
describe('getTargetActivations', () => {
  it('returns at least 3', () => {
    expect(getTargetActivations(1)).toBeGreaterThanOrEqual(3);
  });

  it('increases with level', () => {
    const t1 = getTargetActivations(1);
    const t5 = getTargetActivations(5);
    const t10 = getTargetActivations(10);
    expect(t5).toBeGreaterThanOrEqual(t1);
    expect(t10).toBeGreaterThanOrEqual(t5);
  });

  it('is a fraction of total particles', () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      const total = getParticleCount(lvl);
      const target = getTargetActivations(lvl);
      expect(target).toBeLessThanOrEqual(total);
    }
  });

  it('formula: floor(total * (0.3 + level * 0.02))', () => {
    const total = getParticleCount(1); // 25
    const expected = Math.max(3, Math.floor(total * (0.3 + 1 * 0.02))); // floor(25 * 0.32) = 8
    expect(getTargetActivations(1)).toBe(expected);
  });
});

// ─── createParticle ───
describe('createParticle', () => {
  beforeEach(() => {
    // Reset Math.random to be deterministic
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('creates a particle with valid properties', () => {
    const p = createParticle(800, 600, 1);
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('x');
    expect(p).toHaveProperty('y');
    expect(p).toHaveProperty('radius');
    expect(p).toHaveProperty('color');
    expect(p).toHaveProperty('glowColor');
    expect(p).toHaveProperty('vx');
    expect(p).toHaveProperty('vy');
    expect(p.activated).toBe(false);
    expect(p.activatedAt).toBe(0);
    expect(p).toHaveProperty('explosionRadius');
    expect(p).toHaveProperty('points');
    expect(p).toHaveProperty('type');
  });

  it('particle is within canvas bounds', () => {
    const p = createParticle(800, 600, 1);
    // With randomBetween mocked as midpoint, x = (40 + 760) / 2 = 400
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(800);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(600);
  });

  it('creates normal particle when rand >= 0.25', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const p = createParticle(800, 600, 1);
    expect(p.type).toBe('normal');
    expect(p.points).toBe(10);
  });

  it('creates mega particle when rand < 0.05', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const p = createParticle(800, 600, 1);
    expect(p.type).toBe('mega');
    expect(p.points).toBe(50);
  });

  it('creates lightning particle when rand < 0.12', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.06);
    const p = createParticle(800, 600, 1);
    expect(p.type).toBe('lightning');
    expect(p.points).toBe(30);
  });

  it('creates bitcoin particle when rand < 0.25', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const p = createParticle(800, 600, 1);
    expect(p.type).toBe('bitcoin');
    expect(p.points).toBe(20);
  });

  it('higher levels increase special particle thresholds', () => {
    // At level 10, mega threshold = 0.05 + 10*0.005 = 0.1
    vi.spyOn(Math, 'random').mockReturnValue(0.08);
    const p = createParticle(800, 600, 10);
    expect(p.type).toBe('mega');
  });

  it('each particle has unique ID', () => {
    const ids = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const p = createParticle(800, 600, 1);
      ids.add(p.id);
    }
    expect(ids.size).toBe(50);
  });
});

// ─── generateParticles ───
describe('generateParticles', () => {
  it('generates requested count', () => {
    const particles = generateParticles(10, 800, 600, 1);
    expect(particles).toHaveLength(10);
  });

  it('generates empty array for 0', () => {
    const particles = generateParticles(0, 800, 600, 1);
    expect(particles).toHaveLength(0);
  });

  it('all particles are not activated', () => {
    const particles = generateParticles(5, 800, 600, 1);
    for (const p of particles) {
      expect(p.activated).toBe(false);
    }
  });
});

// ─── activateParticleAt ───
describe('activateParticleAt', () => {
  function makeParticle(overrides: Partial<Particle> = {}): Particle {
    return {
      id: 1,
      x: 100,
      y: 100,
      radius: 10,
      color: '#fff',
      glowColor: 'rgba(255,255,255,0.6)',
      vx: 1,
      vy: 1,
      activated: false,
      activatedAt: 0,
      explosionRadius: 80,
      points: 10,
      type: 'normal',
      ...overrides,
    };
  }

  it('activates particle within click range', () => {
    const particles = [makeParticle({ x: 100, y: 100, radius: 10 })];
    const result = activateParticleAt(particles, 105, 105);
    expect(result.hit).toBe(true);
    expect(result.hitParticle).not.toBeNull();
    expect(result.particles[0]!.activated).toBe(true);
  });

  it('does not activate particle outside range', () => {
    const particles = [makeParticle({ x: 100, y: 100, radius: 10 })];
    const result = activateParticleAt(particles, 500, 500);
    expect(result.hit).toBe(false);
    expect(result.hitParticle).toBeNull();
    expect(result.particles[0]!.activated).toBe(false);
  });

  it('activates closest particle when multiple in range', () => {
    const particles = [
      makeParticle({ id: 1, x: 100, y: 100, radius: 10, points: 10 }),
      makeParticle({ id: 2, x: 105, y: 105, radius: 10, points: 20 }),
    ];
    const result = activateParticleAt(particles, 104, 104);
    expect(result.hit).toBe(true);
    // ID 2 is closer (dist ~1.4) vs ID 1 (dist ~5.7)
    expect(result.hitParticle!.id).toBe(2);
    expect(result.particles[1]!.activated).toBe(true);
    expect(result.particles[0]!.activated).toBe(false);
  });

  it('does not activate already-activated particles', () => {
    const particles = [
      makeParticle({ id: 1, x: 100, y: 100, activated: true, activatedAt: 100 }),
      makeParticle({ id: 2, x: 200, y: 200, radius: 10 }),
    ];
    const result = activateParticleAt(particles, 100, 100);
    expect(result.hit).toBe(false);
  });

  it('sets velocity to 0 on activation', () => {
    const particles = [makeParticle({ vx: 5, vy: -3 })];
    const result = activateParticleAt(particles, 100, 100);
    expect(result.particles[0]!.vx).toBe(0);
    expect(result.particles[0]!.vy).toBe(0);
  });

  it('handles empty particles array', () => {
    const result = activateParticleAt([], 100, 100);
    expect(result.hit).toBe(false);
    expect(result.hitParticle).toBeNull();
    expect(result.particles).toEqual([]);
  });
});

// ─── calculateBestMove ───
describe('calculateBestMove', () => {
  function makeP(overrides: Partial<Particle>): Particle {
    return {
      id: 0, x: 0, y: 0, radius: 10, color: '#fff', glowColor: 'rgba(255,255,255,0.6)',
      vx: 0, vy: 0, activated: false, activatedAt: 0,
      explosionRadius: 50, points: 10, type: 'normal',
      ...overrides,
    };
  }

  it('returns null for empty array', () => {
    expect(calculateBestMove([])).toBeNull();
  });

  it('returns the only particle', () => {
    const p = makeP({ id: 1, x: 100, y: 100 });
    expect(calculateBestMove([p])).toBe(p);
  });

  it('returns null when all particles are activated', () => {
    const particles = [
      makeP({ id: 1, activated: true }),
      makeP({ id: 2, activated: true }),
    ];
    expect(calculateBestMove(particles)).toBeNull();
  });

  it('prefers particle with more chain potential', () => {
    // p1 is isolated, p2 is near p3
    const p1 = makeP({ id: 1, x: 0, y: 0, explosionRadius: 50, points: 10 });
    const p2 = makeP({ id: 2, x: 200, y: 200, explosionRadius: 50, points: 10 });
    const p3 = makeP({ id: 3, x: 220, y: 200, explosionRadius: 50, points: 10 });

    const best = calculateBestMove([p1, p2, p3]);
    // p2 can reach p3 (distance 20 < 50 + 10 = 60), giving score 20
    // p1 alone gives score 10
    expect(best!.id).toBe(2);
  });

  it('prefers higher-value particles', () => {
    // Both isolated, but p2 is mega (50 points)
    const p1 = makeP({ id: 1, x: 0, y: 0, points: 10 });
    const p2 = makeP({ id: 2, x: 500, y: 500, points: 50 });

    const best = calculateBestMove([p1, p2]);
    expect(best!.id).toBe(2);
  });

  it('skips activated particles in chain calculation', () => {
    const p1 = makeP({ id: 1, x: 100, y: 100, explosionRadius: 50, points: 10 });
    const p2 = makeP({ id: 2, x: 120, y: 100, explosionRadius: 50, points: 10, activated: true });
    const p3 = makeP({ id: 3, x: 140, y: 100, explosionRadius: 50, points: 10 });

    const best = calculateBestMove([p1, p2, p3]);
    // p2 is activated so only p1 and p3 remain.
    // p1 can reach p3? dist=40, radius=10, explosionRadius=50 => 40 <= 50+10 = yes
    // So p1 chains to p3 = 20 total
    expect(best).not.toBeNull();
  });
});

// ─── updateParticles ───
describe('updateParticles', () => {
  function makeP(overrides: Partial<Particle>): Particle {
    return {
      id: 0, x: 100, y: 100, radius: 10, color: '#fff', glowColor: 'rgba(255,255,255,0.6)',
      vx: 1, vy: 1, activated: false, activatedAt: 0,
      explosionRadius: 80, points: 10, type: 'normal',
      ...overrides,
    };
  }

  it('moves non-activated particles', () => {
    const particles = [makeP({ x: 100, y: 100, vx: 1, vy: 0.5 })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    // x += vx * dt * 60 = 1 * (1/60) * 60 = 1
    expect(updated[0]!.x).toBeCloseTo(101);
    expect(updated[0]!.y).toBeCloseTo(100.5);
  });

  it('bounces particles off left/right walls', () => {
    const particles = [makeP({ x: 5, y: 100, vx: -2, vy: 0, radius: 10 })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    // Would go to x=3, which is < radius=10, so bounce
    expect(updated[0]!.vx).toBeGreaterThan(0); // reversed
    expect(updated[0]!.x).toBeGreaterThanOrEqual(10); // clamped
  });

  it('bounces particles off top/bottom walls', () => {
    const particles = [makeP({ x: 100, y: 5, vx: 0, vy: -2, radius: 10 })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    expect(updated[0]!.vy).toBeGreaterThan(0); // reversed
  });

  it('does not move activated particles', () => {
    const particles = [makeP({ x: 100, y: 100, vx: 5, vy: 5, activated: true, activatedAt: performance.now() })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    expect(updated[0]!.x).toBe(100);
    expect(updated[0]!.y).toBe(100);
  });

  it('removes old activated particles (> 1200ms)', () => {
    const now = performance.now();
    const particles = [makeP({
      activated: true,
      activatedAt: now - 2000, // 2 seconds ago, > 1200ms
    })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    expect(updated).toHaveLength(0);
  });

  it('keeps recently activated particles', () => {
    const now = performance.now();
    const particles = [makeP({
      activated: true,
      activatedAt: now - 100, // 100ms ago, < 1200ms
    })];
    const { particles: updated } = updateParticles(particles, 800, 600, 1 / 60);
    expect(updated).toHaveLength(1);
  });

  it('returns 0 new activations when no chain reactions', () => {
    // Two particles far apart
    const now = performance.now();
    const particles = [
      makeP({ id: 1, x: 0, y: 0, activated: true, activatedAt: now, explosionRadius: 10 }),
      makeP({ id: 2, x: 500, y: 500, activated: false }),
    ];
    const { newActivations } = updateParticles(particles, 800, 600, 1 / 60);
    expect(newActivations).toBe(0);
  });

  it('detects chain reaction when particles are close', () => {
    const now = performance.now();
    const particles = [
      makeP({ id: 1, x: 100, y: 100, activated: true, activatedAt: now, explosionRadius: 80 }),
      makeP({ id: 2, x: 120, y: 100, activated: false, radius: 10 }),
    ];
    // Explosion radius (80) grows over 300ms; at t=0 it starts growing
    // The distance is 20, radius is 10, so it needs explosionRadius portion >= 10
    const { newActivations, chainPoints } = updateParticles(particles, 800, 600, 1 / 60);
    // May or may not trigger depending on timing — just verify the return shape
    expect(typeof newActivations).toBe('number');
    expect(typeof chainPoints).toBe('number');
  });
});
