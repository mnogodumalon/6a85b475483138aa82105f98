/**
 * Anfrage bearbeiten — 3-Schritt-Wizard.
 * Steps: 1) Buchungsanfrage wählen → 2) Belegung prüfen (Konflikte erkennen) → 3) Belegung anlegen.
 * Reads: buchungsanfrage, belegungskalender. Writes: belegungskalender (createBelegungskalenderEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState } from 'react';
import { format, parseISO, isAfter, isBefore } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import type { Buchungsanfrage, Belegungskalender } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { IconCalendar, IconUsers, IconAlertTriangle, IconCircleCheck, IconMail } from '@tabler/icons-react';
import { tx, dateFnsLocale } from '@/i18n';

function formatDay(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'dd.MM.yyyy', { locale: dateFnsLocale() });
  } catch {
    return dateStr;
  }
}

function hasConflict(
  eintrag: Belegungskalender,
  wunschAnreise: string | undefined,
  wunschAbreise: string | undefined,
): boolean {
  if (!wunschAnreise || !wunschAbreise) return false;
  if (eintrag.fields.status?.key !== 'belegt') return false;
  const ea = eintrag.fields.anreisedatum;
  const eb = eintrag.fields.abreisedatum;
  if (!ea || !eb) return false;
  // Overlap: eintrag starts before wunsch ends AND eintrag ends after wunsch starts
  try {
    const wA = parseISO(wunschAnreise);
    const wB = parseISO(wunschAbreise);
    const eA = parseISO(ea);
    const eB = parseISO(eb);
    return isBefore(eA, wB) && isAfter(eB, wA);
  } catch {
    return false;
  }
}

export default function AnfrageBearbeitenPage() {
  const WIZARD_STEPS = [
  { label: tx('Anfrage wählen') },
  { label: tx('Belegung prüfen') },
  { label: tx('Belegung anlegen') },
];

  const data = useDashboardData();
  const { buchungsanfrage, belegungskalender, loading, error, fetchAll } = data;

  const [step, setStep] = useState(1);
  const [selectedAnfrageId, setSelectedAnfrageId] = useState<string | null>(null);

  // Step 3 form state
  const [anreisedatum, setAnreisedatum] = useState('');
  const [abreisedatum, setAbreisedatum] = useState('');
  const [interneNotiz, setInterneNotiz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedAnfrage: Buchungsanfrage | undefined = selectedAnfrageId
    ? buchungsanfrage.find(a => a.record_id === selectedAnfrageId)
    : undefined;

  function handleSelectAnfrage(id: string) {
    const anfrage = buchungsanfrage.find(a => a.record_id === id);
    setSelectedAnfrageId(id);
    if (anfrage) {
      setAnreisedatum(anfrage.fields.wunsch_anreise ?? '');
      setAbreisedatum(anfrage.fields.wunsch_abreise ?? '');
      const vorname = anfrage.fields.vorname ?? '';
      const nachname = anfrage.fields.nachname ?? '';
      const email = anfrage.fields.email ?? '';
      setInterneNotiz(tx`Anfrage: ${vorname} ${nachname}, ${email}`);
    }
    setStep(2);
  }

  async function handleCreateBelegung() {
    if (!anreisedatum || !abreisedatum) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum,
        abreisedatum,
        status: 'belegt',
        interne_notiz: interneNotiz,
      });
      await fetchAll();
      setDone(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tx('Fehler beim Anlegen'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setStep(1);
    setSelectedAnfrageId(null);
    setAnreisedatum('');
    setAbreisedatum('');
    setInterneNotiz('');
    setSubmitError(null);
    setDone(false);
  }

  return (
    <IntentWizardShell
      title={tx('Anfrage bearbeiten')}
      subtitle={tx('Buchungsanfrage prüfen und Belegung eintragen')}
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Anfrage wählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={buchungsanfrage.map(a => ({
            id: a.record_id,
            title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || a.record_id,
            subtitle: a.fields.wunsch_anreise && a.fields.wunsch_abreise
              ? `${formatDay(a.fields.wunsch_anreise)} – ${formatDay(a.fields.wunsch_abreise)}`
              : undefined,
            icon: <IconCalendar size={20} className="text-primary" />,
            stats: [
              ...(a.fields.anzahl_personen != null
                ? [{ label: tx('Personen'), value: String(a.fields.anzahl_personen) }]
                : []),
              ...(a.fields.email
                ? [{ label: tx('E-Mail'), value: a.fields.email }]
                : []),
            ],
          }))}
          onSelect={handleSelectAnfrage}
          searchPlaceholder={tx('Nach Name suchen …')}
          emptyIcon={<IconCalendar size={32} />}
          emptyText={tx('Keine Buchungsanfragen vorhanden')}
        />
      )}

      {/* ── Schritt 2: Belegung prüfen ── */}
      {step === 2 && (
        selectedAnfrage ? (
          <div className="space-y-5">
            {/* Wunschzeitraum-Banner */}
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex gap-3 items-start">
              <IconCalendar size={20} className="text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {tx('Wunschzeitraum der Anfrage')}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {formatDay(selectedAnfrage.fields.wunsch_anreise)} – {formatDay(selectedAnfrage.fields.wunsch_abreise)}
                </p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <IconUsers size={13} className="shrink-0" />
                    {selectedAnfrage.fields.anzahl_personen != null
                      ? `${selectedAnfrage.fields.anzahl_personen} ${tx('Personen')}`
                      : tx('Personenzahl unbekannt')}
                  </span>
                  {selectedAnfrage.fields.email && (
                    <span className="flex items-center gap-1">
                      <IconMail size={13} className="shrink-0" />
                      {selectedAnfrage.fields.email}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Belegungskalender-Einträge */}
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">
                {tx('Bestehende Belegungen')}
              </h2>
              {belegungskalender.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <IconCircleCheck size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{tx('Noch keine Belegungen vorhanden — der Zeitraum ist frei.')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {belegungskalender.map(eintrag => {
                    const konflikt = hasConflict(
                      eintrag,
                      selectedAnfrage.fields.wunsch_anreise,
                      selectedAnfrage.fields.wunsch_abreise,
                    );
                    return (
                      <div
                        key={eintrag.record_id}
                        className={`rounded-xl border p-4 flex items-start gap-3 ${
                          konflikt
                            ? 'border-destructive/40 bg-destructive/5'
                            : 'border-border bg-card'
                        }`}
                      >
                        <div className="shrink-0 mt-0.5">
                          {konflikt ? (
                            <IconAlertTriangle size={18} className="text-destructive" />
                          ) : (
                            <IconCircleCheck size={18} className="text-emerald-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {formatDay(eintrag.fields.anreisedatum)} – {formatDay(eintrag.fields.abreisedatum)}
                            </span>
                            <StatusBadge
                              statusKey={eintrag.fields.status?.key}
                              label={eintrag.fields.status?.label}
                            />
                            {konflikt && (
                              <span className="text-xs font-medium text-destructive">
                                {tx('Konflikt mit Wunschzeitraum')}
                              </span>
                            )}
                          </div>
                          {eintrag.fields.interne_notiz && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {eintrag.fields.interne_notiz}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                {tx('Zurück')}
              </Button>
              <Button onClick={() => setStep(3)}>
                {tx('Weiter: Belegung anlegen')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>{tx('Neu starten')}</Button>
          </div>
        )
      )}

      {/* ── Schritt 3: Belegung anlegen ── */}
      {step === 3 && (
        selectedAnfrage ? (
          done ? (
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <IconCircleCheck size={28} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {tx('Belegung erfolgreich angelegt')}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatDay(anreisedatum)} – {formatDay(abreisedatum)}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Button onClick={handleReset}>
                  {tx('Neue Anfrage bearbeiten')}
                </Button>
                <a href="#/">
                  <Button variant="outline">{tx('Zurück zum Dashboard')}</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Zusammenfassung der Anfrage */}
              <div className="rounded-xl border bg-secondary/40 p-4 text-sm space-y-1">
                <p className="font-medium text-foreground">
                  {selectedAnfrage.fields.vorname} {selectedAnfrage.fields.nachname}
                </p>
                {selectedAnfrage.fields.email && (
                  <p className="text-muted-foreground">{selectedAnfrage.fields.email}</p>
                )}
              </div>

              {/* Formular */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {tx('Anreisedatum')}
                    </label>
                    <Input
                      type="date"
                      value={anreisedatum}
                      onChange={e => setAnreisedatum(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {tx('Abreisedatum')}
                    </label>
                    <Input
                      type="date"
                      value={abreisedatum}
                      onChange={e => setAbreisedatum(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {tx('Interne Notiz')}
                  </label>
                  <Textarea
                    value={interneNotiz}
                    onChange={e => setInterneNotiz(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-xs text-primary font-medium">
                  {tx('Status wird automatisch auf „Belegt" gesetzt.')}
                </div>
              </div>

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                  {tx('Zurück')}
                </Button>
                <Button
                  onClick={handleCreateBelegung}
                  disabled={submitting || !anreisedatum || !abreisedatum}
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
            <Button variant="outline" onClick={() => setStep(1)}>{tx('Neu starten')}</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
