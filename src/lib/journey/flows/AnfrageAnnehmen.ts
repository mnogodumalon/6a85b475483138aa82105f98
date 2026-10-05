/**
 * useAnfrageAnnehmenFlow — the plumbing of the flow « Anfrage annehmen und Zeitraum belegen », generated from the plan.
 *
 * Writes `belegungskalender`: asks `anreisedatum`, `abreisedatum`; sets `status` itself.
 * The hook OWNS: the form(s) with exactly these fields and the plan's required
 * ingredients, one record search per picked field (columns and filter from
 * the plan), and the submit plan with its fixed and derived values. A page
 * that only calls `flow.submit.run()` cannot write a field the plan does not
 * know — there is no way to spell it.
 *
 * YOU decide what a person notices, through the options:
 *   steps     which wizard step asks which field (default: one step per pick,
 *             then one for the typed fields, then "Prüfen" = step 2)
 *   items     how a search hit is displayed per pick (title, subtitle, status …)
 *   initial   prefills for typed fields
 *   messages  the sentence for an empty required field, per field
 *
 *   const flow = useAnfrageAnnehmenFlow({
 *     steps: { anreisedatum: 1, abreisedatum: 1 },
 *   });
 *   <IntentWizardShell forms={flow.forms} draftKey={flow.draftKey} …>
 *     <Bound form={flow.forms.belegungskalender} name="anreisedatum" />
 *     <Bound form={flow.forms.belegungskalender} name="abreisedatum" />
 *     <StepNav onNext={() => flow.validateStep(n)} />
 *     {!flow.submit.done && <SummaryStep forms={flow.formList} submit={flow.submit} />}
 *     {flow.submit.result && <SuccessStep result={flow.submit.result} forms={flow.formList} submit={flow.submit} />}
 *   </IntentWizardShell>
 */
import {
  useStepForm, useJourneySubmit, useRecordSearch,
  fieldText, fieldLookup, fieldLookups, fieldNumber, fieldDate, fieldRef,
  todayIso, nowIso, isEmptyValue, policyFixedValue, withPickPolicy, usePolicyVersion,
  type StepForm, type JourneyRecord, type RefContext, type SelectItemLike, type FormValues, type PlanStep, type SummaryItem,} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { labelOf, optionsOf, type EntityKey } from '@/lib/journey/rules';
export type AnfrageAnnehmenFieldKey = 'abreisedatum' | 'anreisedatum';

export interface AnfrageAnnehmenForms {
  belegungskalender: StepForm<'belegungskalender'>;
}

// Alias so the option generics stay readable.
type Key = AnfrageAnnehmenFieldKey;

export interface AnfrageAnnehmenFlowOptions {
  /** field → wizard step that asks it; drives „Ändern“ links and answer chips. */
  steps?: Partial<Record<Key, number>>;
  initial?: Partial<Record<Key, unknown>>;
  messages?: Partial<Record<Key, string>>;
}

const DEFAULT_STEPS: Record<string, number> = {"abreisedatum": 1, "anreisedatum": 1};
export const ANFRAGEANNEHMEN_REVIEW_STEP = 2;

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns T, not Partial<T>: a Record's index signature is already "maybe
// absent", and Partial<Record<string, string>> does not assign to the
// Record<string, string> useStepForm wants (tsc, live 23.09.2026 — eight
// errors, one per hook, caught only in the sandbox build).
function only<T extends Record<string, unknown>>(obj: T | undefined, keys: string[]): T | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out as T;
}

function hasValues(form: StepForm): boolean {
  return form.keys.some(k => !isEmptyValue(form.values[k]));
}

export function useAnfrageAnnehmenFlow(options: AnfrageAnnehmenFlowOptions = {}) {
  const steps = { ...DEFAULT_STEPS, ...(options.steps ?? {}) } as Record<string, number>;
  const belegungskalender = useStepForm('belegungskalender', {
    fields: ["anreisedatum", "abreisedatum"],
    steps: only(steps, ["anreisedatum", "abreisedatum"]) as Record<string, number>,
    initial: only(options.initial as FormValues | undefined, ["anreisedatum", "abreisedatum"]),
    messages: only(options.messages as Record<string, string> | undefined, ["anreisedatum", "abreisedatum"]),
  });
  const forms: AnfrageAnnehmenForms = { belegungskalender };
  const formList: StepForm[] = [belegungskalender];

  // The owner's rules after the build (intent-policies.json): a fixed value
  // for a field this flow sets itself, a narrower or wider pick — read at
  // render time, so a change works on the running application.
  usePolicyVersion();
  const searches = {
  };
  // Whether a pick offers „Neu anlegen“ is the plan's call: off for the record
  // this flow changes, for multi picks, for a catalogue entity and for an
  // entity with its own flow. The page spreads `.select` and writes no `create=`.
  // a fixed value the flow sets itself, as a review row with the link that changes it
  const setting = (entity: EntityKey, field: string, value: unknown): SummaryItem => ({
    key: `setting:${entity}.${field}`, label: labelOf(entity, field),
    value: optionsOf(entity, field).find(o => o.key === String(value))?.label ?? String(value ?? ''),
    href: `#/verwaltung/anwendung?line=intent:anfrage-annehmen:write:${entity}.${field}`,
  });
  const picks = {
  };

  const plan: PlanStep[] = [
    {
      key: 'belegungskalender', entity: 'belegungskalender', form: belegungskalender, primary: true,
      values: (): FormValues => ({
        status: policyFixedValue('belegungskalender', 'status') ?? "belegt",
      }),

      // the review shows what this step sets itself — changeable on „Deine Anwendung“, not here
      settings: () => [setting('belegungskalender', 'status', policyFixedValue('belegungskalender', 'status') ?? "belegt")],
    },
  ];

  const submit = useJourneySubmit(servicePort, plan, { draftKey: 'anfrage-annehmen' });

  /** Props for a single-record pick step: {...flow.picks.x.select} {...flow.pick('x')} */
  const pick = (field: AnfrageAnnehmenFieldKey) => {
    const owner = formList.find(f => f.keys.includes(field)) ?? formList[0];
    const search = (picks as Record<string, { labelOf(id: string): string | undefined }>)[field];
    return {
      selectedId: (typeof owner.get(field) === 'string' ? (owner.get(field) as string) : null) || null,
      // `field as never` collapsed the conditional SetArgs<E, never> to never and
      // no argument was assignable any more (tsc, live 23.09.2026); widen `set`
      // itself instead — the label stays a required third argument.
      onSelect: (id: string) => (owner.set as (k: string, v: unknown, l?: string) => void)(field, id, search?.labelOf(id)),
    };
  };
  /** Props for a multi-record pick step: {...flow.picks.x.select} {...flow.pickMany('x')} */
  const pickMany = (field: AnfrageAnnehmenFieldKey) => {
    const owner = formList.find(f => f.keys.includes(field)) ?? formList[0];
    const search = (picks as Record<string, { labelOf(id: string): string | undefined }>)[field];
    return owner.records(field, id => search?.labelOf(id));
  };
  /** Validate every field the wizard asks in step `n` — for StepNav.onNext. */
  const validateStep = (n: number): boolean =>
    formList.every(f => f.validate(f.keys.filter(k => steps[k] === n)));
  const reset = () => { submit.reset(); formList.forEach(f => f.reset()); };

  return {
    slug: 'anfrage-annehmen' as const,
    draftKey: 'anfrage-annehmen' as const,
    entity: 'belegungskalender' as const,
    form: belegungskalender,
    forms, formList, picks, submit, steps,    reviewStep: ANFRAGEANNEHMEN_REVIEW_STEP,
    pick, pickMany, validateStep, reset,
    // the door the hook reads through — for what it does not own: availability
    // (useOccupancy(flow.port, …)), a count (useRecordCount(flow.port, …)). A page
    // importing servicePort next to the hook fails gate 3 (fewo 05.10.2026: the
    // gate taught useOccupancy(servicePort, …) and forbade servicePort at once)
    port: servicePort,
  };
}

export type AnfrageAnnehmenFlow = ReturnType<typeof useAnfrageAnnehmenFlow>;
