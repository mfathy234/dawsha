import type { TextEdit } from '../../shared/codeNavExtras'
import type { ServerLocation } from './locations'

export interface ServerHover { display: string; documentation: string }
export interface ServerFileEdits { file: string; edits: TextEdit[] }
export interface ServerCall { name: string; symbol: ServerLocation; calls: ServerLocation[] }
export interface ExtrasPosition { line: number; column: number }
