import React from 'react';

const shimmer = `
@keyframes skeletonShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

const base: React.CSSProperties = {
  background: 'linear-gradient(90deg, var(--bg3) 25%, rgba(255,255,255,.04) 50%, var(--bg3) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeletonShimmer 1.5s ease-in-out infinite',
  borderRadius: 8,
};

export const SkeletonLine: React.FC<{ width?: string | number; height?: number; style?: React.CSSProperties }> = ({ width = '100%', height = 14, style }) => (
  <div style={{ ...base, width, height, ...style }} />
);

export const SkeletonCard: React.FC<{ rows?: number; style?: React.CSSProperties }> = ({ rows = 3, style }) => (
  <div className="P" style={{ padding: 16, ...style }}>
    <SkeletonLine width="40%" height={16} style={{ marginBottom: 12 }} />
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonLine key={i} width={`${70 + Math.random() * 30}%`} height={12} style={{ marginBottom: 8 }} />
    ))}
  </div>
);

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 4 }) => (
  <div className="P" style={{ padding: 16 }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, marginBottom: 12 }}>
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonLine key={i} height={12} width="80%" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, marginBottom: 10 }}>
        {Array.from({ length: cols }).map((_, c) => (
          <SkeletonLine key={c} height={14} />
        ))}
      </div>
    ))}
  </div>
);

export const SkeletonOrderbook: React.FC = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
    <SkeletonCard rows={4} />
    <SkeletonCard rows={4} />
  </div>
);

export const SkeletonStyle: React.FC = () => <style>{shimmer}</style>;

export default SkeletonCard;
