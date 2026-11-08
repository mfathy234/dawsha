/** Dialogs and popovers that are on screen. A popover kept in the page while hidden is not open. */
export const OPEN_OVERLAY_SELECTOR = '.overlay:not(.leaving):not([hidden]), .popover:not(.leaving):not([hidden])'

/** True while any dialog or popover is open, so global shortcuts and focus restores stand back. */
export const isOverlayOpen = (): boolean => document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
