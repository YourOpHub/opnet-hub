/**
 * gameData.test.ts -- Tests for src/data/gameData.ts
 *
 * Covers: DEMO_LEADERBOARD, GAME_TIPS
 */
import { describe, it, expect } from 'vitest';

import { DEMO_LEADERBOARD, GAME_TIPS } from '../data/gameData';

describe('DEMO_LEADERBOARD', () => {
  it('has 8 entries', () => {
    expect(DEMO_LEADERBOARD).toHaveLength(8);
  });

  it('entries have required fields', () => {
    for (const entry of DEMO_LEADERBOARD) {
      expect(typeof entry.rank).toBe('number');
      expect(typeof entry.address).toBe('string');
      expect(typeof entry.score).toBe('number');
      expect(typeof entry.chain).toBe('number');
      expect(typeof entry.level).toBe('number');
      expect(typeof entry.date).toBe('string');
    }
  });

  it('ranks are in order 1-8', () => {
    for (let i = 0; i < DEMO_LEADERBOARD.length; i++) {
      expect(DEMO_LEADERBOARD[i]!.rank).toBe(i + 1);
    }
  });

  it('scores are in descending order', () => {
    for (let i = 1; i < DEMO_LEADERBOARD.length; i++) {
      expect(DEMO_LEADERBOARD[i]!.score).toBeLessThanOrEqual(DEMO_LEADERBOARD[i - 1]!.score);
    }
  });

  it('addresses start with opt1', () => {
    for (const entry of DEMO_LEADERBOARD) {
      expect(entry.address).toMatch(/^opt1/);
    }
  });
});

describe('GAME_TIPS', () => {
  it('has at least 5 tips', () => {
    expect(GAME_TIPS.length).toBeGreaterThanOrEqual(5);
  });

  it('all tips are non-empty strings', () => {
    for (const tip of GAME_TIPS) {
      expect(typeof tip).toBe('string');
      expect(tip.length).toBeGreaterThan(0);
    }
  });
});
