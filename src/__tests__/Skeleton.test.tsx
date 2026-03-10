/**
 * Skeleton.test.tsx -- Tests for src/components/Skeleton.tsx
 *
 * Covers: SkeletonLine, SkeletonCard, SkeletonTable, SkeletonOrderbook, SkeletonStyle
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkeletonLine, SkeletonCard, SkeletonTable, SkeletonOrderbook, SkeletonStyle } from '../components/Skeleton';

describe('Skeleton components', () => {
  describe('SkeletonLine', () => {
    it('renders a div with aria-hidden', () => {
      const { container } = render(<SkeletonLine />);
      const div = container.querySelector('div');
      expect(div).not.toBeNull();
      expect(div!.getAttribute('aria-hidden')).toBe('true');
    });

    it('uses default width 100% and height 14', () => {
      const { container } = render(<SkeletonLine />);
      const div = container.querySelector('div')!;
      expect(div.style.width).toBe('100%');
      expect(div.style.height).toBe('14px');
    });

    it('accepts custom width and height', () => {
      const { container } = render(<SkeletonLine width="50%" height={20} />);
      const div = container.querySelector('div')!;
      expect(div.style.width).toBe('50%');
      expect(div.style.height).toBe('20px');
    });

    it('accepts numeric width', () => {
      const { container } = render(<SkeletonLine width={200} />);
      const div = container.querySelector('div')!;
      expect(div.style.width).toBe('200px');
    });

    it('accepts custom style', () => {
      const { container } = render(<SkeletonLine style={{ marginBottom: 10 }} />);
      const div = container.querySelector('div')!;
      expect(div.style.marginBottom).toBe('10px');
    });
  });

  describe('SkeletonCard', () => {
    it('renders with default 3 rows', () => {
      const { container } = render(<SkeletonCard />);
      const card = container.querySelector('[aria-busy="true"]');
      expect(card).not.toBeNull();
      expect(card!.getAttribute('aria-label')).toBe('Loading content');
      // 1 header line + 3 row lines = 4 inner divs
      const innerDivs = card!.querySelectorAll('div[aria-hidden="true"]');
      expect(innerDivs.length).toBe(4);
    });

    it('renders with custom rows', () => {
      const { container } = render(<SkeletonCard rows={5} />);
      const card = container.querySelector('[aria-busy="true"]')!;
      const innerDivs = card.querySelectorAll('div[aria-hidden="true"]');
      expect(innerDivs.length).toBe(6); // 1 header + 5 rows
    });

    it('accepts custom style', () => {
      const { container } = render(<SkeletonCard style={{ background: 'red' }} />);
      const card = container.querySelector('[aria-busy="true"]')!;
      expect((card as HTMLElement).style.background).toBe('red');
    });
  });

  describe('SkeletonTable', () => {
    it('renders with default 5 rows and 4 cols', () => {
      const { container } = render(<SkeletonTable />);
      const table = container.querySelector('[aria-busy="true"]');
      expect(table).not.toBeNull();
      expect(table!.getAttribute('aria-label')).toBe('Loading table');
    });

    it('renders with custom rows and cols', () => {
      const { container } = render(<SkeletonTable rows={2} cols={3} />);
      const table = container.querySelector('[aria-busy="true"]')!;
      // Header grid + 2 row grids = 3 grid containers
      const grids = table.querySelectorAll('div[style*="grid"]');
      expect(grids.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('SkeletonOrderbook', () => {
    it('renders two skeleton cards in a grid', () => {
      const { container } = render(<SkeletonOrderbook />);
      const cards = container.querySelectorAll('[aria-busy="true"]');
      expect(cards.length).toBe(2);
    });
  });

  describe('SkeletonStyle', () => {
    it('renders a style tag with keyframes', () => {
      const { container } = render(<SkeletonStyle />);
      const style = container.querySelector('style');
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain('skeletonShimmer');
    });
  });
});
