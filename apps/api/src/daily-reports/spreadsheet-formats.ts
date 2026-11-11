// Format detection from content (not the file extension) and a strict,
// streaming-style reader for XML Spreadsheet 2003 (SpreadsheetML), which the
// Emdad Vijeh report exports with an .xls extension. No DOM, no DTD, no
// entities, no network, no formulas. Only two known exporter defects are
// repaired, and each repair is counted in the diagnostics.

export type SheetFormat = 'xlsx' | 'spreadsheetml' | 'html_table' | 'xls_binary' | 'unknown';

export function detectFormat(data: Uint8Array): SheetFormat {
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) return 'xlsx';
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) return 'xls_binary';
  // trimStart also removes a byte-order mark (U+FEFF is whitespace for it).
  const head = Buffer.from(data.subarray(0, 4096)).toString('utf8').trimStart();
  if (head.startsWith('<?xml') && /<Workbook\b/.test(head) && /urn:schemas-microsoft-com:office:spreadsheet/.test(head)) return 'spreadsheetml';
  // The business system's stock report is an HTML table saved with an .xls extension (spec section 11).
  if (/^<(!doctype\s+html|html|head|meta|body|table|style)\b/i.test(head) && /<table\b/i.test(Buffer.from(data.subarray(0, 262_144)).toString('latin1'))) return 'html_table';
  return 'unknown';
}

export const FORMAT_ERRORS: Record<Exclude<SheetFormat, 'xlsx' | 'spreadsheetml' | 'html_table'>, string> = {
  xls_binary: 'فایل XLS باینری (Excel 97-2003) هنوز پشتیبانی نمی‌شود؛ خروجی XML یا XLSX همان گزارش را بارگذاری کنید',
  unknown: 'قالب فایل شناخته نشد؛ فقط XLSX، جدول HTML با پسوند xls (گزارش موجودی کسب‌وکار) و XML Spreadsheet (خروجی امداد ویژه) پذیرفته می‌شوند',
};

export class SpreadsheetError extends Error {}

export interface ReaderLimits {
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
  maxMillis: number;
}
export const DEFAULT_LIMITS: ReaderLimits = { maxRows: 200_000, maxColumns: 256, maxCellChars: 10_000, maxMillis: 120_000 };

export interface Diagnostics {
  leadingWhitespace: number;
  unescapedAmpersands: number;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e]!,
  );

/**
 * Reads the first worksheet (or the one with the given name). Yields each row
 * as an array of cell texts (sparse ss:Index honoured); the header is row 1.
 */
export function readSpreadsheetML(data: Uint8Array, opts: { sheet?: string; limits?: Partial<ReaderLimits> } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const started = Date.now();
  let text = Buffer.from(data).toString('utf8');
  const diagnostics: Diagnostics = { leadingWhitespace: 0, unescapedAmpersands: 0 };
  // \s matches a byte-order mark too.
  const lead = /^\s*/.exec(text)![0].length;
  if (lead) {
    diagnostics.leadingWhitespace = lead;
    text = text.slice(lead);
  }
  if (!text.startsWith('<?xml')) throw new SpreadsheetError('ابتدای فایل XML معتبر نیست');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new SpreadsheetError('فایل شامل DTD یا ENTITY است و به دلایل امنیتی پذیرفته نمی‌شود');
  text = text.replace(/&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/g, () => {
    diagnostics.unescapedAmpersands += 1;
    return '&amp;';
  });

  const sheets = [...text.matchAll(/<Worksheet\b[^>]*\bss:Name="([^"]*)"[^>]*>/g)];
  if (!sheets.length) throw new SpreadsheetError('برگه‌ای در فایل پیدا نشد');
  const chosen = opts.sheet ? sheets.find((m) => decode(m[1]!) === opts.sheet) : sheets[0];
  if (!chosen) throw new SpreadsheetError(`برگه «${opts.sheet}» پیدا نشد`);
  const start = chosen.index! + chosen[0].length;
  const end = text.indexOf('</Worksheet>', start);
  if (end < 0) throw new SpreadsheetError('برگه کامل نیست (پایان Worksheet پیدا نشد)');
  const body = text.slice(start, end);
  text = '';

  function* rows(): Generator<string[]> {
    let pos = 0;
    let count = 0;
    for (;;) {
      const open = body.indexOf('<Row', pos);
      if (open < 0) return;
      const tagEnd = body.indexOf('>', open);
      if (tagEnd < 0) throw new SpreadsheetError('ردیف ناقص در فایل');
      if (body[tagEnd - 1] === '/') {
        pos = tagEnd + 1;
        count += 1;
        yield [];
        continue;
      }
      const close = body.indexOf('</Row>', tagEnd);
      if (close < 0) throw new SpreadsheetError('ردیف بسته نشده است');
      count += 1;
      if (count > limits.maxRows) throw new SpreadsheetError(`تعداد ردیف‌ها بیش از ${limits.maxRows} است`);
      if (count % 1000 === 0 && Date.now() - started > limits.maxMillis) throw new SpreadsheetError('خواندن فایل بیش از حد طول کشید');
      const inner = body.slice(tagEnd + 1, close);
      const cells: string[] = [];
      let col = 0;
      let read = 0;
      for (const c of inner.matchAll(/<Cell\b([^>]*?)(\/>|>([\s\S]*?)<\/Cell>)/g)) {
        read += 1;
        const idx = /\bss:Index="(\d+)"/.exec(c[1]!);
        if (idx) col = Number(idx[1]) - 1;
        if (col >= limits.maxColumns) throw new SpreadsheetError(`تعداد ستون‌ها بیش از ${limits.maxColumns} است`);
        const d = c[3] ? /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(c[3]) : null;
        const value = d ? decode(d[1]!.replace(/<[^>]+>/g, '')) : '';
        if (value.length > limits.maxCellChars) throw new SpreadsheetError('متن یک خانه بیش از حد طولانی است');
        cells[col] = value;
        const merge = /\bss:MergeAcross="(\d+)"/.exec(c[1]!);
        col += 1 + (merge ? Number(merge[1]) : 0);
      }
      // A malformed cell would shift later columns; refuse the file instead of guessing.
      if (read !== (inner.match(/<Cell\b/g) ?? []).length) throw new SpreadsheetError(`خانه ناقص در ردیف ${count} فایل؛ فایل را دوباره از سامانه مبدأ بگیرید`);
      pos = close + 6;
      yield Array.from(cells, (x) => x ?? '');
    }
  }

  return { sheetName: decode(chosen[1]!), sheetNames: sheets.map((m) => decode(m[1]!)), diagnostics, rows };
}

// ------------------------------------------------------------- HTML table

const HTML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', zwnj: '\u200c', zwj: '\u200d', lrm: '', rlm: '' };
const decodeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return HTML_ENTITY[e.toLowerCase()] ?? all;
  });

/** Charset declared in the first bytes (meta), otherwise UTF-8. Unknown labels fall back to UTF-8. */
function decodeText(data: Uint8Array): { text: string; charset: string } {
  const head = Buffer.from(data.subarray(0, 4096)).toString('latin1');
  const declared = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return { text: new TextDecoder(declared).decode(data), charset: declared };
  } catch {
    return { text: Buffer.from(data).toString('utf8'), charset: 'utf-8' };
  }
}

/**
 * Reads a table from an HTML file saved as .xls (the business system's stock
 * report). Leading whitespace and a byte-order mark are trimmed; scripts and
 * comments are ignored; colspan is honoured; cell text has tags removed and
 * entities decoded. The table whose first rows contain «کد کالا» is chosen
 * (Arabic ي/ك allowed), otherwise the largest one. Columns are found later by
 * their normalized names, never by position.
 */
export function readHtmlTable(data: Uint8Array, opts: { limits?: Partial<ReaderLimits>; headerProbe?: (cell: string) => boolean } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const started = Date.now();
  const decoded = decodeText(data);
  let text = decoded.text;
  const lead = /^\s*/.exec(text)![0].length;
  const diagnostics = { leadingWhitespace: lead, charset: decoded.charset, tables: 0 };
  text = text.slice(lead).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const tables = [...text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)].map((m) => m[1]!);
  diagnostics.tables = tables.length;
  if (!tables.length) throw new SpreadsheetError('جدولی در فایل پیدا نشد');
  const parseRows = (body: string): string[][] => {
    const out: string[][] = [];
    for (const r of body.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tr\s*>|<\/tbody|<\/thead|$)/gi)) {
      if (out.length >= limits.maxRows) throw new SpreadsheetError(`تعداد ردیف‌ها بیش از ${limits.maxRows} است`);
      if (out.length % 1000 === 0 && Date.now() - started > limits.maxMillis) throw new SpreadsheetError('خواندن فایل بیش از حد طول کشید');
      const cells: string[] = [];
      for (const c of r[1]!.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr\s*>|$)/gi)) {
        const raw = c[3]!.replace(/<\/t[dh]\s*>[\s\S]*$/i, '');
        const value = decodeHtml(raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (value.length > limits.maxCellChars) throw new SpreadsheetError('متن یک خانه بیش از حد طولانی است');
        const span = Math.min(Number(/\bcolspan\s*=\s*["']?(\d+)/i.exec(c[2]!)?.[1] ?? 1) || 1, limits.maxColumns);
        cells.push(value);
        for (let i = 1; i < span; i++) cells.push('');
        if (cells.length > limits.maxColumns) throw new SpreadsheetError(`تعداد ستون‌ها بیش از ${limits.maxColumns} است`);
      }
      out.push(cells);
    }
    return out;
  };
  const parsed = tables.map(parseRows);
  const probe = opts.headerProbe;
  const chosen = (probe && parsed.find((rows) => rows.slice(0, 20).some((r) => r.some(probe)))) ?? parsed.reduce((a, b) => (b.length > a.length ? b : a));
  return { sheetName: 'جدول HTML', sheetNames: parsed.map((_, i) => `جدول ${i + 1}`), diagnostics, rows: chosen };
}
