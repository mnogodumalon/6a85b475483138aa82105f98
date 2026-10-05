/**
 * Required-field messages — WRITTEN BY THE BUILD AGENT, never by a heuristic.
 *
 * The layer knows two things about an empty required field: that it is
 * required and what its label is. Out of that it can only say „„Anreise" ist
 * ein Pflichtfeld". What the person should do instead („Bitte einen Gast
 * auswählen.") is meaning, and meaning is the agent's: the Phase-2 orchestrator
 * writes one short instruction per required field — what is needed, not why — to
 * `.intents-staging/messages.json`, the integration step validates it against
 * the app metadata and renders it into the block below. Scaffold updates keep
 * the block. Do not edit outside the markers.
 *
 * Every door reads this and nothing else: `useStepForm` (flows and public
 * pages), the generated {Entity}Dialog and the public form's server-error line.
 * A field without a sentence falls back to the label sentence — never to a
 * bare „Dieses Feld ist erforderlich".
 *
 * Required fields per entity (from the base view):
 *   - belegungskalender: anreisedatum (Anreisedatum), abreisedatum (Abreisedatum), status (Status)
 *   - buchungsanfrage: wunsch_anreise (Gewünschtes Anreisedatum), wunsch_abreise (Gewünschtes Abreisedatum), anzahl_personen (Anzahl der Personen), vorname (Vorname), nachname (Nachname), email (E-Mail-Adresse), datenschutz (Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.)
 */
import { t, tx } from '@/i18n';
import { labelOf, type EntityKey } from './rules';

/** The writable fields of each entity — the keys a message may address (generated). */
export interface MessageFields {
  "belegungskalender": "anreisedatum" | "abreisedatum" | "status" | "interne_notiz";
  "buchungsanfrage": "wunsch_anreise" | "wunsch_abreise" | "anzahl_personen" | "vorname" | "nachname" | "email" | "telefon" | "anmerkungen" | "datenschutz";
}
export type MessageFieldKey<E extends EntityKey> = E extends keyof MessageFields ? MessageFields[E] : never;

export const REQUIRED_MESSAGES: { [E in EntityKey]?: Partial<Record<MessageFieldKey<E>, string>> } = {
  // <custom:messages>
  belegungskalender: { anreisedatum: "Bitte das Anreisedatum wählen.", abreisedatum: "Bitte das Abreisedatum wählen.", status: "Bitte belegt oder frei auswählen." },
  buchungsanfrage: { wunsch_anreise: "Bitte das Anreisedatum wählen.", wunsch_abreise: "Bitte das Abreisedatum wählen.", anzahl_personen: "Bitte die Anzahl der Personen eingeben.", vorname: "Bitte den Vornamen eingeben.", nachname: "Bitte den Nachnamen eingeben.", email: "Bitte die E-Mail-Adresse eingeben.", datenschutz: "Bitte den Datenschutzhinweisen zustimmen." },
  // </custom:messages>
};

/** The sentence shown when `key` of `entity` is required and empty — the
 *  agent's own text (translated at runtime like every page string), else the
 *  label sentence. Call it while rendering, not at module scope. */
export function requiredMessage(entity: EntityKey, key: string): string {
  const own = (REQUIRED_MESSAGES as Record<string, Record<string, string | undefined> | undefined>)[entity]?.[key];
  if (own && own.trim()) return tx(own);
  return t('v_required', { label: labelOf(entity, key) });
}

/** True when the agent wrote a sentence for the field. */
export function hasOwnMessage(entity: EntityKey, key: string): boolean {
  const own = (REQUIRED_MESSAGES as Record<string, Record<string, string | undefined> | undefined>)[entity]?.[key];
  return Boolean(own && own.trim());
}
