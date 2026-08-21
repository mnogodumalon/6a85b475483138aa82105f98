/**
 * Anfrage bearbeiten — 2-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage auswählen → 2) Zeitraum prüfen & Belegung anlegen.
 * Reads: buchungsanfrage, belegungskalender. Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker, rangeIsFree, isNightBlocked } from '@/components/blocks/AvailabilityRangePicker';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { LOOKUP_OPTIONS } from '@/types/app';
import type { Buchungsanfrage } from '@/types/app';
import { formatDate } from '@/lib/formatters';
import { tx } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { IconCalendar, IconAlertTriangle, IconCircleCheck, IconUsers } from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['belegungskalender']?.['status'] ?? [];

export default function AnfrageBearbeitenPage() {
  const { buchungsanfrage, belegungskalender, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAnfrage, setSelectedAnfrage] = useState<Buchungsanfrage | null>(null);

  // Step 2 form state
  const [anreisedatum, setAnreisedatum] = useState('');
  const [abreisedatum, setAbreisedatum] = useState('');
  const [status, setStatus] = useState('belegt');
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Sort anfragen by wunsch_anreise ascending
  const sortedAnfragen = [...buchungsanfrage].sort((a, b) => {
    const da = a.fields.wunsch_anreise ?? '';
    const db = b.fields.wunsch_anreise ?? '';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  // Blocked ranges from existing belegungskalender with status='belegt'
  const blocked = belegungskalender
    .filter(b => b.fields.status?.key === 'belegt')
    .map(b => ({ start: b.fields.anreisedatum!, end: b.fields.abreisedatum }));

  const handleSelectAnfrage = (id: string) => {
    const anfrage = buchungsanfrage.find(a => a.record_id === id) ?? null;
    setSelectedAnfrage(anfrage);
    if (anfrage) {
      setAnreisedatum(anfrage.fields.wunsch_anreise ?? '');
      setAbreisedatum(anfrage.fields.wunsch_abreise ?? '');
      setStatus('belegt');
      setInterneNotiz('');
      setSubmitError(null);
      setDone(false);
    }
    setStep(2);
  };

  const conflictDetected = anreisedatum && abreisedatum
    ? !rangeIsFree(anreisedatum, abreisedatum, blocked)
    : false;

  const handleSubmit = async () => {
    if (!anreisedatum || !abreisedatum) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum,
        abreisedatum,
        status: 'belegt',
        interne_notiz: interneNotiz || undefined,
      });
      await fetchAll();
      setDone(true);
    } catch {
      setSubmitError(tx('Fehler beim Anlegen der Belegung. Bitte erneut versuchen.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAnfrage(null);
    setAnreisedatum('');
    setAbreisedatum('');
    setStatus('belegt');
    setInterneNotiz('');
    setSubmitError(null);
    setDone(false);
    setStep(1);
  };

  return (
    <IntentWizardShell
      title={tx('Anfrage bearbeiten')}
      subtitle={tx('Buchungsanfrage prüfen und Belegung anlegen')}
      steps={[{ label: tx('Anfrage auswählen') }, { label: tx('Zeitraum prüfen & Belegung anlegen') }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1 — Anfrage auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={sortedAnfragen.map(a => ({
            id: a.record_id,
            title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || a.record_id,
            subtitle: [
              a.fields.wunsch_anreise
                ? `${tx('Anreise')} ${formatDate(a.fields.wunsch_anreise)}`
                : null,
              a.fields.wunsch_abreise
                ? `${tx('bis')} ${formatDate(a.fields.wunsch_abreise)}`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
            stats: [
              ...(a.fields.anzahl_personen != null
                ? [{ label: tx('Personen'), value: String(a.fields.anzahl_personen) }]
                : []),
              ...(a.fields.email ? [{ label: tx('E-Mail'), value: a.fields.email }] : []),
            ],
            icon: <IconUsers size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAnfrage}
          searchPlaceholder={tx('Anfrage suchen …')}
          emptyText={tx('Keine Buchungsanfragen vorhanden')}
          emptyIcon={<IconCalendar size={40} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2 — Zeitraum prüfen & Belegung anlegen */}
      {step === 2 && (
        selectedAnfrage ? (
          <div className="space-y-6">
            {done ? (
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <IconCircleCheck size={48} className="text-emerald-500" />
                <h2 className="text-lg font-semibold">{tx('Belegung erfolgreich angelegt')}</h2>
                <p className="text-sm text-muted-foreground">
                  {tx('Der Zeitraum wurde als belegt eingetragen.')}
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Button variant="outline" onClick={handleReset}>
                    {tx('Neue Anfrage bearbeiten')}
                  </Button>
                  <a href="#/">
                    <Button variant="default">{tx('Zurück zum Dashboard')}</Button>
                  </a>
                </div>
              </div>
            ) : (
              <>
                {/* Anfrage-Details */}
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    {tx('Gewünschter Zeitraum der Anfrage')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{tx('Gast')}</p>
                      <p className="font-medium">
                        {`${selectedAnfrage.fields.vorname ?? ''} ${selectedAnfrage.fields.nachname ?? ''}`.trim()}
                      </p>
                    </div>
                    {selectedAnfrage.fields.anzahl_personen != null && (
                      <div>
                        <p className="text-xs text-muted-foreground">{tx('Anzahl Personen')}</p>
                        <p className="font-medium">{selectedAnfrage.fields.anzahl_personen}</p>
                      </div>
                    )}
                    {selectedAnfrage.fields.email && (
                      <div>
                        <p className="text-xs text-muted-foreground">{tx('E-Mail')}</p>
                        <p className="font-medium">{selectedAnfrage.fields.email}</p>
                      </div>
                    )}
                    {selectedAnfrage.fields.telefon && (
                      <div>
                        <p className="text-xs text-muted-foreground">{tx('Telefon')}</p>
                        <p className="font-medium">{selectedAnfrage.fields.telefon}</p>
                      </div>
                    )}
                    {selectedAnfrage.fields.wunsch_anreise && (
                      <div>
                        <p className="text-xs text-muted-foreground">{tx('Wunsch-Anreise')}</p>
                        <p className="font-medium">{formatDate(selectedAnfrage.fields.wunsch_anreise)}</p>
                      </div>
                    )}
                    {selectedAnfrage.fields.wunsch_abreise && (
                      <div>
                        <p className="text-xs text-muted-foreground">{tx('Wunsch-Abreise')}</p>
                        <p className="font-medium">{formatDate(selectedAnfrage.fields.wunsch_abreise)}</p>
                      </div>
                    )}
                    {selectedAnfrage.fields.anmerkungen && (
                      <div className="sm:col-span-2">
                        <p className="text-xs text-muted-foreground">{tx('Anmerkungen')}</p>
                        <p className="font-medium">{selectedAnfrage.fields.anmerkungen}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Verfügbarkeitskalender */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    {tx('Verfügbarkeit prüfen')}
                  </h3>
                  <AvailabilityRangePicker
                    blocked={blocked}
                    value={{ from: anreisedatum || null, to: abreisedatum || null }}
                    onChange={({ from, to }) => {
                      if (from !== undefined) setAnreisedatum(from ?? '');
                      if (to !== undefined) setAbreisedatum(to ?? '');
                    }}
                    disablePast={false}
                  />
                </div>

                {/* Konflikt-Warnung */}
                {conflictDetected && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
                    <IconAlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <p className="text-sm">
                      {tx('Der gewählte Zeitraum überschneidet sich mit einer bestehenden Belegung. Bitte wähle einen anderen Zeitraum.')}
                    </p>
                  </div>
                )}

                {/* Formular */}
                <div className="rounded-2xl border bg-card p-4 space-y-4">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    {tx('Neue Belegung anlegen')}
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="anreisedatum">{tx('Anreisedatum')}</Label>
                      <Input
                        id="anreisedatum"
                        type="date"
                        value={anreisedatum}
                        onChange={e => setAnreisedatum(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="abreisedatum">{tx('Abreisedatum')}</Label>
                      <Input
                        id="abreisedatum"
                        type="date"
                        value={abreisedatum}
                        onChange={e => setAbreisedatum(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="interne-notiz">{tx('Interne Notiz')}</Label>
                    <Textarea
                      id="interne-notiz"
                      value={interneNotiz}
                      onChange={e => setInterneNotiz(e.target.value)}
                      placeholder={tx('z.B. Gastname, besondere Hinweise …')}
                      rows={3}
                    />
                  </div>

                  {submitError && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                      <IconAlertTriangle size={18} className="shrink-0 mt-0.5" />
                      <p className="text-sm">{submitError}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 pt-1">
                    <Button
                      variant="outline"
                      onClick={() => setStep(1)}
                    >
                      {tx('Zurück')}
                    </Button>
                    <Button
                      disabled={
                        !anreisedatum ||
                        !abreisedatum ||
                        conflictDetected ||
                        submitting
                      }
                      onClick={handleSubmit}
                    >
                      {submitting ? tx('Wird gespeichert …') : tx('Belegung anlegen')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              {tx('Neu starten')}
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
