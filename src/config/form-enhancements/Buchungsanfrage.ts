// Auto-generated. Per-entity form-enhancements config for "Buchungsanfrage".
// Written by the backend form polish (app/services/form_polish.py) from the
// generator's manifest; scripts/parse-formulas.mjs expands the formula strings.
// Schema: see ./types.ts.

import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [{"row": ["vorname", "nachname"]}, "email", "telefon", {"row": ["wunsch_anreise", "wunsch_abreise"]}, "anzahl_personen", "anmerkungen", "datenschutz"],
  defaults: {
    'wunsch_anreise': { kind: 'today' },
    'wunsch_abreise': { kind: 'todayOffset', days: 7 },
    'anzahl_personen': { kind: 'literal', value: 1 },
  },
  computed: {
    '_buchungsanfrage_dauer_tage': { kind: 'dateDiff', from: 'wunsch_anreise', to: 'wunsch_abreise', unit: 'days' },
  },
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
