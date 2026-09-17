import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H18a1 1 0 0 1 1 1v13.5" /><path d="M4 5.5V19a1 1 0 0 0 1 1h14" /><path d="M8 9h7M8 13h5" /></>,
  slices: <><path d="M4 6h16M4 11h16M4 16h16" /><path d="M9 3v18" strokeDasharray="2 3" /><path d="M15 3v18" strokeDasharray="2 3" /></>,
  play: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5l5 2.5-5 2.5z" /></>,
  file: <><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4v5h5" /><path d="M8 13h7M8 16.5h4" /></>,
  xray: <><circle cx="11" cy="11" r="7" /><path d="M11 8v6M8 11h6" /><path d="M16.5 16.5L21 21" /></>,
  lab: <><path d="M9 3v6.5L4.5 17A2 2 0 0 0 6.2 20h11.6a2 2 0 0 0 1.7-3L15 9.5V3" /><path d="M8 3h8" /><path d="M7.2 14h9.6" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 20v-6M13 20V8M18 20v-9" /></>,
  columns: <><rect x="3" y="4" width="8" height="16" rx="1.5" /><rect x="13" y="4" width="8" height="16" rx="1.5" /></>,
  plug: <><path d="M9 3v6M15 3v6" /><path d="M6 9h12v3a6 6 0 0 1-12 0z" /><path d="M12 18v3" /></>,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  up: <path d="M12 19V6M6 12l6-6 6 6" />,
  down: <path d="M12 5v13M6 12l6 6 6-6" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>,
  warn: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  scales: <><path d="M12 4v16M7 20h10" /><path d="M5 9h14" /><path d="M5 9l-2.5 5a2.8 2.8 0 0 0 5 0z" /><path d="M19 9l-2.5 5a2.8 2.8 0 0 0 5 0z" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  chat: <><path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /><path d="M8 8h8M8 12h5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  trash: <><path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-1.6 5.4" /><path d="M20 5v6h-6" /></>,
  doc: <><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="M8 12h8M8 16h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9l-2 2M17 12v3" /></>,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  auto: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></>,
  free: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9h5M9.5 12h5M11 9v6" /></>,
}

export default function Glyph({ name, className = '', stroke = 'currentColor' }:
  { name: string; className?: string; stroke?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke}
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name] ?? PATHS.file}
    </svg>
  )
}
