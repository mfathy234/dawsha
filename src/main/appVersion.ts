import { app } from 'electron'

export const appVersion = (): string => process.env.DAWSHA_APP_VERSION || app.getVersion()
