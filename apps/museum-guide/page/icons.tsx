// The dock's icons: one stroke weight, 24-unit grid.
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const MapIcon = () => <Icon><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" /><path d="M9 4v14M15 6v14" /></Icon>;
export const KeyboardIcon = () => <Icon><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></Icon>;
export const ScanIcon = () => <Icon><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><circle cx="12" cy="12" r="3.2" /></Icon>;
export const GuideIcon = () => <Icon><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" /></Icon>;
export const CameraIcon = () => <Icon><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.2l1.4-2h6.8l1.4 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><circle cx="12" cy="12.8" r="3.4" /></Icon>;
export const CameraOffIcon = () => <Icon><path d="M7.2 7H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 19h12.5M20.5 16.5v-8A1.5 1.5 0 0 0 19 7h-2.2l-1.4-2H8.6L8 5.9" /><path d="M3 3l18 18" /></Icon>;
export const InfoIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.01" /></Icon>;
export const GrowIcon = () => <Icon><path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" /></Icon>;
export const ShrinkIcon = () => <Icon><path d="M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6" /></Icon>;
