// Bystander's marks, drawn like safety signage: the logo, one pictogram per
// kind of step (shown only once a step is resolved: before that, a picture of
// "call for help" would answer the question being asked), and one emblem per
// scene. Inline SVG, stroked in currentColor.
import type { ReactNode } from 'react';

export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg className="by-mark" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="7" fill="var(--by-green)" />
      <path d="M16 9h8v7h7v8h-7v7h-8v-7H9v-8h7z" fill="#fff" />
      <circle cx="31" cy="31" r="4.6" fill="var(--by-amber)" stroke="var(--by-green)" strokeWidth="2" />
    </svg>
  );
}

const Svg = ({ children, size = 24, label }: { children: ReactNode; size?: number; label?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {children}
  </svg>
);

/** One pictogram per step kind (the scenario content's `visual` key). */
const PICTOGRAMS: Record<string, ReactNode> = {
  scene: <><path d="M12 3 2 20h20z" /><path d="M12 9.5v4.5M12 17v.2" /></>,
  victim_face: <><circle cx="8.5" cy="12" r="4" /><path d="M15.5 8.5c1.4 1.3 1.4 5.7 0 7M18.5 6c2.8 2.6 2.8 9.4 0 12" /></>,
  phone_aed: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  torso_hands: <><path d="M12 3v9M8 8l4 4 4-4" /><path d="M4 16h16M7 20h10" /></>,
  child_torso: <><circle cx="12" cy="6" r="2.5" /><path d="M12 9v6M8 11.5h8M9.5 21l2.5-6 2.5 6" /></>,
  airway: <path d="M3 9c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 15c2-2 4 2 6 0s4 2 6 0 4 2 6 0" />,
  aed_pads: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /><path d="M12.6 8 10.4 12h3.2l-1.8 4" /></>,
  handover: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4h-4" /></>,
  choking_person: <><circle cx="12" cy="5.5" r="3" /><path d="M12 8.5V21M7.5 14l4.5-3 4.5 3" /></>,
  back_blows: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0v6.5a8 8 0 0 1-8 8h-.5a6 6 0 0 1-5-2.7l-2-3.1a1.5 1.5 0 0 1 2.5-1.7L8 15" />,
  abdo_thrusts: <><path d="M12 21V9M7 13l5-5 5 5" /><path d="M5 3h14" /></>,
  side_position: <><circle cx="5" cy="12.5" r="2" /><path d="M8 13.5h7l3-3M10 13.5l2 4h5M3 20.5h18" /></>,
};

export function Pictogram({ kind, size }: { kind?: string; size?: number }) {
  return <Svg size={size}>{PICTOGRAMS[kind ?? 'scene'] ?? PICTOGRAMS.scene}</Svg>;
}

/** One emblem per scene: where it happens, never what to do. */
const EMBLEMS: Record<string, ReactNode> = {
  adult_cardiac_arrest: <><path d="M4 9h12v4.5a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 13.5z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5" /></>,
  child_cardiac_arrest: <><path d="M3 18c2 0 2-1.5 4.5-1.5S10 18 12 18s2.5-1.5 4.5-1.5S19 18 21 18M3 22c2 0 2-1.5 4.5-1.5S10 22 12 22s2.5-1.5 4.5-1.5S19 22 21 22" /><path d="M9 14V4M15 14V4M9 7.5h6M9 11h6" /></>,
  choking_adult: <><path d="M7 3v18M5 3v5a2 2 0 0 0 4 0V3" /><path d="M17 21V3c-2.2 1.2-3.5 4-3.5 7.5H17" /></>,
  recovery_position: <><rect x="6.5" y="3" width="11" height="7.5" rx="1.5" /><path d="M12 10.5V21M8.5 21h7M9.5 6.75h5" /></>,
};

export function Emblem({ id, size }: { id?: string; size?: number }) {
  return <Svg size={size}>{EMBLEMS[id ?? ''] ?? <path d="M12 4v16M4 12h16" />}</Svg>;
}

export const PhoneIcon = ({ size = 18 }: { size?: number }) => <Svg size={size}>{PICTOGRAMS.phone_aed}</Svg>;
export const ArrowIcon = ({ size = 18 }: { size?: number }) => <Svg size={size}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const LockIcon = ({ size = 14 }: { size?: number }) => <Svg size={size}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const CheckIcon = ({ size = 14 }: { size?: number }) => <Svg size={size}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const EyeIcon = ({ size = 14 }: { size?: number }) => <Svg size={size}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>;
