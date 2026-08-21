/**
 * Belegung erstellen — 2-Schritt-Wizard.
 * Steps: 1) Zeitraum wählen (mit AvailabilityRangePicker gegen bestehende Belegungen) →
 *         2) Details und speichern (Status + interne Notiz, dann Anlegen).
 * Reads: belegungskalender. Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, AvailabilityRangePicker.
 */

import { useState, useEffect } from 'react';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { IconCalendar, IconAlertTriangle } from '@tabler/icons-react';
import { tx } from '@/i18n';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import {
  AvailabilityRangePicker,
  rangeIsFree,
} from '@/components/blocks/AvailabilityRangePicker';
import type { AvailabilityRange, DateRangeValue } from '@/components/blocks/AvailabilityRangePicker';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const MIN_NIGHTS = 3;

export default function BelegungErstellenPage() {
  const data = useDashboardData();
  const { belegungskalender, loading, error, fetchAll } = data;

  const [searchParams, setSearchParams] = useSearchParams();
  const initialStep = parseInt(searchParams.get('step') ?? '1', 10);
  const [step, setStep] = useState(initialStep >= 1 && initialStep <= 2 ? initialStep : 1);

  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [interneNotiz, setInterneNotiz] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Sync step into URL
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('step', String(step));
      return next;
    }, { replace: true });
  }, [step, setSearchParams]);

  // Build blocked ranges from existing 'belegt' entries
  const blocked: AvailabilityRange[] = belegungskalender
    .filter(b => b.fields.status?.key === 'belegt')
    .map(b => ({
      start: b.fields.anreisedatum ?? '',
      end: b.fields.abreisedatum ?? undefined,
    }))
    .filter(r => r.start !== '');

  // Validation
  const from = range.from;
  const to = range.to;
  const nights = from && to ? differenceInCalendarDays(parseISO(to), parseISO(from)) : 0;
  const tooShort = from && to && nights < MIN_NIGHTS;
  const wrongOrder = from && to && to <= from;
  const overlaps = from && to && !wrongOrder && !rangeIsFree(from, to, blocked);
  const rangeValid = !!(from && to && !tooShort && !wrongOrder && !overlaps && nights >= MIN_NIGHTS);

  const handleSave = async () => {
    if (!from || !to) return;
    // Submit-time revalidation
    if (!rangeIsFree(from, to, blocked)) {
      setSaveError(tx('Der gewählte Zeitraum überschneidet sich mit einer bestehenden Belegung. Bitte wähle einen anderen Zeitraum.'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: from,
        abreisedatum: to,
        status: 'belegt',
        interne_notiz: interneNotiz || undefined,
      });
      await fetchAll();
      setDone(true);
    } catch {
      setSaveError(tx('Speichern fehlgeschlagen. Bitte versuche es erneut.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRange({ from: null, to: null });
    setInterneNotiz('');
    setSaveError(null);
    setDone(false);
    setStep(1);
  };

  if (done) {
    return (
      <IntentWizardShell
        title={tx('Belegung eintragen')}
        subtitle={tx('Neuen Zeitraum im Belegungskalender anlegen')}
        steps={[{ label: tx('Zeitraum') }, { label: tx('Details') }]}
        currentStep={2}
        onStepChange={setStep}
        loading={loading}
        error={error}
        onRetry={fetchAll}
      >
        <div className="flex flex-col items-center justify-center py-16 space-y-6 text-center">
          <div className="rounded-full bg-emerald-100 p-4">
            <IconCalendar size={40} className="text-emerald-600" stroke={1.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">{tx('Belegung eingetragen!')}</h2>
            <p className="text-muted-foreground text-sm">
              {from && to
                ? tx`${format(parseISO(from), 'dd.MM.yyyy')} – ${format(parseISO(to), 'dd.MM.yyyy')} wurde als belegt gespeichert.`
                : tx('Der Zeitraum wurde erfolgreich gespeichert.')}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button onClick={handleReset} variant="outline">
              {tx('Weitere Belegung eintragen')}
            </Button>
            <Button asChild>
              <a href="#/">{tx('Zurück zum Dashboard')}</a>
            </Button>
          </div>
        </div>
      </IntentWizardShell>
    );
  }

  return (
    <IntentWizardShell
      title={tx('Belegung eintragen')}
      subtitle={tx('Neuen Zeitraum im Belegungskalender anlegen')}
      steps={[{ label: tx('Zeitraum') }, { label: tx('Details') }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Zeitraum wählen */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">{tx('Zeitraum wählen')}</h3>
            <p className="text-sm text-muted-foreground">
              {tx('Wähle An- und Abreisedatum für die neue Belegung. Bereits belegte Nächte sind markiert.')}
            </p>
          </div>

          <AvailabilityRangePicker
            blocked={blocked}
            value={range}
            onChange={setRange}
            minNights={MIN_NIGHTS}
            months={2}
            disablePast
            legend
          />

          {/* Validation messages */}
          {wrongOrder && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{tx('Das Abreisedatum muss nach dem Anreisedatum liegen.')}</span>
            </div>
          )}
          {!wrongOrder && tooShort && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{tx`Mindestaufenthalt: ${MIN_NIGHTS} Nächte. Gewählt: ${nights} Nacht(e).`}</span>
            </div>
          )}
          {overlaps && !wrongOrder && !tooShort && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{tx('Achtung: Der gewählte Zeitraum überschneidet sich mit einer bestehenden Belegung.')}</span>
            </div>
          )}

          {from && to && rangeValid && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {tx`${nights} Nächte: ${format(parseISO(from), 'dd.MM.yyyy')} – ${format(parseISO(to), 'dd.MM.yyyy')}`}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              disabled={!rangeValid}
              onClick={() => setStep(2)}
            >
              {tx('Weiter zu Schritt 2')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Details und speichern */}
      {step === 2 && (
        from && to ? (
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">{tx('Details und speichern')}</h3>
              <p className="text-sm text-muted-foreground">
                {tx`Zeitraum: ${format(parseISO(from), 'dd.MM.yyyy')} – ${format(parseISO(to), 'dd.MM.yyyy')} (${nights} Nächte)`}
              </p>
            </div>

            {/* Status — fixed to 'belegt' per spec, shown as informational badge */}
            <div className="rounded-xl border bg-card px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{tx('Status')}</span>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-white">
                {tx('Belegt')}
              </span>
            </div>

            {/* Interne Notiz */}
            <div className="space-y-2">
              <Label htmlFor="interne_notiz" className="text-sm font-medium">
                {tx('Interne Notiz')}
                <span className="ml-1 text-muted-foreground font-normal">{tx('(optional)')}</span>
              </Label>
              <Textarea
                id="interne_notiz"
                value={interneNotiz}
                onChange={e => setInterneNotiz(e.target.value)}
                placeholder={tx('z.B. Familie Müller, Haustier dabei, …')}
                rows={3}
                className="resize-none"
              />
            </div>

            {saveError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row justify-between gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>
                {tx('Zurück')}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? tx('Wird gespeichert …') : tx('Belegung anlegen')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt braucht die Zeitraumauswahl aus Schritt 1.')}
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
