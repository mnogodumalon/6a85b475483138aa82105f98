import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    { row: ['anreisedatum', 'abreisedatum'] },
    'status',
    'interne_notiz',
  ],
  defaults: {
    'anreisedatum': { kind: 'today' },
    'abreisedatum': { kind: 'todayOffset', days: 3 },
    'status': { kind: 'lookup', key: 'belegt', label: 'Belegt' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
