import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    { row: ['wunsch_anreise', 'wunsch_abreise'] },
    'anzahl_personen',
    { row: ['vorname', 'nachname'] },
    'email',
    'telefon',
    'anmerkungen',
    'datenschutz',
  ],
  defaults: {
    'wunsch_anreise': { kind: 'today' },
    'wunsch_abreise': { kind: 'todayOffset', days: 3 },
    'anzahl_personen': { kind: 'literal', value: 1 },
  },
  computed: {
    '_buchungsanfrage_dauer_nächte': { kind: 'dateDiff', from: 'wunsch_anreise', to: 'wunsch_abreise', unit: 'days' },
  },
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
