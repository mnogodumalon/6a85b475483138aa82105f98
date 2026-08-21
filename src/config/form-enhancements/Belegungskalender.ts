import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'anreisedatum',
    'abreisedatum',
    'status',
    'interne_notiz',
  ],
  defaults: {
    'anreisedatum': { kind: 'today' },
    'abreisedatum': { kind: 'todayOffset', days: 3 },
    'status': { kind: 'lookup', key: 'belegt', label: 'Belegt' },
  },
  computed: {
    '_belegungskalender_dauer_tage': { kind: 'dateDiff', from: 'anreisedatum', to: 'abreisedatum', unit: 'days' },
  },
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
