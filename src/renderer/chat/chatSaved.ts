import { CHAT_TEXT } from '../../shared/chatStrings'
import { promptNameFrom, withoutToken } from '../../shared/savedPrompts'
import { toast } from '../components/toast'
import { askAndSavePrompt } from '../savedPromptActions'

/** Saves what is in the box after the `/save` token as a named prompt, then leaves just that text in the box. */
export async function saveFromBox(box: HTMLTextAreaElement, token: { start: number; end: number }): Promise<void> {
  const text = withoutToken(box.value, token)
  if (text === '') {
    toast(CHAT_TEXT.saveEmpty, 'info')
    return
  }
  const saved = await askAndSavePrompt(text, promptNameFrom(text), { title: CHAT_TEXT.saveTitle, label: CHAT_TEXT.saveName, confirmLabel: CHAT_TEXT.saveConfirm })
  if (!saved) return
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.focus()
  toast(CHAT_TEXT.saved(saved.name), 'info')
}
