import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig, prepareChallenge,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import { useStepForm, useJourneySubmit, useOccupancy } from '@/lib/journey';
import { IntentWizardShell, type WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Bound } from '@/components/blocks/Bound';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { tx } from '@/i18n';

const SLUG = 'belegung-und-anfrage';
const MIN_NIGHTS = 3;

function Wizard({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [step, setStep] = useState(1);
  const port = useMemo(() => createPublicPort(cfg, page), [cfg, page]);
  const occupancy = useOccupancy(port, 'belegungskalender');

  const anfrage = useStepForm('buchungsanfrage', {
    fields: [
      'wunsch_anreise', 'wunsch_abreise', 'anzahl_personen',
      'vorname', 'nachname', 'email', 'telefon', 'anmerkungen', 'datenschutz',
    ],
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
    {
      label: tx('Zeitraum'),
      description: tx('Wähle Anreise und Abreise. Belegte Nächte sind durchgestrichen und nicht wählbar.'),
    },
    { label: tx('Kontakt') },
    { label: tx('Prüfen') },
  ];

  return (
    <IntentWizardShell
      steps={steps}
      currentStep={step}
      onStepChange={setStep}
      back={false}
      forms={[anfrage]}
      draftKey={SLUG}
    >
      {step === 1 && (
        <div className="space-y-5" onFocus={() => prepareChallenge(cfg, page, 'POST', `/apps/${page.endpoints?.find(e => e.op === 'create')?.app_id ?? ''}/records`)}>
          <p className="text-sm text-muted-foreground">
            {tx('Der Mindestaufenthalt beträgt drei Nächte.')}
          </p>
          {occupancy.error && (
            <p className="text-sm text-destructive">{tx('Die Belegung konnte nicht geladen werden.')}</p>
          )}
          <AvailabilityRangePicker
            {...anfrage.range('wunsch_anreise', 'wunsch_abreise', { blocked: occupancy.blocked, minNights: MIN_NIGHTS })}
          />
          <Bound form={anfrage} name="anzahl_personen" />
          <StepNav
            hideBack
            onNext={() => anfrage.validate(['wunsch_anreise', 'wunsch_abreise', 'anzahl_personen'])}
            nextStepLabel={tx('Kontakt')}
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
            onNext={() => anfrage.validate(['vorname', 'nachname', 'email', 'datenschutz'])}
            nextStepLabel={tx('Prüfen')}
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
          whatHappensNext={tx('Wir melden uns bald bei dir.')}
        />
      )}
    </IntentWizardShell>
  );
}

export default function BelegungUndAnfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  return (
    <PublicShell title={page.title} description={tx('Prüfe die Belegung und stelle eine Anfrage für deinen Wunschtermin. Mindestaufenthalt: drei Nächte.')}>
      <Wizard cfg={cfg} page={page} />
    </PublicShell>
  );
}
