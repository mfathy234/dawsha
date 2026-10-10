const svg = (size: number, body: string, stroke = 1.75): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICONS = {
  code: svg(16, '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  solution: svg(16, '<path d="M17 3l4 2v14l-4 2-10-8z"/><path d="M7 13l-4 3V8l4 3"/>'),
  terminal: svg(16, '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  diff: svg(16, '<path d="M12 3v12 M6 9h12 M6 20h12"/>'),
  commit: svg(16, '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5 M15.5 12H21"/>'),
  download: svg(16, '<path d="M12 3v12 M7 10l5 5 5-5 M5 21h14"/>'),
  copy: svg(16, '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  eraser: svg(16, '<path d="M20 20H9"/><path d="M4 15l9-9 6 6-7 7H8z"/>'),
  info: svg(16, '<circle cx="12" cy="12" r="9"/><path d="M12 11v6 M12 7.5v.5"/>'),
  folder: svg(16, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  folderLarge: svg(18, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: svg(14, '<path d="M12 5v14 M5 12h14"/>'),
  close: svg(16, '<path d="M18 6L6 18 M6 6l12 12"/>'),
  closeSmall: svg(10, '<path d="M18 6L6 18 M6 6l12 12"/>', 2),
  prev: svg(16, '<polyline points="15 18 9 12 15 6"/>'),
  next: svg(16, '<polyline points="9 18 15 12 9 6"/>'),
  maximize: svg(16, '<path d="M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7"/>'),
  restore: svg(16, '<path d="M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7"/>'),
  collapse: svg(16, '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>'),
  expand: svg(16, '<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>'),
  search: svg(16, '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  branch: svg(12, '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 7.5v9 M18 11.5c0 4-6 3-12 5.5"/>'),
  pin: svg(12, '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 4H7l3-4z"/>'),
  more: svg(16, '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', 2.5),
  history: svg(14, '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  chevronRight: svg(14, '<polyline points="9 18 15 12 9 6"/>'),
  chevronUp: svg(14, '<polyline points="18 15 12 9 6 15"/>'),
  chevronDown: svg(14, '<polyline points="6 9 12 15 18 9"/>'),
  compare: svg(14, '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>'),
  bolt: svg(14, '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  snippet: svg(14, '<path d="M5 6h14 M5 12h14 M5 18h9"/>'),
  layout: svg(14, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16 M3 12h9"/>'),
  palette: svg(16, '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="15.5" cy="10" r="1"/><path d="M12 21a2 2 0 0 1-2-2c0-1.5 1-1.5 1-3a2 2 0 0 1 2-2h3"/>'),
  settings: svg(16, '<path d="M10 2h4l.5 2.5 2 1 2.3-1.1 2 3.5-1.9 1.6v2.5l1.9 1.6-2 3.5-2.3-1.1-2 1L14 20h-4l-.5-2.5-2-1-2.3 1.1-2-3.5 1.9-1.6V10l-1.9-1.6 2-3.5 2.3 1.1 2-1L10 2Z"/><circle cx="12" cy="11" r="2.5"/>')
}

export const logoMark = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 256 256" role="img" aria-label="Dawsha logo"><rect x="8" y="8" width="240" height="240" rx="58" fill="var(--bg)"/><path d="M51 62h154a25 25 0 0 1 25 25v84a25 25 0 0 1-25 25h-74l-38 30v-30H51a25 25 0 0 1-25-25V87a25 25 0 0 1 25-25Z" fill="var(--accent)"/><path d="m61 114 27 19-27 19m56 1h34" fill="none" stroke="var(--on-accent)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><rect x="166" y="108" width="33" height="10" rx="5" fill="var(--on-accent)"/><rect x="166" y="128" width="33" height="10" rx="5" fill="var(--on-accent)"/><rect x="166" y="148" width="33" height="10" rx="5" fill="var(--on-accent)"/></svg>`
