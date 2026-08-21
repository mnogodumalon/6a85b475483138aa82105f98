/**
 * Anfrage bearbeiten — 2-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage auswählen → 2) Zeitraum prüfen & Belegungseintrag anlegen (oder ablehnen).
 * Reads: buchungsanfrage. Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState } from 'react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { IconCalendar, IconCheck, IconUsers, IconX } from '@tabler/icons-react';

import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useDashboardData } from '@/hooks/useDashboardData';
import type { Buchungsanfrage } from '@/types/app';
import { LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { tx } from '@/i18n';

const STATUS_OPTIONS = LOOKUP_OPTIONS['belegungskalender']?.['status'] ?? [];

export default function AnfrageBearbeitenPage() {
  const { buchungsanfrage, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAnfrage, setSelectedAnfrage] = useState<Buchungsanfrage | null>(null);

  // Step 2 form state
  const [anreisedatum, setAnreisedatum] = useState('');
  const [abreisedatum, setAbreisedatum] = useState('');
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'belegt');
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSelectAnfrage = (id: string) => {
    const anfrage = buchungsanfrage.find(a => a.record_id === id) ?? null;
    setSelectedAnfrage(anfrage);
    if (anfrage) {
      setAnreisedatum(anfrage.fields.wunsch_anreise ?? '');
      setAbreisedatum(anfrage.fields.wunsch_abreise ?? '');
      setStatusKey('belegt');
      setInterneNotiz(
        anfrage.fields.vorname || anfrage.fields.nachname
          ? `${anfrage.fields.vorname ?? ''} ${anfrage.fields.nachname ?? ''}`.trim()
          : ''
      );
      setSubmitError(null);
    }
    setStep(2);
  };

  const handleBestaetigen = async () => {
    if (!anreisedatum || !abreisedatum) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum,
        abreisedatum,
        status: statusKey,
        interne_notiz: interneNotiz || undefined,
      });
      await fetchAll();
      setDone(true);
    } catch (e) {
      setSubmitError(tx('Fehler beim Anlegen des Belegungseintrags. Bitte erneut versuchen.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedAnfrage(null);
    setAnreisedatum('');
    setAbreisedatum('');
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'belegt');
    setInterneNotiz('');
    setSubmitError(null);
    setDone(false);
  };

  const naechte =
    anreisedatum && abreisedatum
      ? differenceInDays(parseISO(abreisedatum), parseISO(anreisedatum))
      : null;

  const canSubmit = !!anreisedatum && !!abreisedatum && !submitting;

  return (
    <IntentWizardShell
      title={tx('Anfrage bearbeiten')}
      subtitle={tx('Buchungsanfrage prüfen und als Belegung bestätigen')}
      steps={[{ label: tx('Anfrage wählen') }, { label: tx('Belegung anlegen') }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Anfrage auswählen */}
      {step === 1 && (
        <EntitySelectStep
          searchPlaceholder={tx('Name oder Datum suchen …')}
          items={buchungsanfrage.map(a => ({
            id: a.record_id,
            title:
              [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') ||
              tx('Unbekannte Person'),
            subtitle: [
              a.fields.wunsch_anreise
                ? `${tx('Anreise')}: ${formatDate(a.fields.wunsch_anreise)}`
                : null,
              a.fields.wunsch_abreise
                ? `${tx('Abreise')}: ${formatDate(a.fields.wunsch_abreise)}`
                : null,
              a.fields.anzahl_personen != null
                ? `${a.fields.anzahl_personen} ${tx('Personen')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            stats: [
              ...(a.fields.anzahl_personen != null
                ? [{ label: tx('Personen'), value: String(a.fields.anzahl_personen) }]
                : []),
              ...(a.fields.wunsch_anreise && a.fields.wunsch_abreise
                ? [
                    {
                      label: tx('Nächte'),
                      value: String(
                        differenceInDays(
                          parseISO(a.fields.wunsch_abreise),
                          parseISO(a.fields.wunsch_anreise)
                        )
                      ),
                    },
                  ]
                : []),
            ],
            icon: <IconCalendar size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAnfrage}
          emptyText={tx('Keine offenen Buchungsanfragen vorhanden.')}
          emptyIcon={<IconCalendar size={48} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2: Belegung anlegen oder ablehnen */}
      {step === 2 && (
        <>
          {!selectedAnfrage ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
              </p>
              <Button variant="outline" onClick={() => setStep(1)}>
                {tx('Neu starten')}
              </Button>
            </div>
          ) : done ? (
            <div className="text-center py-12 space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-emerald-100 p-4">
                  <IconCheck size={32} className="text-emerald-600" />
                </div>
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {tx('Belegung erfolgreich angelegt')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {[selectedAnfrage.fields.vorname, selectedAnfrage.fields.nachname]
                  .filter(Boolean)
                  .join(' ')}
                {naechte != null
                  ? ` · ${naechte} ${tx('Nächte')}`
                  : ''}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <Button onClick={handleReset}>
                  {tx('Weitere Anfrage bearbeiten')}
                </Button>
                <Button variant="outline" asChild>
                  <a href="#/">{tx('Zurück zum Dashboard')}</a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-lg mx-auto">
              {/* Anfrage-Zusammenfassung */}
              <div className="rounded-2xl border bg-secondary/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <IconUsers size={16} className="shrink-0 text-primary" />
                  {[selectedAnfrage.fields.vorname, selectedAnfrage.fields.nachname]
                    .filter(Boolean)
                    .join(' ') || tx('Unbekannte Person')}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {selectedAnfrage.fields.wunsch_anreise && (
                    <span>
                      {tx('Wunsch-Anreise')}:{' '}
                      <span className="text-foreground font-medium">
                        {formatDate(selectedAnfrage.fields.wunsch_anreise)}
                      </span>
                    </span>
                  )}
                  {selectedAnfrage.fields.wunsch_abreise && (
                    <span>
                      {tx('Wunsch-Abreise')}:{' '}
                      <span className="text-foreground font-medium">
                        {formatDate(selectedAnfrage.fields.wunsch_abreise)}
                      </span>
                    </span>
                  )}
                  {selectedAnfrage.fields.anzahl_personen != null && (
                    <span>
                      {selectedAnfrage.fields.anzahl_personen}{' '}
                      {tx('Personen')}
                    </span>
                  )}
                </div>
                {selectedAnfrage.fields.anmerkungen && (
                  <p className="text-xs text-muted-foreground italic">
                    {selectedAnfrage.fields.anmerkungen}
                  </p>
                )}
              </div>

              {/* Belegungsformular */}
              <div className="rounded-2xl border bg-card p-4 space-y-4">
                <h3 className="font-semibold text-foreground">
                  {tx('Neuen Belegungseintrag anlegen')}
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

                {naechte != null && naechte > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {naechte}{' '}
                    {naechte === 1 ? tx('Nacht') : tx('Nächte')}
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="status">{tx('Status')}</Label>
                  <Select value={statusKey} onValueChange={setStatusKey}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="pt-0.5">
                    <StatusBadge statusKey={statusKey} label={STATUS_OPTIONS.find(o => o.key === statusKey)?.label} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="interne_notiz">
                    {tx('Interne Notiz')}{' '}
                    <span className="text-muted-foreground font-normal text-xs">
                      ({tx('optional')})
                    </span>
                  </Label>
                  <Textarea
                    id="interne_notiz"
                    value={interneNotiz}
                    onChange={e => setInterneNotiz(e.target.value)}
                    placeholder={tx('z. B. Name des Gastes für interne Zwecke')}
                    rows={2}
                  />
                </div>

                {submitError && (
                  <p className="text-sm text-destructive">{submitError}</p>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <Button
                    disabled={!canSubmit}
                    onClick={handleBestaetigen}
                    className="flex-1"
                  >
                    <IconCheck size={16} className="shrink-0" />
                    {tx('Belegung bestätigen')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setStep(1)}
                    disabled={submitting}
                  >
                    <IconX size={16} className="shrink-0" />
                    {tx('Anfrage ablehnen')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </IntentWizardShell>
  );
}
