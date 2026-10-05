/**
 * Anfrage annehmen — 3-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage auswählen → 2) Zeitraum und Mindestaufenthalt prüfen → 3) Prüfen & als belegt eintragen.
 * Reads: buchungsanfrage (über die Tür des Flow-Hooks), belegungskalender (Belegung). Writes: belegungskalender (status = belegt, über den Hook).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker, Field, StepNav, SummaryStep, SuccessStep.
 */
import { useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Field } from '@/components/blocks/Field';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useOccupancy, matchesSearch, fieldText, fieldNumber, fieldDate,
  type JourneyRecord,
} from '@/lib/journey';
import { useAnfrageAnnehmenFlow } from '@/lib/journey/flows/AnfrageAnnehmen';
import { tx } from '@/i18n';

const MIN_NIGHTS = 3;
const SEARCH_FIELDS = ['vorname', 'nachname', 'email'];

function shortDate(iso: string | null | undefined): string {
  return iso ? format(parseISO(iso), 'dd.MM.yyyy') : '—';
}

function nightsBetween(from: unknown, to: unknown): number | null {
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) return null;
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export default function AnfrageAnnehmenPage() {
  const [step, setStep] = useState(1);
  const [anfragen, setAnfragen] = useState<JourneyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [anfrageId, setAnfrageId] = useState<string | null>(null);

  const flow = useAnfrageAnnehmenFlow({ steps: { anreisedatum: 2, abreisedatum: 2 } });
  const f = flow.forms.belegungskalender;
  const belegung = useOccupancy(flow.port, 'belegungskalender');

  useEffect(() => {
    let alive = true;
    flow.port
      .list('buchungsanfrage', { limit: 200 })
      .then(rows => { if (alive) { setAnfragen(rows); setLoading(false); } })
      .catch(e => { if (alive) { setLoadError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toItem = (r: JourneyRecord) => {
    const personen = fieldNumber(r, 'anzahl_personen');
    return {
      id: r.id,
      title: `${fieldText(r, 'vorname')} ${fieldText(r, 'nachname')}`.trim(),
      subtitle: [
        `${shortDate(fieldDate(r, 'wunsch_anreise'))} – ${shortDate(fieldDate(r, 'wunsch_abreise'))}`,
        personen != null ? tx`${personen} Personen` : '',
        fieldText(r, 'email'),
      ].filter(Boolean).join(' · '),
    };
  };
  const items = useMemo(() => anfragen.map(toItem), [anfragen]); // eslint-disable-line react-hooks/exhaustive-deps

  const anfrage = anfrageId ? anfragen.find(r => r.id === anfrageId) ?? null : null;
  const anfrageName = anfrage ? `${fieldText(anfrage, 'vorname')} ${fieldText(anfrage, 'nachname')}`.trim() : '';

  const von = f.get('anreisedatum');
  const bis = f.get('abreisedatum');
  const nights = nightsBetween(von, bis);
  const tooShort = nights != null && nights < MIN_NIGHTS;
  const taken = nights != null && nights > 0 && !belegung.isFree(von as string, bis as string);

  const problem = (): string | null => {
    if (nights == null) return null;
    if (nights < MIN_NIGHTS) return tx('Der Mindestaufenthalt beträgt drei Nächte.');
    if (taken) return tx('Der Zeitraum ist bereits belegt.');
    return null;
  };

  const pickAnfrage = (id: string) => {
    const r = anfragen.find(a => a.id === id);
    if (!r) return;
    setAnfrageId(id);
    f.set('anreisedatum', fieldDate(r, 'wunsch_anreise') ?? '');
    f.set('abreisedatum', fieldDate(r, 'wunsch_abreise') ?? '');
  };

  const restart = () => { flow.reset(); setAnfrageId(null); setStep(1); };

  const requestFacts = anfrage ? (
    <div className="rounded-xl border bg-secondary/40 p-3 text-sm space-y-1 overflow-hidden">
      <div className="font-medium truncate">{anfrageName}</div>
      <div className="text-muted-foreground">
        {tx`Wunsch: ${shortDate(fieldDate(anfrage, 'wunsch_anreise'))} – ${shortDate(fieldDate(anfrage, 'wunsch_abreise'))}`}
        {' · '}
        {tx`${fieldNumber(anfrage, 'anzahl_personen') ?? '?'} Personen`}
      </div>
      {fieldText(anfrage, 'anmerkungen') && (
        <div className="text-muted-foreground line-clamp-3">{fieldText(anfrage, 'anmerkungen')}</div>
      )}
    </div>
  ) : null;

  return (
    <IntentWizardShell
      title={tx('Anfrage annehmen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Eine Buchungsanfrage annehmen und den Zeitraum als belegt eintragen.'),
        needs: [tx('Eine offene Buchungsanfrage')],
      }}
    >
      <WizardStep label={tx('Anfrage')} description={tx('Welche Buchungsanfrage möchtest du annehmen?')}>
        <EntitySelectStep
          items={items}
          loading={loading}
          error={loadError}
          totalCount={anfragen.length}
          selectedId={anfrageId}
          onSelect={pickAnfrage}
          create={false}
          searchPlaceholder={tx('Vorname, Nachname oder E-Mail …')}
          emptyText={tx('Es liegen keine Buchungsanfragen vor.')}
          onSearch={async query => anfragen
            .filter(r => matchesSearch(r.fields, query, SEARCH_FIELDS))
            .map(toItem)}
        />
      </WizardStep>

      <WizardStep label={tx('Zeitraum')} description={tx('Prüfe den Wunschzeitraum — belegte Nächte sind ausgegraut, mindestens drei Nächte.')}>
        {!anfrage ? (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        ) : (
          <div className="space-y-4">
            {requestFacts}
            <Field form={f} name="anreisedatum" label={tx('Zeitraum')}>
              <AvailabilityRangePicker
                {...f.range('anreisedatum', 'abreisedatum', { blocked: belegung.blocked, minNights: MIN_NIGHTS })}
              />
            </Field>
            {(tooShort || taken) && (
              <p className="text-sm text-destructive" role="alert">{problem()}</p>
            )}
            <StepNav
              onBack={() => setStep(1)}
              onNext={() => {
                if (!f.validate(['anreisedatum', 'abreisedatum'])) return false;
                return problem() ?? true;
              }}
              nextStepLabel={tx('Prüfen')}
            />
          </div>
        )}
      </WizardStep>

      <WizardStep label={tx('Eintragen')} description={tx('Alles richtig? Dann wird der Zeitraum als belegt eingetragen.')}>
        {!flow.submit.done && (problem() || !anfrage ? (
          <StepNav onBack={() => setStep(2)} nextDisabled>
            {problem() ?? tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        ) : (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            items={[{ key: 'anfrage', label: tx('Anfrage von'), value: anfrageName }]}
            whatHappensNext={tx('Der Zeitraum steht danach im Belegungskalender als belegt.')}
          />
        ))}
      </WizardStep>

      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          next={[
            { label: tx('Weitere Anfrage annehmen'), onClick: restart },
            { label: tx('Belegungszeitraum eintragen'), href: '#/intents/belegung-eintragen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Der Zeitraum ist jetzt im Belegungskalender als belegt eingetragen.')}
        />
      )}
    </IntentWizardShell>
  );
}
