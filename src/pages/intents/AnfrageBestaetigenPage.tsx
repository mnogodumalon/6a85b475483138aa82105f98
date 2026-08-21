/**
 * Anfrage bestätigen — 3-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage wählen → 2) Zeitraum prüfen (Verfügbarkeit) → 3) Belegung anlegen.
 * Reads: buchungsanfrage, belegungskalender. Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker.
 */
import { useState } from 'react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { IconCalendar, IconUsers, IconMail, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { tx } from '@/i18n';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Buchungsanfrage } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import {
  AvailabilityRangePicker,
  rangeIsFree,
} from '@/components/blocks/AvailabilityRangePicker';
import type { AvailabilityRange } from '@/components/blocks/AvailabilityRangePicker';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function AnfrageBestaetigenPage() {
  const data = useDashboardData();
  const { buchungsanfrage, belegungskalender, loading, error, fetchAll } = data;

  const [step, setStep] = useState(1);
  const [selectedAnfrage, setSelectedAnfrage] = useState<Buchungsanfrage | null>(null);
  const [rangeWarning, setRangeWarning] = useState(false);
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const blocked: AvailabilityRange[] = belegungskalender
    .filter(b => b.fields.status?.key === 'belegt')
    .map(b => ({ start: b.fields.anreisedatum!, end: b.fields.abreisedatum }));

  const handleSelectAnfrage = (id: string) => {
    const found = buchungsanfrage.find(a => a.record_id === id) ?? null;
    setSelectedAnfrage(found);
    if (found) {
      const vorname = found.fields.vorname ?? '';
      const nachname = found.fields.nachname ?? '';
      const email = found.fields.email ?? '';
      const personen = found.fields.anzahl_personen ?? '';
      setInterneNotiz(
        tx`Gast: ${vorname} ${nachname}, ${email}, ${personen} Personen`
      );
      const from = found.fields.wunsch_anreise;
      const to = found.fields.wunsch_abreise;
      if (from && to) {
        setRangeWarning(!rangeIsFree(from, to, blocked));
      } else {
        setRangeWarning(false);
      }
      setStep(2);
    }
  };

  const handleProceedToCreate = () => {
    setSubmitError(null);
    setStep(3);
  };

  const handleCreateBelegung = async () => {
    if (!selectedAnfrage) return;
    const anreise = selectedAnfrage.fields.wunsch_anreise;
    const abreise = selectedAnfrage.fields.wunsch_abreise;
    if (!anreise || !abreise) {
      setSubmitError(tx('Anfrage hat kein vollständiges Datum.'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: format(parseISO(anreise), 'yyyy-MM-dd'),
        abreisedatum: format(parseISO(abreise), 'yyyy-MM-dd'),
        status: 'belegt',
        interne_notiz: interneNotiz,
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
    setRangeWarning(false);
    setInterneNotiz('');
    setSubmitError(null);
    setDone(false);
    setStep(1);
  };

  const nights =
    selectedAnfrage?.fields.wunsch_anreise && selectedAnfrage?.fields.wunsch_abreise
      ? differenceInDays(
          parseISO(selectedAnfrage.fields.wunsch_abreise),
          parseISO(selectedAnfrage.fields.wunsch_anreise)
        )
      : null;

  return (
    <IntentWizardShell
      title={tx('Anfrage bestätigen')}
      subtitle={tx('Buchungsanfrage prüfen und Belegung anlegen')}
      steps={[
        { label: tx('Anfrage wählen') },
        { label: tx('Zeitraum prüfen') },
        { label: tx('Belegung anlegen') },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Anfrage wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={buchungsanfrage.map(a => ({
            id: a.record_id,
            title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || a.record_id,
            subtitle: [
              a.fields.wunsch_anreise
                ? `${tx('Anreise')}: ${format(parseISO(a.fields.wunsch_anreise), 'dd.MM.yyyy')}`
                : null,
              a.fields.wunsch_abreise
                ? `${tx('Abreise')}: ${format(parseISO(a.fields.wunsch_abreise), 'dd.MM.yyyy')}`
                : null,
              a.fields.anzahl_personen != null
                ? `${a.fields.anzahl_personen} ${tx('Personen')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            stats: [
              { label: tx('E-Mail'), value: a.fields.email ?? '—' },
            ],
            icon: <IconCalendar size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAnfrage}
          searchPlaceholder={tx('Nach Vor- oder Nachname suchen …')}
          emptyText={tx('Keine offenen Anfragen gefunden.')}
        />
      )}

      {/* Step 2: Zeitraum prüfen */}
      {step === 2 && (
        selectedAnfrage ? (
          <div className="space-y-6">
            {/* Anfragedetails */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h2 className="text-base font-semibold">{tx('Anfragedetails')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-2">
                  <IconUsers size={16} className="shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <div className="font-medium">
                      {selectedAnfrage.fields.vorname} {selectedAnfrage.fields.nachname}
                    </div>
                    {selectedAnfrage.fields.anzahl_personen != null && (
                      <div className="text-muted-foreground">
                        {selectedAnfrage.fields.anzahl_personen} {tx('Personen')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <IconMail size={16} className="shrink-0 text-muted-foreground mt-0.5" />
                  <div className="break-all">{selectedAnfrage.fields.email ?? '—'}</div>
                </div>
                <div className="flex items-start gap-2">
                  <IconCalendar size={16} className="shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <div>
                      <span className="font-medium">{tx('Anreise')}:</span>{' '}
                      {selectedAnfrage.fields.wunsch_anreise
                        ? format(parseISO(selectedAnfrage.fields.wunsch_anreise), 'dd.MM.yyyy')
                        : '—'}
                    </div>
                    <div>
                      <span className="font-medium">{tx('Abreise')}:</span>{' '}
                      {selectedAnfrage.fields.wunsch_abreise
                        ? format(parseISO(selectedAnfrage.fields.wunsch_abreise), 'dd.MM.yyyy')
                        : '—'}
                    </div>
                    {nights != null && (
                      <div className="text-muted-foreground">
                        {nights} {tx('Nächte')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Verfügbarkeitskalender */}
            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <h2 className="text-base font-semibold">{tx('Verfügbarkeit prüfen')}</h2>
              <p className="text-sm text-muted-foreground">
                {tx('Der gewünschte Zeitraum ist im Kalender markiert. Belegte Nächte sind durchgestrichen.')}
              </p>
              <AvailabilityRangePicker
                blocked={blocked}
                value={{
                  from: selectedAnfrage.fields.wunsch_anreise ?? null,
                  to: selectedAnfrage.fields.wunsch_abreise ?? null,
                }}
                onChange={() => {/* read-only view — host picked the range */}}
                disablePast={false}
              />
            </div>

            {/* Warnung wenn belegt */}
            {rangeWarning && (
              <div className="rounded-2xl border border-amber-400 bg-amber-50 p-4 flex gap-3 text-sm text-amber-800">
                <IconAlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <div className="font-semibold">{tx('Zeitraum bereits belegt')}</div>
                  <div>
                    {tx('Mindestens eine Nacht in diesem Zeitraum ist bereits vergeben. Du kannst trotzdem fortfahren (manuelle Überschreibung).')}
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                {tx('Zurück')}
              </Button>
              <Button onClick={handleProceedToCreate}>
                {tx('Zeitraum bestätigen – weiter')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt benötigt eine ausgewählte Anfrage.')}
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              {tx('Neu starten')}
            </Button>
          </div>
        )
      )}

      {/* Step 3: Belegung anlegen */}
      {step === 3 && (
        selectedAnfrage ? (
          done ? (
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-emerald-100 p-4">
                  <IconCheck size={32} className="text-emerald-600" />
                </div>
              </div>
              <h2 className="text-lg font-semibold">{tx('Belegung erfolgreich angelegt')}</h2>
              <p className="text-sm text-muted-foreground">
                {tx('Der Zeitraum wurde im Belegungskalender als belegt eingetragen.')}
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Button variant="outline" onClick={handleReset}>
                  {tx('Weitere Anfrage bestätigen')}
                </Button>
                <a href="#/">
                  <Button>{tx('Zurück zum Dashboard')}</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Zusammenfassung */}
              <div className="rounded-2xl border bg-card p-5 space-y-3">
                <h2 className="text-base font-semibold">{tx('Zusammenfassung')}</h2>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">{tx('Gast')}:</span>{' '}
                    <span className="font-medium">
                      {selectedAnfrage.fields.vorname} {selectedAnfrage.fields.nachname}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{tx('Anreise')}:</span>{' '}
                    {selectedAnfrage.fields.wunsch_anreise
                      ? format(parseISO(selectedAnfrage.fields.wunsch_anreise), 'dd.MM.yyyy')
                      : '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">{tx('Abreise')}:</span>{' '}
                    {selectedAnfrage.fields.wunsch_abreise
                      ? format(parseISO(selectedAnfrage.fields.wunsch_abreise), 'dd.MM.yyyy')
                      : '—'}
                  </div>
                  {nights != null && (
                    <div>
                      <span className="text-muted-foreground">{tx('Nächte')}:</span> {nights}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">{tx('Status')}:</span>{' '}
                    <span className="font-medium text-emerald-700">{tx('belegt')}</span>
                  </div>
                </div>
              </div>

              {/* Interne Notiz (bearbeitbar) */}
              <div className="rounded-2xl border bg-card p-5 space-y-3">
                <h2 className="text-base font-semibold">{tx('Interne Notiz')}</h2>
                <p className="text-sm text-muted-foreground">
                  {tx('Diese Notiz wird im Belegungskalender gespeichert und ist nur intern sichtbar.')}
                </p>
                <Textarea
                  value={interneNotiz}
                  onChange={e => setInterneNotiz(e.target.value)}
                  rows={3}
                  placeholder={tx('Interne Notiz …')}
                />
              </div>

              {submitError && (
                <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              {rangeWarning && (
                <div className="rounded-2xl border border-amber-400 bg-amber-50 p-4 flex gap-3 text-sm text-amber-800">
                  <IconAlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    {tx('Hinweis: Der Zeitraum ist bereits teilweise belegt. Die Belegung wird trotzdem angelegt.')}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  {tx('Zurück')}
                </Button>
                <Button
                  onClick={handleCreateBelegung}
                  disabled={submitting}
                >
                  {submitting ? tx('Wird angelegt …') : tx('Belegung jetzt anlegen')}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt benötigt eine ausgewählte Anfrage.')}
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
