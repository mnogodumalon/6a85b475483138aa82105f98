/**
 * Belegungszeitraum eintragen — 4-Schritt-Wizard.
 * Steps: 1) Zeitraum wählen (belegte Tage gesperrt) → 2) Status festlegen → 3) Interne Notiz → 4) Prüfen & speichern.
 * Reads: belegungskalender (bestehende Zeiträume über useOccupancy). Writes: belegungskalender (via useBelegungEintragenFlow).
 * Composes: IntentWizardShell, AvailabilityRangePicker, Field, Bound, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useOccupancy } from '@/lib/journey';
import { useBelegungEintragenFlow } from '@/lib/journey/flows/BelegungEintragen';
import { tx } from '@/i18n';

export default function BelegungEintragenPage() {
  const [step, setStep] = useState(1);
  const flow = useBelegungEintragenFlow({
    steps: { anreisedatum: 1, abreisedatum: 1, status: 2, interne_notiz: 3 },
  });
  const f = flow.forms.belegungskalender;
  const belegung = useOccupancy(flow.port, 'belegungskalender');

  return (
    <IntentWizardShell
      title={tx('Belegungszeitraum eintragen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Trage einen belegten oder freien Zeitraum in den Belegungskalender ein.'),
        needs: [tx('Anreise- und Abreisedatum'), tx('Status des Zeitraums')],
      }}
    >
      <WizardStep label={tx('Zeitraum')} description={tx('Anreise und Abreise wählen — bereits belegte Tage sind ausgegraut.')}>
        <div className="space-y-4">
          <AvailabilityRangePicker {...f.range('anreisedatum', 'abreisedatum', { blocked: belegung.blocked })} />
          <StepNav hideBack onNext={() => f.validate(['anreisedatum', 'abreisedatum'])} nextStepLabel={tx('Status')} />
        </div>
      </WizardStep>
      <WizardStep label={tx('Status')} description={tx('Ist der Zeitraum belegt oder frei?')} needs={['anreisedatum', 'abreisedatum']}>
        <div className="space-y-4">
          <Bound form={f} name="status" />
          <StepNav onBack={() => setStep(1)} onNext={() => f.validate(['status'])} nextStepLabel={tx('Notiz')} />
        </div>
      </WizardStep>
      <WizardStep label={tx('Notiz')} description={tx('Optional: eine interne Notiz für dich ergänzen.')}>
        <div className="space-y-4">
          <Bound form={f} name="interne_notiz" rows={4} />
          <StepNav onBack={() => setStep(2)} onNext={() => f.validate(['interne_notiz'])} nextStepLabel={tx('Prüfen')} />
        </div>
      </WizardStep>
      <WizardStep label={tx('Prüfen')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            whatHappensNext={tx('Der Zeitraum erscheint sofort im Belegungskalender.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          restartLabel={tx('Weiteren Zeitraum eintragen')}
          next={[
            { label: tx('Anfrage annehmen'), href: '#/intents/anfrage-annehmen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
