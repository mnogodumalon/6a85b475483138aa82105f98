/**
 * Anfrage bearbeiten — 2-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage wählen → 2) Belegung bestätigen & anlegen.
 * Reads: buchungsanfrage, belegungskalender (für Verfügbarkeitsprüfung).
 * Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker.
 */

import { useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { tx } from '@/i18n';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { LOOKUP_OPTIONS } from '@/types/app';
import type { Buchungsanfrage } from '@/types/app';
import { formatDate } from '@/lib/formatters';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker, rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconAlertCircle, IconCheck, IconUsers, IconCalendar } from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['belegungskalender']?.['status'] ?? [];

export default function AnfrageBearbeitenPage() {
  const data = useDashboardData();
  const { buchungsanfrage, belegungskalender, loading, error, fetchAll } = data;

  const [step, setStep] = useState(1);
  const [selectedAnfrage, setSelectedAnfrage] = useState<Buchungsanfrage | null>(null);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [statusKey, setStatusKey] = useState<string>(STATUS_OPTIONS[0]?.key ?? 'belegt');
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const blocked = belegungskalender
    .filter((b) => b.fields.status?.key === 'belegt')
    .map((b) => ({ start: b.fields.anreisedatum!, end: b.fields.abreisedatum }));

  const handleSelectAnfrage = (id: string) => {
    const anfrage = buchungsanfrage.find((a) => a.record_id === id) ?? null;
    setSelectedAnfrage(anfrage);
    setRange({
      from: anfrage?.fields.wunsch_anreise ?? null,
      to: anfrage?.fields.wunsch_abreise ?? null,
    });
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'belegt');
    setInterneNotiz('');
    setSubmitError(null);
    setStep(2);
  };

  const nightsCount =
    range.from && range.to
      ? differenceInDays(parseISO(range.to), parseISO(range.from))
      : 0;

  const validationError = (() => {
    if (!range.from || !range.to) return tx('Bitte Anreise- und Abreisedatum wählen.');
    if (nightsCount < 3) return tx('Das Abreisedatum muss mindestens 3 Nächte nach der Anreise liegen.');
    if (!rangeIsFree(range.from, range.to, blocked))
      return tx('Der gewählte Zeitraum überschneidet sich mit einer bestehenden Belegung.');
    return null;
  })();

  const handleConfirm = async () => {
    if (validationError) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: range.from!,
        abreisedatum: range.to!,
        status: statusKey,
        interne_notiz: interneNotiz || undefined,
      });
      await fetchAll();
      setSuccess(true);
    } catch {
      setSubmitError(tx('Beim Anlegen der Belegung ist ein Fehler aufgetreten. Bitte erneut versuchen.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAnfrage(null);
    setRange({ from: null, to: null });
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'belegt');
    setInterneNotiz('');
    setSubmitError(null);
    setSuccess(false);
    setStep(1);
  };

  return (
    <IntentWizardShell
      title={tx('Anfrage bearbeiten')}
      subtitle={tx('Buchungsanfrage auswählen und Belegung bestätigen')}
      steps={[{ label: tx('Anfrage wählen') }, { label: tx('Belegung bestätigen') }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Anfrage wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={buchungsanfrage.map((a) => ({
            id: a.record_id,
            title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || a.record_id,
            subtitle: [
              a.fields.wunsch_anreise
                ? `${tx('Anreise')}: ${formatDate(a.fields.wunsch_anreise)}`
                : null,
              a.fields.wunsch_abreise
                ? `${tx('Abreise')}: ${formatDate(a.fields.wunsch_abreise)}`
                : null,
              a.fields.anzahl_personen
                ? `${a.fields.anzahl_personen} ${tx('Personen')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            icon: <IconUsers size={20} className="text-primary shrink-0" />,
            stats: [
              ...(a.fields.email ? [{ label: tx('E-Mail'), value: a.fields.email }] : []),
              ...(a.fields.anzahl_personen
                ? [{ label: tx('Personen'), value: String(a.fields.anzahl_personen) }]
                : []),
            ],
          }))}
          onSelect={handleSelectAnfrage}
          searchPlaceholder={tx('Anfrage suchen …')}
          emptyText={tx('Keine Buchungsanfragen vorhanden.')}
          emptyIcon={<IconCalendar size={32} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2: Belegung bestätigen */}
      {step === 2 && (
        selectedAnfrage ? (
          success ? (
            <div className="flex flex-col items-center gap-6 py-12 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <IconCheck size={40} className="text-emerald-600" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold text-foreground">
                  {tx('Belegung erfolgreich angelegt')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {range.from && range.to
                    ? `${formatDate(range.from)} – ${formatDate(range.to)}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button onClick={handleReset} variant="outline">
                  {tx('Neue Anfrage bearbeiten')}
                </Button>
                <Button asChild>
                  <a href="#/">{tx('Zurück zum Dashboard')}</a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Zusammenfassung der Anfrage */}
              <div className="rounded-2xl border bg-secondary/40 p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tx('Ausgewählte Anfrage')}
                </p>
                <p className="font-semibold text-foreground">
                  {[selectedAnfrage.fields.vorname, selectedAnfrage.fields.nachname]
                    .filter(Boolean)
                    .join(' ')}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {selectedAnfrage.fields.email && (
                    <span>{selectedAnfrage.fields.email}</span>
                  )}
                  {selectedAnfrage.fields.anzahl_personen && (
                    <span>
                      {selectedAnfrage.fields.anzahl_personen} {tx('Personen')}
                    </span>
                  )}
                </div>
              </div>

              {/* Verfügbarkeitskalender */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {tx('Reisezeitraum')}
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  {tx('Mindestaufenthalt: 3 Nächte. Bereits belegte Tage sind markiert.')}
                </p>
                <AvailabilityRangePicker
                  blocked={blocked}
                  value={range}
                  onChange={setRange}
                  minNights={3}
                  months={2}
                  disablePast={true}
                  legend={true}
                />
                {range.from && range.to && nightsCount >= 3 && (
                  <p className="text-sm text-muted-foreground">
                    {nightsCount} {tx('Nächte')}
                    {' · '}
                    {formatDate(range.from)} – {formatDate(range.to)}
                  </p>
                )}
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor="status-select" className="text-sm font-medium">
                  {tx('Status')}
                </Label>
                <Select value={statusKey} onValueChange={setStatusKey}>
                  <SelectTrigger id="status-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Interne Notiz */}
              <div className="space-y-2">
                <Label htmlFor="interne-notiz" className="text-sm font-medium">
                  {tx('Interne Notiz')}
                  <span className="ml-1 text-muted-foreground font-normal text-xs">
                    {tx('(optional, z. B. Gästename)')}
                  </span>
                </Label>
                <Textarea
                  id="interne-notiz"
                  value={interneNotiz}
                  onChange={(e) => setInterneNotiz(e.target.value)}
                  placeholder={tx('Interne Anmerkungen zur Belegung …')}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Validierungsfehler / Submit-Fehler */}
              {(validationError || submitError) && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{submitError ?? validationError}</span>
                </div>
              )}

              {/* Aktionen */}
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                >
                  {tx('Andere Anfrage wählen')}
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!!validationError || submitting}
                >
                  {submitting ? tx('Wird angelegt …') : tx('Belegung anlegen')}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
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
