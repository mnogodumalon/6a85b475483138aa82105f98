/**
 * Belegung eintragen — 3-Schritt-Wizard.
 * Steps: 1) Zeitraum (An-/Abreise, Notiz) → 2) Überschneidung prüfen → 3) Prüfen & speichern.
 * Reads: belegungskalender (Belegung über useOccupancy). Writes: belegungskalender (status fest „belegt").
 * Composes: IntentWizardShell, AvailabilityRangePicker, Bound, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useOccupancy } from '@/lib/journey';
import { useBelegungEintragenFlow } from '@/lib/journey/flows/BelegungEintragen';
import { tx } from '@/i18n';

const showDate = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'dd.MM.yyyy') : '—');

export default function BelegungEintragenPage() {
  const [step, setStep] = useState(1);
  const flow = useBelegungEintragenFlow({
    steps: { anreisedatum: 1, abreisedatum: 1, interne_notiz: 1 },
  });
  const f = flow.forms.belegungskalender;
  const belegung = useOccupancy(flow.port, 'belegungskalender');

  const from = (f.get('anreisedatum') as string | null) || null;
  const to = (f.get('abreisedatum') as string | null) || null;
  const complete = Boolean(from && to);
  const free = complete ? belegung.isFree(from, to) : false;
  const conflicts = complete
    ? belegung.blocked.filter(r => r.start < (to as string) && (!r.end || r.end > (from as string)))
    : [];

  return (
    <IntentWizardShell
      title={tx('Belegung eintragen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{ description: tx('Einen Zeitraum im Belegungskalender als belegt markieren.'), needs: [tx('An- und Abreisedatum')] }}
    >
      <WizardStep label={tx('Zeitraum')} description={tx('An- und Abreise wählen — bereits belegte Nächte sind ausgegraut.')}>
        <div className="space-y-4">
          <AvailabilityRangePicker {...f.range('anreisedatum', 'abreisedatum', { blocked: belegung.blocked })} />
          <Bound form={f} name="interne_notiz" rows={3} hint={tx('Nur für dich sichtbar, z. B. Name des Gasts.')} />
          <StepNav hideBack onNext={() => flow.validateStep(1)} nextStepLabel={tx('Überschneidung prüfen')} />
        </div>
      </WizardStep>

      <WizardStep
        label={tx('Prüfung')}
        heading={tx('Überschneidung prüfen')}
        description={tx('Wir vergleichen den Zeitraum mit allen bestehenden Belegungen.')}
        needs={['anreisedatum', 'abreisedatum']}
      >
        <div className="space-y-4">
          {belegung.loading ? (
            <p className="text-sm text-muted-foreground">{tx('Belegungen werden geladen …')}</p>
          ) : free ? (
            <div className="flex items-start gap-3 rounded-2xl border bg-card p-4">
              <IconCircleCheck size={24} className="shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="font-medium">{tx('Keine Überschneidung')}</p>
                <p className="text-sm text-muted-foreground">
                  {tx`${showDate(from)} – ${showDate(to)} ist frei und kann eingetragen werden.`}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <IconAlertTriangle size={24} className="shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="font-medium">{tx('Der Zeitraum überschneidet sich mit einer Belegung')}</p>
                <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  {conflicts.map(c => (
                    <li key={`${c.start}-${c.end ?? ''}`}>{tx`${showDate(c.start)} – ${showDate(c.end)}`}</li>
                  ))}
                </ul>
                <p className="mt-2 text-sm">{tx('Geh zurück und wähle einen anderen Zeitraum.')}</p>
              </div>
            </div>
          )}
          <StepNav
            onBack={() => setStep(1)}
            nextDisabled={belegung.loading || !free}
            onNext={() => (free ? true : tx('Der Zeitraum ist nicht frei.'))}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      <WizardStep label={tx('Speichern')} heading={tx('Belegung speichern')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            items={[{ key: 'status', label: tx('Status'), value: tx('Belegt') }]}
            whatHappensNext={tx('Der Zeitraum erscheint sofort als belegt im Belegungskalender.')}
          />
        )}
      </WizardStep>

      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          next={[{ label: tx('Zum Dashboard'), href: '#/' }]}
          whatHappensNext={tx('Der Zeitraum ist jetzt für Buchungsanfragen gesperrt.')}
        />
      )}
    </IntentWizardShell>
  );
}
