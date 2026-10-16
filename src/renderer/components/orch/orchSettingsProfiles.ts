import { supportsEffort } from '../../../shared/orch/launch'
import { EFFORTS, ORCH_RUNNERS, type Effort, type OrchProfile, type OrchRunner, type OrchSettings } from '../../../shared/orch/profiles'
import { addProfile, deleteProfile, isBuiltInProfile, setProfileRole, updateProfile } from '../../../shared/orch/settingsEdit'
import { ORCH_ROLES, type OrchRole } from '../../../shared/orch/types'
import { h } from '../../dom'
import { confirmDialog } from '../dialogs'
import { toast } from '../toast'
import { ROLE_LABEL } from './orchUi'
import { current, persist, applyEdit, field, textInput, selectInput, checkbox, button, modelCell, effortLabel } from './orchSettingsControls'

const RUNNER_LABEL: Record<OrchRunner, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' }
let selectedProfileId: string | null = null

function selectedProfile(settings: OrchSettings): OrchProfile {
  return settings.profiles.find((p) => p.id === selectedProfileId) ?? settings.profiles[0]
}

function profileList(settings: OrchSettings, profile: OrchProfile, refresh: () => void): HTMLElement {
  const list = h('div', { class: 'orch-set-list', role: 'group', 'aria-label': 'Profiles' })
  for (const p of settings.profiles) {
    list.append(
      h(
        'button',
        {
          class: `orch-set-item${p.id === profile.id ? ' selected' : ''}`,
          type: 'button',
          id: `orch-set-profile-${p.id}`,
          'aria-pressed': String(p.id === profile.id),
          onClick: () => { selectedProfileId = p.id; refresh() }
        },
        h('span', { class: 'orch-set-item-name' }, p.name),
        h('span', { class: 'orch-set-item-meta' }, ROLE_LABEL[p.role]),
        modelCell(p),
        h('span', { class: 'orch-set-item-meta' }, `effort ${effortLabel(p)}`),
        p.local ? h('span', { class: 'orch-set-tag' }, 'local') : null
      )
    )
  }
  return list
}

function effortSelect(profile: OrchProfile): HTMLElement {
  const supported = supportsEffort(profile.runner)
  const options = supported
    ? [{ value: '', label: 'CLI default' }, ...EFFORTS.map((e) => ({ value: e, label: e }))]
    : [{ value: '', label: `Not supported by ${RUNNER_LABEL[profile.runner]}` }]
  return selectInput('orch-set-profile-effort', options, profile.effort ?? '', (value) => persist(updateProfile(current(), profile.id, { effort: (value || null) as Effort | null })), !supported)
}

function profileEditor(profile: OrchProfile, refresh: () => void): HTMLElement {
  const roleSelect = selectInput('orch-set-profile-role', ORCH_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), profile.role, (value) => {
    applyEdit(setProfileRole(current(), profile.id, value as OrchRole))
    refresh()
  })
  const runnerSelect = selectInput('orch-set-profile-runner', ORCH_RUNNERS.map((r) => ({ value: r, label: RUNNER_LABEL[r] })), profile.runner, (value) =>
    persist(updateProfile(current(), profile.id, { runner: value as OrchRunner }))
  )
  const prompt = h('textarea', { class: 'text-input orch-set-prompt', id: 'orch-set-profile-prompt', rows: 4, maxlength: 8000, placeholder: 'Added to the role\'s built-in prompt, for example house rules for this agent.' })
  prompt.value = profile.prompt
  prompt.addEventListener('change', () => persist(updateProfile(current(), profile.id, { prompt: prompt.value })))
  return h(
    'div',
    { class: 'orch-set-fields' },
    field('Name', 'orch-set-profile-name', textInput('orch-set-profile-name', profile.name, (name) => persist(updateProfile(current(), profile.id, { name: name.trim() || profile.name })))),
    field('Role', 'orch-set-profile-role', roleSelect),
    field('Runner', 'orch-set-profile-runner', runnerSelect),
    field('Model', 'orch-set-profile-model', textInput('orch-set-profile-model', profile.model, (model) => persist(updateProfile(current(), profile.id, { model: model.trim() })), { mono: true, placeholder: 'Empty uses the CLI default' }), 'A model name or alias such as opus or sonnet.'),
    field('Effort', 'orch-set-profile-effort', effortSelect(profile)),
    h(
      'div',
      { class: 'orch-set-field' },
      checkbox('orch-set-profile-local', 'Run locally through Ollama', profile.local, profile.runner !== 'codex', (local) => persist(updateProfile(current(), profile.id, { local }))),
      h('p', { class: 'orch-set-hint' }, profile.runner === 'codex' ? 'Local models are free and never get a price.' : 'Only Codex can run a local model.')
    ),
    h('div', { class: 'orch-set-field orch-set-wide' }, h('label', { for: 'orch-set-profile-prompt' }, 'Extra instructions'), prompt)
  )
}

async function deleteProfileFlow(profile: OrchProfile, refresh: () => void): Promise<void> {
  const check = deleteProfile(current(), profile.id)
  if (!check.ok) {
    toast(check.error)
    return
  }
  const confirmed = await confirmDialog({
    title: `Delete the profile "${profile.name}"?`,
    body: `The profile "${profile.name}" (${ROLE_LABEL[profile.role]}) will be removed. No plan uses it.`,
    confirmLabel: `Delete "${profile.name}"`
  })
  if (!confirmed) return
  if (applyEdit(deleteProfile(current(), profile.id))) selectedProfileId = null
  refresh()
}

export function profilesSection(settings: OrchSettings, refresh: () => void): HTMLElement {
  const profile = selectedProfile(settings)
  const copy = (sourceId?: string): void => {
    const added = addProfile(current(), profile.role, sourceId)
    persist(added.settings)
    selectedProfileId = added.profileId
    refresh()
  }
  const builtIn = isBuiltInProfile(profile.id)
  return h(
    'section',
    { class: 'orch-panel orch-set-section', 'aria-labelledby': 'orch-set-profiles-title' },
    h('h3', { class: 'orch-panel-title', id: 'orch-set-profiles-title' }, 'Agent profiles'),
    h(
      'div',
      { class: 'orch-set-body' },
      h('p', { class: 'orch-set-hint' }, 'A profile is one way to run a role: which CLI, which model and how much effort.'),
      profileList(settings, profile, refresh),
      profileEditor(profile, refresh),
      h(
        'div',
        { class: 'orch-set-actions' },
        button('orch-set-profile-new', 'New profile', () => copy()),
        button('orch-set-profile-dup', 'Duplicate', () => copy(profile.id)),
        button('orch-set-profile-delete', 'Delete', () => void deleteProfileFlow(profile, refresh), {
          danger: true,
          disabled: builtIn,
          title: builtIn ? 'Built-in profiles cannot be deleted' : `Delete the profile "${profile.name}"`
        })
      )
    )
  )
}
