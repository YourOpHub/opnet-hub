export function truncateAddress(addr: string): string {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

export function randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function hslToString(h: number, s: number, l: number, a: number = 1): string {
    return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}
