export function checkVersions(packageVersion: string, changelog: string, requestedVersion: string): { ok: boolean; reason: string }
export function expectedAssets(version: string): string[]
export function siteVersion(html: string): string | null
