export interface Cell {
  row: number
  col: number
  colSpan: number
  rowSpan: number
}

export interface GridLayout {
  cols: number
  rows: number
  scrolls: boolean
  /** 'b' marks the shapes whose first pane is a tall column, so their resized gutters are kept apart from the plain grid of the same size. */
  variant: '' | 'b'
  /** Columns the row gutters skip, so a gutter never cuts through the tall first pane. */
  rowsFrom: number
  cells: Cell[]
}

const cell = (row: number, col: number, colSpan = 1, rowSpan = 1): Cell => ({ row, col, colSpan, rowSpan })

const plain = (count: number, cols: number): GridLayout => {
  const cells = Array.from({ length: count }, (_, index) => cell(Math.floor(index / cols) + 1, (index % cols) + 1))
  return { cols, rows: Math.ceil(count / cols), scrolls: false, variant: '', rowsFrom: 0, cells }
}

// First pane as a tall left column, the rest in a grid beside it.
const tallFirst = (count: number, sideCols: number): GridLayout => {
  const rest = Array.from({ length: count - 1 }, (_, index) =>
    cell(Math.floor(index / sideCols) + 1, (index % sideCols) + 2)
  )
  return { cols: sideCols + 1, rows: 2, scrolls: false, variant: 'b', rowsFrom: 1, cells: [cell(1, 1, 1, 2), ...rest] }
}

// Rows of 3 over a six-column track; a short tail becomes two half-width rows so no pane stands alone.
function scrolling(count: number): GridLayout {
  const tail = count % 3
  const pairRows = tail === 1 ? 2 : tail === 2 ? 1 : 0
  const pairs = pairRows * 2
  const cells: Cell[] = []
  let row = 1
  let index = 0
  while (index < count - pairs) {
    for (let slot = 0; slot < 3; slot += 1) cells.push(cell(row, slot * 2 + 1, 2))
    index += 3
    row += 1
  }
  for (let pair = 0; pair < pairRows; pair += 1) {
    cells.push(cell(row, 1, 3), cell(row, 4, 3))
    row += 1
  }
  return { cols: 6, rows: row - 1, scrolls: true, variant: '', rowsFrom: 0, cells }
}

export function layoutForCount(count: number): GridLayout {
  if (count <= 0) return { cols: 1, rows: 1, scrolls: false, variant: '', rowsFrom: 0, cells: [] }
  if (count === 1) return plain(1, 1)
  if (count === 2) return plain(2, 2)
  if (count === 3) return tallFirst(3, 1)
  if (count === 4) return plain(4, 2)
  if (count === 5) return tallFirst(5, 2)
  if (count === 6) return plain(6, 3)
  return scrolling(count)
}
