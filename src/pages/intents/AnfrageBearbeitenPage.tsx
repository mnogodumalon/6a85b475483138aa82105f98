/**
 * Anfrage bearbeiten — 2-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage auswählen → 2) Details prüfen und Belegung anlegen.
 * Reads: buchungsanfragen, belegungskalender (für AvailabilityRangePicker).
 * Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker.
 */

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IconCalendar, IconUser, IconUsers, IconNotes, IconCheck } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker, rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import type { Buchungsanfrage } from '@/types/app';
import { tx } from '@/i18n';

export default function AnfrageBearbeitenPage() {
  const { buchungsanfrage: buchungsanfragen, belegungskalender, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAnfrage, setSelectedAnfrage] = useState<Buchungsanfrage | null>(null);
  const [anreise, setAnreise] = useState<string>('');
  const [abreise, setAbreise] = useState<string>('');
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const blocked = belegungskalender
    .filter(b => b.fields.status?.key === 'belegt')
    .map(b => ({ start: b.fields.anreisedatum!, end: b.fields.abreisedatum }));

  function handleSelectAnfrage(id: string) {
    const anfrage = buchungsanfragen.find((a: Buchungsanfrage) => a.record_id === id) ?? null;
    setSelectedAnfrage(anfrage);
    setAnreise(anfrage?.fields.wunsch_anreise ?? '');
    setAbreise(anfrage?.fields.wunsch_abreise ?? '');
    setInterneNotiz('');
    setSubmitError(null);
    setStep(2);
  }

  async function handleSubmit() {
    if (!anreise || !abreise) return;
    if (!rangeIsFree(anreise, abreise, blocked)) {
      setSubmitError(tx('Die gewählten Daten überschneiden sich mit einer bestehenden Belegung.'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: anreise,
        abreisedatum: abreise,
        status: 'belegt',
        interne_notiz: interneNotiz || undefined,
      });
      setDone(true);
    } catch {
      setSubmitError(tx('Fehler beim Anlegen der Belegung. Bitte erneut versuchen.'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAnfrage(null);
    setAnreise('');
    setAbreise('');
    setInterneNotiz('');
    setSubmitError(null);
    setDone(false);
    setStep(1);
  }

  const canSubmit = !!anreise && !!abreise;

  return (
    <IntentWizardShell
      title={tx('Anfrage bearbeiten')}
      subtitle={tx('Buchungsanfrage prüfen und Belegung eintragen')}
      steps={[{ label: tx('Anfrage auswählen') }, { label: tx('Belegung anlegen') }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Anfrage auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={buchungsanfragen.map((a: Buchungsanfrage) => ({
            id: a.record_id,
            title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('(Kein Name)'),
            subtitle: [
              a.fields.wunsch_anreise
                ? `${tx('Anreise')}: ${format(parseISO(a.fields.wunsch_anreise), 'dd.MM.yyyy')}`
                : null,
              a.fields.wunsch_abreise
                ? `${tx('Abreise')}: ${format(parseISO(a.fields.wunsch_abreise), 'dd.MM.yyyy')}`
                : null,
              a.fields.anzahl_personen
                ? `${a.fields.anzahl_personen} ${tx('Personen')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAnfrage}
          searchPlaceholder={tx('Anfrage suchen …')}
          emptyText={tx('Keine Buchungsanfragen vorhanden')}
          emptyIcon={<IconCalendar size={40} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2: Details prüfen und Belegung anlegen */}
      {step === 2 && (
        selectedAnfrage ? (
          done ? (
            /* Erfolg */
            <div className="flex flex-col items-center gap-6 py-12 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <IconCheck size={40} className="text-emerald-600" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{tx('Belegung erfolgreich eingetragen')}</h2>
                <p className="text-sm text-muted-foreground">
                  {[selectedAnfrage.fields.vorname, selectedAnfrage.fields.nachname].filter(Boolean).join(' ')}
                  {anreise && abreise
                    ? ` · ${format(parseISO(anreise), 'dd.MM.yyyy')} – ${format(parseISO(abreise), 'dd.MM.yyyy')}`
                    : ''}
                </p>
              </div>
              <div className="flex gap-3 flex-wrap justify-center">
                <Button variant="outline" onClick={handleReset}>
                  {tx('Neue Anfrage bearbeiten')}
                </Button>
                <a href="#/">
                  <Button>{tx('Zurück zum Dashboard')}</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Anfrage-Details (read-only) */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <IconUser size={18} className="text-muted-foreground shrink-0" />
                  {tx('Anfrage-Details')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {selectedAnfrage.fields.vorname || selectedAnfrage.fields.nachname ? (
                    <div>
                      <span className="text-muted-foreground">{tx('Name')}</span>
                      <p className="font-medium text-foreground mt-0.5">
                        {[selectedAnfrage.fields.vorname, selectedAnfrage.fields.nachname].filter(Boolean).join(' ')}
                      </p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.email ? (
                    <div>
                      <span className="text-muted-foreground">{tx('E-Mail')}</span>
                      <p className="font-medium text-foreground mt-0.5">{selectedAnfrage.fields.email}</p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.telefon ? (
                    <div>
                      <span className="text-muted-foreground">{tx('Telefon')}</span>
                      <p className="font-medium text-foreground mt-0.5">{selectedAnfrage.fields.telefon}</p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.anzahl_personen ? (
                    <div>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <IconUsers size={14} className="shrink-0" />
                        {tx('Personen')}
                      </span>
                      <p className="font-medium text-foreground mt-0.5">{selectedAnfrage.fields.anzahl_personen}</p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.wunsch_anreise ? (
                    <div>
                      <span className="text-muted-foreground">{tx('Gewünschte Anreise')}</span>
                      <p className="font-medium text-foreground mt-0.5">
                        {format(parseISO(selectedAnfrage.fields.wunsch_anreise), 'dd.MM.yyyy')}
                      </p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.wunsch_abreise ? (
                    <div>
                      <span className="text-muted-foreground">{tx('Gewünschte Abreise')}</span>
                      <p className="font-medium text-foreground mt-0.5">
                        {format(parseISO(selectedAnfrage.fields.wunsch_abreise), 'dd.MM.yyyy')}
                      </p>
                    </div>
                  ) : null}
                  {selectedAnfrage.fields.anmerkungen ? (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <IconNotes size={14} className="shrink-0" />
                        {tx('Anmerkungen')}
                      </span>
                      <p className="font-medium text-foreground mt-0.5 whitespace-pre-line">
                        {selectedAnfrage.fields.anmerkungen}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Belegungsdaten (bearbeitbar) */}
              <div className="rounded-2xl border bg-card p-5 space-y-5">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <IconCalendar size={18} className="text-muted-foreground shrink-0" />
                  {tx('Belegungszeitraum wählen')}
                </h3>

                <AvailabilityRangePicker
                  blocked={blocked}
                  value={{ from: anreise || null, to: abreise || null }}
                  onChange={r => {
                    setAnreise(r.from ?? '');
                    setAbreise(r.to ?? '');
                    setSubmitError(null);
                  }}
                  minNights={1}
                  disablePast={false}
                />

                <div className="space-y-2">
                  <Label htmlFor="interne-notiz" className="text-sm font-medium text-foreground">
                    {tx('Interne Notiz')}
                    <span className="ml-1 text-muted-foreground font-normal">{tx('(optional)')}</span>
                  </Label>
                  <Textarea
                    id="interne-notiz"
                    value={interneNotiz}
                    onChange={e => setInterneNotiz(e.target.value)}
                    placeholder={tx('Hinweise zur Buchung …')}
                    className="resize-none"
                    rows={3}
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                >
                  {tx('Zurück')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className="flex-1 sm:flex-none"
                >
                  {submitting ? tx('Wird eingetragen …') : tx('Belegung anlegen')}
                </Button>
              </div>
            </div>
          )
        ) : (
          /* Fallback bei direktem Aufruf von ?step=2 ohne Auswahl */
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt braucht eine ausgewählte Anfrage aus Schritt 1.')}
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
