import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    { row: ['anreisedatum', 'abreisedatum'], cols: '1fr 1fr' },
    'status',
    'interne_notiz',
  ],
  defaults: {
    'anreisedatum': { kind: 'today' },
    'abreisedatum': { kind: 'todayOffset', days: 3 },
    'status': { kind: 'lookup', key: 'belegt', label: 'Belegt' },
  },
  computed: {
    '_belegungskalender_dauer_nächte': { kind: 'dateDiff', from: 'anreisedatum', to: 'abreisedatum', unit: 'days' },
  },
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
