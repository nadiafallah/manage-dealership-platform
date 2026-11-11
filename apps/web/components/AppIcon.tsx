// One outline icon family for the whole interface (spec §12: icons only where meaning
// would be lost; line, uniform). 24px grid, 1.7 stroke, round caps. The former
// «Signature» drawings were removed with that theme in package 6.
export type IconName =
  | 'home' | 'car' | 'file' | 'add' | 'chart' | 'user' | 'team' | 'box' | 'money' | 'check' | 'settings' | 'database'
  | 'shield' | 'clock' | 'alert' | 'grid' | 'gauge' | 'wrench' | 'calendar' | 'upload' | 'desk' | 'sparkles' | 'truck'
  | 'bell' | 'shopping-cart' | 'folder' | 'search' | 'flag' | 'hammer' | 'paint' | 'battery' | 'history' | 'doc'
  | 'lock' | 'idcard' | 'book' | 'help' | 'logout' | 'menu' | 'close' | 'chevron-down' | 'chevron-left' | 'arrow-left'
  | 'arrow-right' | 'filter' | 'layers' | 'target' | 'login' | 'clipboard' | 'list' | 'return' | 'receipt' | 'spinner'
  | 'gear' | 'suspension' | 'send' | 'download' | 'print' | 'plus-circle';

const paths: Record<IconName, string> = {
  home: 'm3 10.5 9-7 9 7M5 9.5V21h14V9.5M9.5 21v-6h5v6',
  car: 'M5 11.5 6.8 6.6A2 2 0 0 1 8.7 5.3h6.6a2 2 0 0 1 1.9 1.3l1.8 4.9M3.5 17.5v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4M3.5 17.5h17M6 17.5V20h2.5v-2.5M15.5 17.5V20H18v-2.5M7 14.5h1.5M15.5 14.5H17',
  file: 'M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8L14 2.5Zm0 0V8h5.5M8.5 13h7M8.5 17h5',
  add: 'M12 5v14M5 12h14',
  chart: 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
  user: 'M16 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4.5 21v-1.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6V21',
  team: 'M14.5 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1M17.5 5.5a2.5 2.5 0 0 1 0 5M20 14.5a4 4 0 0 1 2 3.5V20',
  box: 'm3.5 7.5 8.5-4.5 8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12l8.5-4.5M12 12v9M7.8 5.3l8.5 4.5',
  money: 'M3 6h18v12H3V6Zm12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6.5 9v.01M17.5 15v.01',
  check: 'm4.5 12.5 5 5L19.5 7',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.6a7.5 7.5 0 0 1-2.2 1.3L14.5 21h-4l-.4-2.2A7.5 7.5 0 0 1 7.9 17.5l-1.9.6-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-3L4 9.3l2-3.4 1.9.6a7.5 7.5 0 0 1 2.2-1.3L10.5 3h4l.4 2.2c.8.3 1.5.7 2.2 1.3l1.9-.6 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 3Z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.6a7.5 7.5 0 0 1-2.2 1.3L14.5 21h-4l-.4-2.2A7.5 7.5 0 0 1 7.9 17.5l-1.9.6-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-3L4 9.3l2-3.4 1.9.6a7.5 7.5 0 0 1 2.2-1.3L10.5 3h4l.4 2.2c.8.3 1.5.7 2.2 1.3l1.9-.6 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 3Z',
  database: 'M4 6.5c0-3.3 16-3.3 16 0s-16 3.3-16 0Zm0 0v11c0 3.3 16 3.3 16 0v-11M4 12c0 3.3 16 3.3 16 0',
  shield: 'm12 2.5 8 3.5v6c0 4.7-3.4 8.2-8 9.5-4.6-1.3-8-4.8-8-9.5V6l8-3.5Zm-3.5 9.5 2.5 2.5 4.5-5',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  alert: 'M10.3 4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0ZM12 9.5v4M12 17v.01',
  grid: 'M4 4h6.5v6.5H4V4Zm9.5 0H20v6.5h-6.5V4ZM4 13.5h6.5V20H4v-6.5Zm9.5 0H20V20h-6.5v-6.5Z',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 15l4-5M12 15h.01',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4a4 4 0 0 0-5-5l2.6 2.6-.6 2.4-2.4.6-2.6-2.6',
  calendar: 'M4 6h16v14H4V6Zm0 4h16M8 3.5v4M16 3.5v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01',
  upload: 'M12 15V4m0 0-4 4m4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  desk: 'M3 5h18v4H3V5Zm2 4v11M19 9v11M9 13h6',
  sparkles: 'm12 3 1.8 5.7L19.5 10.5l-5.7 1.8L12 18l-1.8-5.7L4.5 10.5l5.7-1.8L12 3Zm6.5 12 .8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z',
  truck: 'M3 7h11v10H3V7Zm11 3h4l3 4v3h-7v-7ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  bell: 'M18 9.5a6 6 0 0 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 16 18 9.5ZM10 20.5a2 2 0 0 0 4 0',
  'shopping-cart': 'M2.5 3.5h2L7 15.5h11.5l2.5-8.5H5.3M9 20h.01M18 20h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-5.2-5.2',
  flag: 'M5 21V4M5 4h11.5l-2 4 2 4H5',
  hammer: 'm13.5 7.5-9 9a2.1 2.1 0 0 0 3 3l9-9M12 4l3-1 6 6-1 3-2-2-2 2-4-4 2-2-2-2Z',
  paint: 'M17 3H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM19 6.5h1.5V12l-8.5 1.5V15M10.5 15h3v6h-3v-6Z',
  battery: 'M4 7h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm3-3v3m10-3v3M7 13h3m5-1.5v3M13.5 13h3',
  suspension: 'M4 12h3m10 0h3M7 9.5h10v5H7v-5ZM10 9.5V7m4 2.5V7M10 17v-2.5m4 2.5v-2.5',
  history: 'M3 12a9 9 0 1 0 2.6-6.3L3 8.3M3 3.5v4.8h4.8M12 7.5V12l3 2',
  doc: 'M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 12h6M9 16h6',
  clipboard: 'M9 4h6v3H9V4ZM7 5.5H5.5v15h13v-15H17M8.5 11h7M8.5 15h5',
  lock: 'M6 10.5h12v10H6v-10Zm2.5 0V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5',
  idcard: 'M3.5 5.5h17v13h-17v-13ZM9 11.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM6 15.5c.5-1.6 1.6-2.3 3-2.3s2.5.7 3 2.3M14 9.5h4M14 12.5h4M14 15.5h2.5',
  book: 'M4 5.5c2.7-1 5.3-1 8 .8v13.4c-2.7-1.8-5.3-1.8-8-.8V5.5Zm16 0c-2.7-1-5.3-1-8 .8v13.4c2.7-1.8 5.3-1.8 8-.8V5.5Z',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17v.01',
  logout: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10',
  login: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M18 12H8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-left': 'm15 6-6 6 6 6',
  'arrow-left': 'M19 12H5m0 0 6-6m-6 6 6 6',
  'arrow-right': 'M5 12h14m0 0-6-6m6 6-6 6',
  filter: 'M4 6h16M7 12h10M10 18h4',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16.5l9 5 9-5',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM12 12h.01M12 12l7-7',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  return: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  receipt: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Zm4 5h6M9 11h6M9 14h4',
  spinner: 'M12 3a9 9 0 1 1-9 9',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z',
  print: 'M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7v-7Z',
  'plus-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 8v8M8 12h8',
};

export function AppIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`app-icon ${className}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
