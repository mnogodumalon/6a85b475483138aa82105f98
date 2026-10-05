import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  prepareChallenge,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { useStepForm, useJourneySubmit, useOccupancy } from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Bound } from '@/components/blocks/Bound';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { tx } from '@/i18n';

const SLUG = 'ferienwohnung-anfrage';
const MIN_NIGHTS = 3;

function Anfrage({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [step, setStep] = useState(1);
  const port = useMemo(() => createPublicPort(cfg, page), [cfg, page]);
  const occupancy = useOccupancy(port, 'belegungskalender');

  const f = useStepForm('buchungsanfrage', {
    fields: [
      'wunsch_anreise', 'wunsch_abreise', 'anzahl_personen', 'vorname',
      'nachname', 'email', 'telefon', 'anmerkungen', 'datenschutz',
    ],
    steps: {
      wunsch_anreise: 1, wunsch_abreise: 1, anzahl_personen: 1,
      vorname: 2, nachname: 2, email: 2, telefon: 2, anmerkungen: 2, datenschutz: 2,
    },
    autoComplete: true,
  });

  const submit = useJourneySubmit(
    port,
    [{ key: 'anfrage', entity: 'buchungsanfrage', form: f, primary: true }],
    { draftKey: SLUG },
  );

  const steps = [
    { label: tx('Zeitraum') },
    { label: tx('Deine Daten') },
    { label: tx('Prüfen') },
  ];

  return (
    <IntentWizardShell
      steps={steps}
      currentStep={step}
      onStepChange={setStep}
      back={false}
      forms={[f]}
      draftKey={SLUG}
    >
      {step === 1 && (
        <div className="space-y-5">
          {occupancy.error && (
            <p className="text-sm text-destructive">
              {tx('Die Belegung konnte nicht geladen werden.')}
            </p>
          )}
          <AvailabilityRangePicker
            {...f.range('wunsch_anreise', 'wunsch_abreise', {
              blocked: occupancy.blocked,
              minNights: MIN_NIGHTS,
            })}
            texts={{ minHint: tx('Mindestaufenthalt: 3 Nächte') }}
          />
          <Bound form={f} name="anzahl_personen" />
          <StepNav
            hideBack
            onNext={() => f.validate(['wunsch_anreise', 'wunsch_abreise', 'anzahl_personen'])}
            nextStepLabel={tx('Deine Daten')}
          />
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <Bound form={f} name="vorname" />
          <Bound form={f} name="nachname" />
          <Bound form={f} name="email" />
          <Bound form={f} name="telefon" />
          <Bound form={f} name="anmerkungen" />
          <Bound form={f} name="datenschutz" />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => f.validate(['vorname', 'nachname', 'email', 'telefon', 'anmerkungen', 'datenschutz'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      )}
      {step === 3 && !submit.done && (
        <SummaryStep
          forms={[f]}
          submit={submit}
          whatHappensNext={tx('Wir prüfen deine Anfrage und melden uns per E-Mail bei dir.')}
        />
      )}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          submit={submit}
          whatHappensNext={tx('Wir melden uns bei dir, sobald wir deine Anfrage geprüft haben.')}
        />
      )}
    </IntentWizardShell>
  );
}

export default function FerienwohnungAnfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (cfg && page) {
      const ep = page.endpoints?.find(e => e.op === 'create');
      if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
    }
  }, [cfg, page]);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }

  return (
    <PublicShell title={page.title} description={page.description}>
      <Anfrage cfg={cfg} page={page} />
    </PublicShell>
  );
}
