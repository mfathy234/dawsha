import { toggleNotifications } from '../components/notificationBell'
import { registerCommands } from './registry'

export function installNotificationCommands(): void {
  registerCommands({
    id: 'notifications.open',
    title: 'Notifications',
    group: 'Actions',
    keywords: 'history alerts toasts messages bell unread needs',
    run: () => toggleNotifications()
  })
}
