// Guilloche rosette, the RAISE "verified" mark (same geometry as the kiosk).
function rosettePath(cx: number, cy: number, R: number, r: number, d: number, steps = 720): string {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const total = Math.PI * 2 * (r / gcd(R, r));
    let path = "";
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * total;
        const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
        const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
        path += (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return path + "Z";
}

export function sealSVG(withCheck = true): string {
    return `<svg class="seal" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="seal-ring" cx="50" cy="50" r="47" pathLength="1"/>
        <path class="seal-line" pathLength="1" d="${rosettePath(50, 50, 40, 9, 12, 900)}"/>
        <path class="seal-line seal-line--b" pathLength="1" d="${rosettePath(50, 50, 36, 5, 9, 900)}"/>
        ${withCheck ? `<circle class="seal-core" cx="50" cy="50" r="17"/><path class="seal-check" pathLength="1" d="M42 50.5l5.5 5.5L59 44.5"/>` : ""}
    </svg>`;
}

/** Interlaced guilloche band (banknote linework) for the pass card header. */
export function waveBandSVG(width = 400, height = 56, strands = 8): string {
    let paths = "";
    for (let s = 0; s < strands; s++) {
        const phase = (s / strands) * Math.PI * 2;
        let d = "";
        for (let x = 0; x <= width; x += 2) {
            const y = height / 2 + Math.sin(x / 9 + phase) * (height * 0.36) * Math.cos(x / 61 + phase / 2);
            d += (x ? "L" : "M") + x + " " + y.toFixed(2);
        }
        paths += `<path d="${d}"/>`;
    }
    return `<svg class="guilloche-band" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
}
