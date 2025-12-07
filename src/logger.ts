export class Logger {
    private static debugMode = false;

    static setDebug(enabled: boolean) {
        this.debugMode = enabled;
        if (enabled) {
            console.log('[ChatGPT-Exporter] Debug mode enabled');
        }
    }

    static isDebug() {
        return this.debugMode;
    }

    static info(module: string, ...args: any[]) {
        console.log(`[${module}]`, ...args);
    }

    static warn(module: string, ...args: any[]) {
        console.warn(`[${module}]`, ...args);
    }

    static error(module: string, ...args: any[]) {
        console.error(`[${module}]`, ...args);
    }

    static debug(module: string, ...args: any[]) {
        if (this.debugMode) {
            console.log(`[${module}] [DEBUG]`, ...args);
        }
    }
}
