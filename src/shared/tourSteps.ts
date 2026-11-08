export interface TourStep { target: string; title: string; body: string }

/** The guided tour, in order. A step whose target is not on screen is skipped. */
export const TOUR_STEPS: readonly TourStep[] = [
  { target: '#new-session', title: 'Start a session', body: 'Start Claude, Codex, Gemini or a shell in your project.' },
  { target: '.pane', title: 'Your sessions', body: 'Each agent runs in its own pane. Keep sessions side by side as you work.' },
  { target: '.pane-view [data-view="chat"]', title: 'Read as chat', body: 'Switch a session between its terminal and a readable chat.' },
  { target: '.chat-input', title: 'Message your agent', body: 'Use / for commands, @ for files, and Up to revisit earlier messages.' },
  { target: '#files-button', title: 'Review changed files', body: 'Browse, review and edit project files in Files.' },
  { target: '.pane-info', title: 'Session usage', body: 'See the model, context, tokens and cost. Select the meter for details.' },
  { target: '#notifications-button', title: 'See what needs you', body: 'Notifications keep messages and sessions that need attention together.' },
  { target: '#work-button', title: 'Review your work', body: 'Work shows what got done. Usage breaks down the cost.' }
]

export const TOUR_TEXT = {
  skip: 'Skip tour',
  back: 'Back',
  next: 'Next',
  done: 'Done',
  menu: 'Take the tour',
  dialog: 'Dawsha tour',
  stepOf: (step: number, total: number): string => `Step ${step} of ${total}`
} as const
