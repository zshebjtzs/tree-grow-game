// js/ai/StrategicPhaseDetector.js
/**
 * Produces overlapping strategic phase intensities. TreeGrow positions can
 * simultaneously demand expansion, defense, and siege preparation; no single
 * mutually-exclusive phase label is used to suppress the others.
 */
export class StrategicPhaseDetector {
    detect(position) {
        const signals = {
            expansion: this._clamp(position.expansionPotential),
            defense: this._clamp(position.defensivePressure),
            siege: this._clamp(position.siegePressure),
            multiRoot: this._clamp(position.multiRootCoordination),
            tactical: this._clamp(position.tacticalPressure),
            frontier: this._clamp(position.frontierControl)
        };
        const dominant = Object.entries(signals)
            .filter(([, value]) => value >= 0.35)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);
        return Object.freeze({ ...signals, dominant: Object.freeze(dominant) });
    }

    _clamp(value) {
        return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    }
}
