import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    { row: ['vorname', 'nachname'], cols: '1fr 1fr' },
    'email',
    'telefon',
    { row: ['wunsch_anreise', 'wunsch_abreise'], cols: '1fr 1fr' },
    'anzahl_personen',
    'anmerkungen',
    'datenschutz',
  ],
  defaults: {
    'wunsch_anreise': { kind: 'today' },
    'wunsch_abreise': { kind: 'todayOffset', days: 3 },
    'anzahl_personen': { kind: 'literal', value: 1 },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
