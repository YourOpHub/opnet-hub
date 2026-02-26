import { Particle, GameState } from '../types';
import { randomBetween, distance } from '../utils/format';

const PARTICLE_COLORS = [
    { color: '#F7931A', glow: 'rgba(247, 147, 26, 0.6)' },   // Bitcoin orange
    { color: '#00F5FF', glow: 'rgba(0, 245, 255, 0.6)' },    // Cyan
    { color: '#A855F7', glow: 'rgba(168, 85, 247, 0.6)' },   // Purple
    { color: '#22C55E', glow: 'rgba(34, 197, 94, 0.6)' },    // Green
    { color: '#EC4899', glow: 'rgba(236, 72, 153, 0.6)' },   // Pink
    { color: '#FFD700', glow: 'rgba(255, 215, 0, 0.6)' },    // Gold
];

const BITCOIN_COLOR = { color: '#F7931A', glow: 'rgba(247, 147, 26, 0.8)' };
const LIGHTNING_COLOR = { color: '#FFD700', glow: 'rgba(255, 215, 0, 0.8)' };
const MEGA_COLOR = { color: '#EC4899', glow: 'rgba(236, 72, 153, 0.8)' };

let nextId = 0;

export function createParticle(
    canvasWidth: number,
    canvasHeight: number,
    level: number
): Particle {
    const padding = 40;
    const rand = Math.random();
    let type: Particle['type'] = 'normal';
    let points = 10;
    let radius = randomBetween(8, 16);
    let explosionRadius = randomBetween(60, 100);

    // Special particle types
    if (rand < 0.05 + level * 0.005) {
        type = 'mega';
        points = 50;
        radius = randomBetween(18, 24);
        explosionRadius = randomBetween(120, 160);
    } else if (rand < 0.12 + level * 0.01) {
        type = 'lightning';
        points = 30;
        radius = randomBetween(10, 14);
        explosionRadius = randomBetween(100, 140);
    } else if (rand < 0.25 + level * 0.015) {
        type = 'bitcoin';
        points = 20;
        radius = randomBetween(12, 18);
        explosionRadius = randomBetween(80, 120);
    }

    const colorSet =
        type === 'bitcoin' ? BITCOIN_COLOR :
            type === 'lightning' ? LIGHTNING_COLOR :
                type === 'mega' ? MEGA_COLOR :
                    PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];

    const speed = randomBetween(0.3, 1.2) + level * 0.05;
    const angle = randomBetween(0, Math.PI * 2);

    return {
        id: nextId++,
        x: randomBetween(padding, canvasWidth - padding),
        y: randomBetween(padding, canvasHeight - padding),
        radius,
        color: colorSet.color,
        glowColor: colorSet.glow,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        activated: false,
        activatedAt: 0,
        explosionRadius,
        points,
        type,
    };
}

export function createInitialState(level: number = 1): GameState {
    const baseParticles = 25;
    const particleCount = baseParticles + (level - 1) * 5;

    return {
        particles: [],
        score: 0,
        chain: 0,
        maxChain: 0,
        level,
        clicksRemaining: Math.max(1, 3 - Math.floor((level - 1) / 3)),
        totalClicks: Math.max(1, 3 - Math.floor((level - 1) / 3)),
        gamePhase: 'idle',
        combo: 0,
        particlesActivated: 0,
    };
}

export function generateParticles(
    count: number,
    canvasWidth: number,
    canvasHeight: number,
    level: number
): Particle[] {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
        particles.push(createParticle(canvasWidth, canvasHeight, level));
    }
    return particles;
}

export function getParticleCount(level: number): number {
    return 25 + (level - 1) * 5;
}

export function getTargetActivations(level: number): number {
    const total = getParticleCount(level);
    return Math.max(3, Math.floor(total * (0.3 + level * 0.02)));
}

export function updateParticles(
    particles: Particle[],
    canvasWidth: number,
    canvasHeight: number,
    deltaTime: number
): { particles: Particle[]; newActivations: number; chainPoints: number } {
    const now = performance.now();
    let newActivations = 0;
    let chainPoints = 0;

    const updated = particles.map(p => {
        // Move non-activated particles
        if (!p.activated) {
            let nx = p.x + p.vx * deltaTime * 60;
            let ny = p.y + p.vy * deltaTime * 60;
            let nvx = p.vx;
            let nvy = p.vy;

            // Bounce off walls
            if (nx - p.radius < 0 || nx + p.radius > canvasWidth) {
                nvx *= -1;
                nx = Math.max(p.radius, Math.min(canvasWidth - p.radius, nx));
            }
            if (ny - p.radius < 0 || ny + p.radius > canvasHeight) {
                nvy *= -1;
                ny = Math.max(p.radius, Math.min(canvasHeight - p.radius, ny));
            }

            return { ...p, x: nx, y: ny, vx: nvx, vy: nvy };
        }
        return p;
    });

    // Check chain reactions - activated particles affect nearby ones
    const activatedParticles = updated.filter(p => p.activated);
    const newlyActivated: Set<number> = new Set();

    for (const ap of activatedParticles) {
        const timeSinceActivation = now - ap.activatedAt;
        // Explosion grows over 300ms
        const currentExplosionRadius = Math.min(
            ap.explosionRadius,
            (timeSinceActivation / 300) * ap.explosionRadius
        );

        if (timeSinceActivation < 400) {
            for (const p of updated) {
                if (!p.activated && !newlyActivated.has(p.id)) {
                    const dist = distance(ap.x, ap.y, p.x, p.y);
                    if (dist < currentExplosionRadius + p.radius) {
                        newlyActivated.add(p.id);
                    }
                }
            }
        }
    }

    // Apply new activations
    const result = updated.map(p => {
        if (newlyActivated.has(p.id)) {
            newActivations++;
            chainPoints += p.points;
            return { ...p, activated: true, activatedAt: now, vx: 0, vy: 0 };
        }
        return p;
    });

    // Remove particles that have been activated for too long (fade out)
    const filtered = result.filter(p => {
        if (p.activated) {
            return now - p.activatedAt < 1200;
        }
        return true;
    });

    return { particles: filtered, newActivations, chainPoints };
}

export function activateParticleAt(
    particles: Particle[],
    x: number,
    y: number
): { particles: Particle[]; hit: boolean; hitParticle: Particle | null } {
    const now = performance.now();
    let hit = false;
    let hitParticle: Particle | null = null;

    // Find closest particle within click range
    let closestDist = Infinity;
    let closestIdx = -1;

    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.activated) continue;
        const dist = distance(x, y, p.x, p.y);
        if (dist < p.radius + 20 && dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
        }
    }

    if (closestIdx >= 0) {
        hit = true;
        hitParticle = particles[closestIdx];
    }

    const updated = particles.map((p, i) => {
        if (i === closestIdx) {
            return { ...p, activated: true, activatedAt: now, vx: 0, vy: 0 };
        }
        return p;
    });

    return { particles: updated, hit, hitParticle };
}

// Draw functions
export function drawParticle(
    ctx: CanvasRenderingContext2D,
    p: Particle,
    time: number
) {
    const now = performance.now();

    if (p.activated) {
        const timeSinceActivation = now - p.activatedAt;
        const progress = Math.min(1, timeSinceActivation / 1200);

        // Explosion effect
        if (timeSinceActivation < 400) {
            const explosionProgress = timeSinceActivation / 400;
            const currentRadius = p.explosionRadius * explosionProgress;

            // Explosion ring
            ctx.beginPath();
            ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
            ctx.strokeStyle = p.glowColor.replace(/[\d.]+\)$/, `${0.6 * (1 - explosionProgress)})`);
            ctx.lineWidth = 3 * (1 - explosionProgress);
            ctx.stroke();

            // Inner glow
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentRadius);
            gradient.addColorStop(0, p.glowColor.replace(/[\d.]+\)$/, `${0.3 * (1 - explosionProgress)})`));
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.fill();
        }

        // Fading core
        const opacity = 1 - progress;
        const scale = 1 + progress * 2;

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * scale, 0, Math.PI * 2);

        const coreGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * scale);
        coreGrad.addColorStop(0, '#fff');
        coreGrad.addColorStop(0.3, p.color);
        coreGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = coreGrad;
        ctx.fill();
        ctx.restore();

        // Spark particles
        if (timeSinceActivation < 600) {
            const sparkCount = p.type === 'mega' ? 12 : p.type === 'lightning' ? 8 : 5;
            for (let i = 0; i < sparkCount; i++) {
                const angle = (i / sparkCount) * Math.PI * 2 + timeSinceActivation * 0.003;
                const sparkDist = (timeSinceActivation / 600) * p.explosionRadius * 0.8;
                const sx = p.x + Math.cos(angle) * sparkDist;
                const sy = p.y + Math.sin(angle) * sparkDist;
                const sparkOpacity = 1 - timeSinceActivation / 600;

                ctx.beginPath();
                ctx.arc(sx, sy, 2, 0, Math.PI * 2);
                ctx.fillStyle = p.color.replace(')', `, ${sparkOpacity})`).replace('rgb', 'rgba');
                ctx.globalAlpha = sparkOpacity;
                ctx.fillStyle = p.color;
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }

        return;
    }

    // Floating animation
    const floatOffset = Math.sin(time * 0.002 + p.id * 0.5) * 2;

    // Glow
    ctx.beginPath();
    ctx.arc(p.x, p.y + floatOffset, p.radius + 6, 0, Math.PI * 2);
    const glowGrad = ctx.createRadialGradient(
        p.x, p.y + floatOffset, p.radius * 0.5,
        p.x, p.y + floatOffset, p.radius + 6
    );
    glowGrad.addColorStop(0, p.glowColor);
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(p.x, p.y + floatOffset, p.radius, 0, Math.PI * 2);
    const coreGrad = ctx.createRadialGradient(
        p.x - p.radius * 0.3, p.y + floatOffset - p.radius * 0.3, 1,
        p.x, p.y + floatOffset, p.radius
    );
    coreGrad.addColorStop(0, '#fff');
    coreGrad.addColorStop(0.4, p.color);
    coreGrad.addColorStop(1, p.color + '80');
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // Type indicator
    if (p.type === 'bitcoin') {
        ctx.font = `bold ${p.radius * 0.9}px ${getComputedStyle(document.body).getPropertyValue('--font-display') || 'monospace'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText('₿', p.x, p.y + floatOffset + 1);
    } else if (p.type === 'lightning') {
        ctx.font = `bold ${p.radius}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText('⚡', p.x, p.y + floatOffset + 1);
    } else if (p.type === 'mega') {
        ctx.font = `bold ${p.radius}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText('💎', p.x, p.y + floatOffset + 1);
    }
}

export function drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number
) {
    // Dark background
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Corner glow effects
    const cornerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.4);
    cornerGlow.addColorStop(0, 'rgba(247, 147, 26, 0.03)');
    cornerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = cornerGlow;
    ctx.fillRect(0, 0, width, height);

    const cornerGlow2 = ctx.createRadialGradient(width, height, 0, width, height, width * 0.4);
    cornerGlow2.addColorStop(0, 'rgba(0, 245, 255, 0.02)');
    cornerGlow2.addColorStop(1, 'transparent');
}

export function calculateBestMove(particles: Particle[]): Particle | null {
    if (particles.length === 0) return null;

    // Build adjacency list for fast lookup
    const adj = new Map<number, number[]>();
    for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        if (p1.activated) continue;
        const neighbors = [];
        for (let j = 0; j < particles.length; j++) {
            if (i === j) continue;
            const p2 = particles[j];
            if (p2.activated) continue;
            // If p1 explodes, does it hit p2?
            if (distance(p1.x, p1.y, p2.x, p2.y) <= p1.explosionRadius + p2.radius) {
                neighbors.push(p2.id);
            }
        }
        adj.set(p1.id, neighbors);
    }

    let bestParticle: Particle | null = null;
    let maxScore = -1;

    for (const p of particles) {
        if (p.activated) continue;

        const visited = new Set<number>();
        const queue = [p.id];
        visited.add(p.id);

        let score = 0;

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const currentP = particles.find(x => x.id === currentId);
            if (!currentP) continue;

            score += currentP.points;

            const neighbors = adj.get(currentId) || [];
            for (const n of neighbors) {
                if (!visited.has(n)) {
                    visited.add(n);
                    queue.push(n);
                }
            }
        }

        if (score > maxScore) {
            maxScore = score;
            bestParticle = p;
        }
    }

    return bestParticle;
}

