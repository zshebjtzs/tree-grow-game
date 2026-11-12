export class AppState {
    constructor() {
        this.screen = 'menu';
        this.matchConfig = null;
    }

    navigate(screen) {
        if (!['menu', 'setup', 'game'].includes(screen)) {
            throw new TypeError(`Unknown application screen: ${screen}`);
        }
        this.screen = screen;
        return screen;
    }

    openSetup() {
        return this.navigate('setup');
    }

    startMatch(config) {
        if (!config || !['pvp', 'pve'].includes(config.mode) ||
            !['easy', 'medium', 'hard'].includes(config.difficulty) ||
            config.playerSide !== 'red') {
            throw new TypeError('Invalid match configuration');
        }
        this.matchConfig = Object.freeze({ ...config });
        this.screen = 'game';
        return this.matchConfig;
    }

    returnToMenu() {
        return this.navigate('menu');
    }
}
