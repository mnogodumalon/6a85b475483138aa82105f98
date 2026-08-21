import { lookupLabel } from '@/i18n';

// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Belegungskalender {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    anreisedatum?: string; // Format: YYYY-MM-DD oder ISO String
    abreisedatum?: string; // Format: YYYY-MM-DD oder ISO String
    status?: LookupValue;
    interne_notiz?: string;
  };
}

export interface Buchungsanfrage {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    wunsch_anreise?: string; // Format: YYYY-MM-DD oder ISO String
    wunsch_abreise?: string; // Format: YYYY-MM-DD oder ISO String
    anzahl_personen?: number;
    vorname?: string;
    nachname?: string;
    email?: string;
    telefon?: string;
    anmerkungen?: string;
    datenschutz?: boolean;
  };
}

export const APP_IDS = {
  BELEGUNGSKALENDER: '6a85b464cf970b4e2cd1e3c0',
  BUCHUNGSANFRAGE: '6a85b4674cf61b7886bcb8da',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'belegungskalender': {
    status: [{ key: "belegt", get label() { return lookupLabel('belegungskalender', 'status', "belegt") ?? "Belegt"; } }, { key: "frei", get label() { return lookupLabel('belegungskalender', 'status', "frei") ?? "Frei"; } }],
  },
};

// Optimistic LookupValue writes: never re-type a label — resolve the schema
// option instead (its label is a locale-aware getter; falls back to the key).
// WRONG: status: { key: 'offen', label: 'Offen' }   (frozen in one language)
// RIGHT: status: lookupOption('<appKey>', 'status', 'offen')
export function lookupOption(app: string, field: string, key: string): LookupValue {
  return LOOKUP_OPTIONS[app]?.[field]?.find(o => o.key === key) ?? { key, label: key };
}

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'belegungskalender': {
    'anreisedatum': 'date/date',
    'abreisedatum': 'date/date',
    'status': 'lookup/radio',
    'interne_notiz': 'string/textarea',
  },
  'buchungsanfrage': {
    'wunsch_anreise': 'date/date',
    'wunsch_abreise': 'date/date',
    'anzahl_personen': 'number',
    'vorname': 'string/text',
    'nachname': 'string/text',
    'email': 'string/email',
    'telefon': 'string/tel',
    'anmerkungen': 'string/textarea',
    'datenschutz': 'bool',
  },
};

export const HUB_TOPOLOGY: Record<string, { field: string; entity: string }[]> = {
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateBelegungskalender = StripLookup<Belegungskalender['fields']>;
export type CreateBuchungsanfrage = StripLookup<Buchungsanfrage['fields']>;