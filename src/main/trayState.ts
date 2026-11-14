let available = true

/** The tray is created once at startup; whether that worked decides if a hidden window can ever be shown again. */
export const setTrayAvailable = (value: boolean): void => { available = value }
export const trayAvailable = (): boolean => available
