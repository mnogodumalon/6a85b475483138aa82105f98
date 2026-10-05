// The orchestrator's plan, as far as the running app needs it
// (docs/orchestrator/SPEC.md). Generated — do not edit; regenerated on every
// build and update from the stored plan. Without a plan every map is empty.
//
//   SYSTEM_ASSIGNED entity → fields a tool fills when a record is CREATED — the
//                   value does not exist before; dialogs hide these on create and
//                   the form-polish sets no default on them. A scheduled or
//                   update-triggered tool owns its field but is NOT in here.
//   PLAN_SENTENCES  slug → the plan in the owner's words (flows' field page)
//
// The runtime write guard (FLOW_WRITES/OWNERSHIP, planGuard.ts) left on
// 23.09.2026: a flow page composes against its generated hook, whose submit
// plan IS the Schreibliste — there is no way to spell a write outside it.

export const SYSTEM_ASSIGNED: Record<string, string[]> = {};

export const PLAN_SENTENCES: Record<string, string[]> = {
  "belegung-eintragen": [
    "Legt an: belegungskalender"
  ],
  "anfrage-annehmen": [
    "Legt an: belegungskalender",
    "Automatisch: status (fester Wert „belegt“)"
  ]
};

export const PLAN_SUMMARY = "Eine Anwendung für Ihre Ferienwohnung an der Ostsee: Im Belegungskalender pflegen Sie, welche Zeiträume belegt oder frei sind. Gäste sehen auf einen Blick die Belegung, ohne Daten anderer Gäste, und stellen für freie Termine eine Buchungsanfrage. Der Mindestaufenthalt beträgt drei Nächte.";
