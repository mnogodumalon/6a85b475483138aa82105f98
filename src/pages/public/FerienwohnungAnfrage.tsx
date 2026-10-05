import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig, listPublicRecords, prepareChallenge, PageUnavailableError,
  type PublicPagesConfig, type PublicPageConfig, type PublicRecordResult,
} from '@/lib/publicClient';
import { useStepForm, useJourneySubmit, occupancyFor, fieldDate, type JourneyRecord } from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import { IntentWizardShell, type WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Bound } from '@/components/blocks/Bound';
import { tx } from '@/i18n';

const SLUG = 'ferienwohnung-anfrage';
const MIN_NIGHTS = 3;

const FIELDS = [
  'wunsch_anreise', 'wunsch_abreise', 'anzahl_personen', 'vorname', 'nachname',
  'email', 'telefon', 'anmerkungen', 'datenschutz',
];

export default function FerienwohnungAnfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setLoading(false);
      })
      .catch(e => {
        if (e instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  if (loading || unavailable || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  return <Inner cfg={cfg} page={page} />;
}

function Inner({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [step, setStep] = useState(1);
  const [records, setRecords] = useState<JourneyRecord[]>([]);
  const [loadError, setLoadError] = useState(false);

  const port = useMemo(() => createPublicPort(cfg, page), [cfg, page]);
  const calendarAppId = page.endpoints?.find(e => e.op === 'list')?.app_id;

  useEffect(() => {
    if (!calendarAppId) return;
    listPublicRecords(cfg, page, { appId: calendarAppId, limit: 500 })
      .then((res: Record<string, PublicRecordResult>) => {
        setRecords(Object.values(res).map(r => ({
          id: r.id,
          fields: r.fields as Record<string, unknown>,
          createdAt: r.created_at ?? null,
        })));
      })
      .catch(() => setLoadError(true));
  }, [cfg, page, calendarAppId]);

  const blocked = useMemo(() => occupancyFor('belegungskalender', records), [records]);
  // keep only well-formed ranges
  const safeBlocked = useMemo(
    () => blocked.filter(b => !!b.start && !!fieldDate({ id: '', fields: { d: b.start }, createdAt: null }, 'd')),
    [blocked],
  );

  const anfrage = useStepForm('buchungsanfrage', {
    fields: [
      'wunsch_anreise', 'wunsch_abreise', 'anzahl_personen', 'vorname', 'nachname',
      'email', 'telefon', 'anmerkungen', 'datenschutz',
    ],
    required: Object.fromEntries(FIELDS.map(k => [k, ['telefon', 'anmerkungen'].indexOf(k) < 0])),
    steps: {
      wunsch_anreise: 1, wunsch_abreise: 1, anzahl_personen: 1,
      vorname: 2, nachname: 2, email: 2, telefon: 2, anmerkungen: 2, datenschutz: 2,
    },
    autoComplete: true,
  });

  const submit = useJourneySubmit(
    port,
    [{ key: 'anfrage', entity: 'buchungsanfrage', form: anfrage, primary: true }],
    { draftKey: SLUG },
  );

  const steps: WizardStep[] = [
    { label: tx('Zeitraum'), description: tx('Wähle An- und Abreise — belegte Nächte sind nicht wählbar.') },
    { label: tx('Kontakt') },
    { label: tx('Prüfen') },
  ];

  return (
    <PublicShell title={page.title} description={tx('Freie und belegte Zeiträume auf einen Blick — stell direkt deine Anfrage.')} wide>
      <IntentWizardShell
        steps={steps}
        currentStep={step}
        onStepChange={setStep}
        back={false}
        forms={[anfrage]}
        draftKey={SLUG}
      >
        {step === 1 && (
          <div className="space-y-5" onFocus={() => prepareChallenge(cfg, page, 'POST', `/apps/${page.endpoints?.find(e => e.op === 'create')?.app_id}/records`)}>
            {loadError && (
              <p className="text-sm text-destructive">{tx('Der Belegungskalender konnte nicht geladen werden.')}</p>
            )}
            <AvailabilityRangePicker {...anfrage.range('wunsch_anreise', 'wunsch_abreise', { blocked: safeBlocked, minNights: MIN_NIGHTS })} />
            <Bound form={anfrage} name="anzahl_personen" />
            <StepNav
              hideBack
              nextStepLabel={tx('Kontakt')}
              onNext={() => anfrage.validate(['wunsch_anreise', 'wunsch_abreise', 'anzahl_personen'])}
            />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <Bound form={anfrage} name="vorname" />
            <Bound form={anfrage} name="nachname" />
            <Bound form={anfrage} name="email" />
            <Bound form={anfrage} name="telefon" />
            <Bound form={anfrage} name="anmerkungen" />
            <Bound form={anfrage} name="datenschutz" />
            <StepNav
              onBack={() => setStep(1)}
              nextStepLabel={tx('Prüfen')}
              onNext={() => anfrage.validate(['vorname', 'nachname', 'email', 'telefon', 'anmerkungen', 'datenschutz'])}
            />
          </div>
        )}
        {step === 3 && !submit.done && (
          <SummaryStep
            forms={[anfrage]}
            submit={submit}
            whatHappensNext={tx('Wir prüfen deine Anfrage und melden uns per E-Mail bei dir.')}
          />
        )}
        {submit.result && (
          <SuccessStep
            result={submit.result}
            forms={[anfrage]}
            submit={submit}
            whatHappensNext={tx('Wir melden uns so bald wie möglich bei dir.')}
          />
        )}
      </IntentWizardShell>
    </PublicShell>
  );
}
