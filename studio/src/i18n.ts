import { useSyncExternalStore } from 'react';

/**
 * Studio UI language (Thai / English). Shares the `nvx-lang` localStorage key with the rest of
 * devstack.bid, so the language picked on any page carries over to /studio and back.
 * Agent log lines (CodeAgent (llm) → …) stay English: they are technical output, like a terminal.
 */
export type Lang = 'en' | 'th';
const KEY = 'nvx-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'th' || saved === 'en') return saved;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('th') ? 'th' : 'en';
}

let current: Lang | null = null;
const listeners = new Set<() => void>();

function get(): Lang {
  if (!current) current = typeof window === 'undefined' ? 'en' : detect();
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const STRINGS = {
  'nav.home': { en: 'Home', th: 'หน้าแรก' },
  'nav.chat': { en: 'Chat', th: 'แชต' },
  'nav.docs': { en: 'Docs', th: 'เอกสาร' },
  'nav.guide': { en: 'Studio guide', th: 'คู่มือ Studio' },
  'nav.learn': { en: 'Learn', th: 'เรียนรู้' },
  'brand.tagline': { en: 'Build full-stack apps with AI agents, in your browser', th: 'สร้างแอป full-stack ด้วย AI agent ในเบราว์เซอร์' },
  'lang.toggle': { en: 'ไทย', th: 'EN' },
  'lang.label': { en: 'Switch language to Thai', th: 'เปลี่ยนภาษาเป็นอังกฤษ' },
  'header.assets': { en: 'Assets', th: 'ภาพ' },
  'header.export': { en: 'DEPLOY / EXPORT', th: 'บันทึก / ดาวน์โหลด' },
  'header.export.short': { en: 'Save', th: 'บันทึก' },
  'chip.quota': { en: 'Free today', th: 'ฟรีวันนี้' },
  'chip.quota.short': { en: '{calls} AI · {images} img', th: 'เหลือ {calls} ครั้ง · ภาพ {images}' },
  'chip.status.ready': { en: 'Ready to build', th: 'พร้อมสร้างแล้ว' },
  'chip.status.starting': { en: 'Getting ready…', th: 'กำลังเตรียม…' },
  'chip.status.error': { en: 'Something went wrong', th: 'มีปัญหา ลองรีเฟรช' },
  'chip.image': { en: 'Image', th: 'ภาพ' },
  'chip.sandbox': { en: 'Preview', th: 'พรีวิว' },
  'chip.db': { en: 'Data', th: 'ข้อมูล' },
  'chip.db.ready': { en: 'ready', th: 'พร้อม' },
  'chip.db.starting': { en: 'starting', th: 'กำลังเปิด' },
  'chat.title': { en: 'Build with AI', th: 'สร้างด้วย AI' },
  'chat.subtitle': { en: 'Tell us what you want — we write the app', th: 'บอกสิ่งที่อยากได้ — เราช่วยเขียนแอปให้' },
  'chat.welcome': {
    en: 'Studio is ready. Describe an app (try “build a todo app”). We will write the code, set up the data, and draw pictures. You can also import a Markdown brief.',
    th: 'Studio พร้อมแล้ว บอกเราว่าอยากได้แอปอะไร (ลอง “สร้างแอป todo”) เราจะช่วยเขียนโค้ด จัดข้อมูล และวาดภาพให้ นำเข้าไฟล์ Markdown ได้ถ้ามีรายละเอียด',
  },
  'chat.import': { en: 'Import note', th: 'นำเข้าโน้ต' },
  'chat.demo': { en: 'Try: build a todo app', th: 'ลอง: สร้างแอป todo' },
  'chat.placeholder': { en: 'Describe what to build…', th: 'อธิบายสิ่งที่อยากสร้าง…' },
  'chat.run': { en: 'Build', th: 'สร้าง' },
  'chat.thinking': { en: 'Working', th: 'กำลังทำงาน' },
  'chat.idle': { en: 'Idle', th: 'ว่าง' },
  'chat.greeting': { en: 'What should we build?', th: 'อยากสร้างอะไรดี?' },
  'chat.stop': { en: 'Stop', th: 'หยุด' },
  'chat.regenerate': { en: 'Regenerate', th: 'สร้างใหม่' },
  'chat.attach': { en: 'Attach Markdown brief', th: 'แนบไฟล์ Markdown' },
  'chat.attach.remove': { en: 'Remove attachment', th: 'ลบไฟล์แนบ' },
  'chat.streaming': { en: 'Building… ({agent})', th: 'กำลังสร้าง… ({agent})' },
  'chat.model': { en: 'Model', th: 'โมเดล' },
  'chat.model.hint': {
    en: 'Uses the live Studio model from the server. Offline mode uses local mock agents.',
    th: 'ใช้โมเดล Studio จากเซิร์ฟเวอร์จริง โหมดออฟไลน์ใช้ agent ในเครื่อง',
  },
  'chat.suggest.todo': { en: 'Build a todo app', th: 'สร้างแอป todo' },
  'chat.suggest.habit': { en: 'Habit tracker with streaks', th: 'ติดตามนิสัย + สตรีค' },
  'chat.suggest.notes': { en: 'Notes app with tags', th: 'แอปโน้ตพร้อมแท็ก' },
  'chat.suggest.landing': { en: 'Landing page + hero image', th: 'หน้า landing + ภาพฮีโร่' },
  'chat.artifact.preview': { en: 'Open preview', th: 'เปิดพรีวิว' },
  'chat.artifact.code': { en: 'View code', th: 'ดูโค้ด' },
  'chat.artifact.assets': { en: 'View pictures', th: 'ดูภาพ' },
  'assets.title': { en: 'Pictures', th: 'ภาพประกอบ' },
  'assets.close': { en: 'Close pictures', th: 'ปิดแผงภาพ' },
  'assets.prompt': { en: 'Describe the picture…', th: 'อธิบายภาพที่อยากได้…' },
  'assets.empty': { en: 'No pictures yet.', th: 'ยังไม่มีภาพ' },
  'assets.generate': { en: 'Generate image', th: 'สร้างภาพ' },
  'assets.generating': { en: 'Generating…', th: 'กำลังสร้าง…' },
  'inspector.title': { en: 'Your data', th: 'ข้อมูลในแอป' },
  'inspector.subtitle': { en: 'Tables created for this app', th: 'ตารางที่สร้างให้แอปนี้' },
  'inspector.noRows': { en: 'No rows yet.', th: 'ยังไม่มีข้อมูล' },
  'inspector.vectorPlaceholder': { en: 'Search by meaning, e.g. “tasks”', th: 'ค้นหาตามความหมาย เช่น “งาน”' },
  'inspector.vectorHelp': { en: 'Search notes and table descriptions by meaning.', th: 'ค้นหาโน้ตและคำอธิบายตารางตามความหมาย' },
  'inspector.tab.grid': { en: 'Table', th: 'ตาราง' },
  'inspector.tab.schema': { en: 'Structure', th: 'โครงสร้าง' },
  'inspector.tab.vector': { en: 'Search', th: 'ค้นหา' },
  'inspector.tab.sql': { en: 'SQL', th: 'SQL' },
  'inspector.collapse': { en: 'Hide', th: 'ซ่อน' },
  'inspector.expand': { en: 'Show data', th: 'ดูข้อมูล' },
  'export.title': { en: 'Save your app', th: 'บันทึกแอปของคุณ' },
  'export.subtitle': { en: 'Download a zip with code, data and pictures — ready to host.', th: 'ดาวน์โหลดไฟล์ zip มีโค้ด ข้อมูล และภาพ พร้อมเอาไปโฮสต์' },
  'export.close': { en: 'Close', th: 'ปิด' },
  'export.download': { en: 'Download zip', th: 'ดาวน์โหลด zip' },
  'common.close': { en: 'Close', th: 'ปิด' },
  'preview.static': { en: 'live preview', th: 'พรีวิวสด' },
  'preview.static.hint': {
    en: 'Runs safely in your browser. Only React is available for now.',
    th: 'รันอย่างปลอดภัยในเบราว์เซอร์ของคุณ ตอนนี้ใช้ React ได้',
  },
  'preview.waiting': { en: 'Preview appears when the app is ready', th: 'พรีวิวจะโชว์เมื่อแอปพร้อม' },
  'preview.output': { en: 'Log', th: 'บันทึกการทำงาน' },
  'preview.title': { en: 'App preview', th: 'ตัวอย่างแอป' },
  'preview.reload': { en: 'Reload', th: 'รีโหลด' },
  'preview.live': { en: 'Live preview', th: 'พรีวิวสด' },
  'editor.files': { en: 'Files', th: 'ไฟล์' },
  'editor.reloadHint': { en: 'edits refresh the preview', th: 'แก้แล้วพรีวิวอัปเดต' },
  'mobile.nav': { en: 'Studio sections', th: 'เมนู Studio' },
  'mobile.tab.chat': { en: 'Chat', th: 'คุย' },
  'mobile.tab.preview': { en: 'Preview', th: 'ดูผล' },
  'mobile.tab.code': { en: 'Code', th: 'โค้ด' },
  'mobile.tab.data': { en: 'Data', th: 'ข้อมูล' },
  'mobile.tab.assets': { en: 'Pics', th: 'ภาพ' },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string>): string {
  let out: string = STRINGS[key][lang];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

export function useLang(): {
  lang: Lang;
  t: (key: StringKey, vars?: Record<string, string>) => string;
  setLang: (l: Lang) => void;
} {
  const lang = useSyncExternalStore(subscribe, get, () => 'en' as Lang);
  return { lang, t: (key, vars) => translate(lang, key, vars), setLang };
}
