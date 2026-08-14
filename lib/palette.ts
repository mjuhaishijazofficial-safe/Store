export type Palette = 'spice' | 'navy' | 'sabz';

export const PALETTE_COOKIE = 'palette';
// "Teal Ledger" (internal key 'navy') is the default brand per Master
// Handoff Spec §18 — "Saffron Bazaar" (internal key 'spice') and
// "Sada Sabz" ('sabz') stay selectable as opt-in alternates.
export const DEFAULT_PALETTE: Palette = 'navy';
