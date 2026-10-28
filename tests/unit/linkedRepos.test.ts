import { describe, expect, it } from 'vitest'
import { dedupeRoots, externalFolders, folderName, isAbsolutePath } from '../../src/shared/linkedRepos'

describe('externalFolders', () => {
  const project = 'C:\\Work\\Microtec_ERP'
  it('lists the folders of files outside the project, most touched first', () => {
    const paths = ['C:/Work/Keycloak/src/A.cs', 'C:/Work/Keycloak/src/B.cs', 'C:/Work/Pkgs/x.cs', 'C:/Work/Keycloak/src/C.cs']
    expect(externalFolders(paths, project)).toEqual(['C:/Work/Keycloak/src', 'C:/Work/Pkgs'])
  })
  it('ignores the project, its checkouts, relative paths and other noise', () => {
    const paths = ['c:/work/microtec_erp/a.ts', 'C:/Work/erp-wt/b.ts', 'src/rel.ts', '', '~/x']
    expect(externalFolders(paths, project, ['C:\\Work\\erp-wt'])).toEqual([])
  })
  it('does not treat a sibling with the same prefix as inside', () => {
    expect(externalFolders(['C:/Work/Microtec_ERP_Tools/a.ts'], project)).toEqual(['C:/Work/Microtec_ERP_Tools'])
  })
  it('understands posix and unc paths', () => {
    expect(isAbsolutePath('/home/a')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\a')).toBe(true)
    expect(isAbsolutePath('a/b')).toBe(false)
    expect(externalFolders(['/home/me/other/a.ts'], '/home/me/proj')).toEqual(['/home/me/other'])
  })
})

describe('dedupeRoots and folderName', () => {
  it('drops repeats regardless of case and separator', () => {
    expect(dedupeRoots(['C:\\A\\B', 'c:/a/b', 'C:/A/C'])).toEqual(['C:\\A\\B', 'C:/A/C'])
  })
  it('names a folder by its last part', () => {
    expect(folderName('C:\\Work\\Keycloak\\')).toBe('Keycloak')
  })
})
