export interface Particle {
    id: number;
    x: number;
    y: number;
    radius: number;
    color: string;
    glowColor: string;
    vx: number;
    vy: number;
    activated: boolean;
    activatedAt: number;
    explosionRadius: number;
    points: number;
    type: 'normal' | 'bitcoin' | 'lightning' | 'mega';
}

export interface GameState {
    particles: Particle[];
    score: number;
    chain: number;
    maxChain: number;
    level: number;
    clicksRemaining: number;
    totalClicks: number;
    gamePhase: 'idle' | 'playing' | 'chain-reacting' | 'ended';
    combo: number;
    particlesActivated: number;
}

export interface LeaderboardEntry {
    rank: number;
    address: string;
    score: number;
    chain: number;
    level: number;
    date: string;
}

export interface ScorePopup {
    id: number;
    x: number;
    y: number;
    text: string;
    createdAt: number;
}
