import { useEffect, useState } from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { IconCalendar, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig, listPublicRecords, createPublicRecord,
  prepareChallenge, PageUnavailableError,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';
import { tx } from '@/i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BelegungEntry {
  id: string;
  anreisedatum: string;
  abreisedatum: string;
  status: string; // 'belegt' | 'frei'
}

type Step = 'kalender' | 'formular' | 'erfolg';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDE(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd.MM.yyyy');
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Ferienwohnung() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  // Belegungskalender
  const [eintraege, setEintraege] = useState<BelegungEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // Stepper
  const [step, setStep] = useState<Step>('kalender');

  // Formular state
  const [wunschAnreise, setWunschAnreise] = useState('');
  const [wunschAbreise, setWunschAbreise] = useState('');
  const [anzahlPersonen, setAnzahlPersonen] = useState('');
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [email, setEmail] = useState('');
  const [telefon, setTelefon] = useState('');
  const [anmerkungen, setAnmerkungen] = useState('');
  const [datenschutz, setDatenschutz] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Load config
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadPublicPagesConfig('ferienwohnung').then(c => {
      if (!c) { setUnavailable(true); setLoading(false); return; }
      setCfg(c);
      const p = c.pages['ferienwohnung'] ?? null;
      setPage(p);
      if (!p) { setUnavailable(true); }
      setLoading(false);
    }).catch(err => {
      if (err instanceof PageUnavailableError) setUnavailable(true);
      else setUnavailable(true);
      setLoading(false);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Load Belegungskalender
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.entity === 'belegungskalender' && e.op === 'list');
    if (!ep) return;
    setListLoading(true);
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 200 }).then(result => {
      const entries: BelegungEntry[] = Object.values(result).map((r: unknown) => {
        const rec = r as { id: string; fields: Record<string, unknown> };
        return {
          id: rec.id,
          anreisedatum: (rec.fields.anreisedatum as string) ?? '',
          abreisedatum: (rec.fields.abreisedatum as string) ?? '',
          status: (rec.fields.status as string) ?? '',
        };
      }).filter(e => e.anreisedatum && e.abreisedatum);
      // Sort by Anreisedatum ascending
      entries.sort((a, b) => a.anreisedatum.localeCompare(b.anreisedatum));
      setEintraege(entries);
      setListLoading(false);
    }).catch(() => setListLoading(false));
  }, [cfg, page]);

  // ---------------------------------------------------------------------------
  // Prepare challenge on first form interaction
  // ---------------------------------------------------------------------------

  function handleFormFocus() {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.entity === 'buchungsanfrage' && e.op === 'create');
    if (!ep) return;
    prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validate(): string {
    if (!wunschAnreise) return tx('Bitte Anreisedatum angeben.');
    if (!wunschAbreise) return tx('Bitte Abreisedatum angeben.');
    const nights = differenceInCalendarDays(parseISO(wunschAbreise), parseISO(wunschAnreise));
    if (nights < 3) return tx('Der Mindestaufenthalt beträgt 3 Nächte.');
    if (!anzahlPersonen || Number(anzahlPersonen) < 1) return tx('Bitte Anzahl der Personen angeben.');
    if (!vorname.trim()) return tx('Bitte Vorname angeben.');
    if (!nachname.trim()) return tx('Bitte Nachname angeben.');
    if (!email.trim()) return tx('Bitte E-Mail-Adresse angeben.');
    if (!datenschutz) return tx('Bitte Datenschutzhinweise bestätigen.');
    return '';
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    const err = validate();
    if (err) { setValidationError(err); return; }
    setValidationError('');
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e2 => e2.entity === 'buchungsanfrage' && e2.op === 'create');
    if (!ep) return;
    setSubmitting(true);
    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: wunschAnreise,
        wunsch_abreise: wunschAbreise,
        anzahl_personen: Number(anzahlPersonen),
        vorname: vorname.trim(),
        nachname: nachname.trim(),
        email: email.trim(),
        telefon: telefon.trim() || undefined,
        anmerkungen: anmerkungen.trim() || undefined,
        datenschutz,
      });
      setStep('erfolg');
    } catch {
      setSubmitError(tx('Beim Absenden ist ein Fehler aufgetreten. Bitte versuche es erneut.'));
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading || (!loading && !cfg)) {
    return <PublicShell loading={loading} unavailable={unavailable} />;
  }
  if (unavailable || !page) {
    return <PublicShell unavailable />;
  }

  // Step: Erfolg
  if (step === 'erfolg') {
    return (
      <PublicShell title={tx('Ostsee Ferienwohnung')} wide>
        <div className="rounded-2xl bg-card border border-border shadow-sm p-8 text-center">
          <div className="flex justify-center mb-4">
            <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 p-4">
              <IconCheck size={32} className="text-emerald-600" stroke={2} />
            </span>
          </div>
          <h2 className="text-xl font-semibold mb-2">{tx('Anfrage eingegangen!')}</h2>
          <p className="text-muted-foreground">
            {tx('Vielen Dank für deine Buchungsanfrage. Wir melden uns so schnell wie möglich bei dir.')}
          </p>
        </div>
      </PublicShell>
    );
  }

  // Step: Formular
  if (step === 'formular') {
    return (
      <PublicShell title={tx('Buchungsanfrage stellen')} description={tx('Füll das Formular aus — wir melden uns schnellstmöglich.')} wide>
        <form onSubmit={handleSubmit} onFocus={handleFormFocus} noValidate className="space-y-5">

          {/* Reisezeitraum */}
          <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-4">
            <h2 className="text-base font-semibold">{tx('Gewünschter Reisezeitraum')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="wunsch_anreise">
                  {tx('Anreisedatum')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="wunsch_anreise"
                  type="date"
                  required
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={wunschAnreise}
                  onChange={e => { setWunschAnreise(e.target.value); setValidationError(''); }}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="wunsch_abreise">
                  {tx('Abreisedatum')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="wunsch_abreise"
                  type="date"
                  required
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={wunschAbreise}
                  onChange={e => { setWunschAbreise(e.target.value); setValidationError(''); }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{tx('Mindestaufenthalt: 3 Nächte')}</p>
          </div>

          {/* Personen */}
          <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-4">
            <h2 className="text-base font-semibold">{tx('Reisende')}</h2>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="anzahl_personen">
                {tx('Anzahl der Personen')} <span className="text-destructive">*</span>
              </label>
              <input
                id="anzahl_personen"
                type="number"
                min={1}
                required
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={anzahlPersonen}
                onChange={e => { setAnzahlPersonen(e.target.value); setValidationError(''); }}
              />
            </div>
          </div>

          {/* Kontakt */}
          <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-4">
            <h2 className="text-base font-semibold">{tx('Kontaktdaten')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="vorname">
                  {tx('Vorname')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="vorname"
                  type="text"
                  required
                  autoComplete="given-name"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={vorname}
                  onChange={e => { setVorname(e.target.value); setValidationError(''); }}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="nachname">
                  {tx('Nachname')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="nachname"
                  type="text"
                  required
                  autoComplete="family-name"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={nachname}
                  onChange={e => { setNachname(e.target.value); setValidationError(''); }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="email">
                {tx('E-Mail-Adresse')} <span className="text-destructive">*</span>
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={email}
                onChange={e => { setEmail(e.target.value); setValidationError(''); }}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="telefon">
                {tx('Telefonnummer')}
              </label>
              <input
                id="telefon"
                type="tel"
                autoComplete="tel"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={telefon}
                onChange={e => setTelefon(e.target.value)}
              />
            </div>
          </div>

          {/* Anmerkungen */}
          <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-4">
            <h2 className="text-base font-semibold">{tx('Anmerkungen und Wünsche')}</h2>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="anmerkungen">
                {tx('Anmerkungen')}
              </label>
              <textarea
                id="anmerkungen"
                rows={4}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                value={anmerkungen}
                onChange={e => setAnmerkungen(e.target.value)}
              />
            </div>
          </div>

          {/* Datenschutz */}
          <div className="rounded-2xl bg-card border border-border shadow-sm p-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                id="datenschutz"
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                checked={datenschutz}
                onChange={e => { setDatenschutz(e.target.checked); setValidationError(''); }}
              />
              <span className="text-sm text-muted-foreground">
                {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
                {' '}<span className="text-destructive">*</span>
              </span>
            </label>
          </div>

          {/* Validierungsfehler */}
          {validationError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <IconAlertCircle size={16} className="shrink-0" />
              {validationError}
            </div>
          )}

          {/* Serverfehler */}
          {submitError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <IconAlertCircle size={16} className="shrink-0" />
              {submitError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setStep('kalender')}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              {tx('Zurück zur Kalenderübersicht')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? tx('Wird gesendet …') : tx('Anfrage absenden')}
            </button>
          </div>
        </form>
      </PublicShell>
    );
  }

  // Step: Kalender (default)
  const today = format(new Date(), 'yyyy-MM-dd');
  const kommende = eintraege.filter(e => e.abreisedatum >= today);
  const freieZeitraeume = kommende.filter(e => e.status === 'frei');

  return (
    <PublicShell
      title={tx('Ostsee Ferienwohnung')}
      description={tx('Hier siehst du unsere Verfügbarkeit. Freie Zeiträume kannst du direkt anfragen.')}
      wide
    >
      <div className="space-y-6">

        {/* Verfügbarkeit */}
        <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <IconCalendar size={18} className="text-muted-foreground shrink-0" />
            <h2 className="text-base font-semibold">{tx('Belegungsübersicht')}</h2>
          </div>

          {listLoading ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">{tx('Wird geladen …')}</div>
          ) : kommende.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">{tx('Keine bevorstehenden Einträge vorhanden.')}</div>
          ) : (
            <div className="divide-y divide-border">
              {/* Tabellenkopf — sichtbar ab sm */}
              <div className="hidden sm:grid grid-cols-3 gap-4 px-5 py-2.5 bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <span>{tx('Anreise')}</span>
                <span>{tx('Abreise')}</span>
                <span>{tx('Status')}</span>
              </div>

              {kommende.map(entry => {
                const isFrei = entry.status === 'frei';
                return (
                  <div key={entry.id} className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-3.5 items-center">
                    {/* Mobile: label + Wert gestapelt */}
                    <div className="sm:contents">
                      <div>
                        <span className="block text-xs text-muted-foreground sm:hidden">{tx('Anreise')}</span>
                        <span className="text-sm font-medium">{formatDE(entry.anreisedatum)}</span>
                      </div>
                      <div>
                        <span className="block text-xs text-muted-foreground sm:hidden">{tx('Abreise')}</span>
                        <span className="text-sm">{formatDE(entry.abreisedatum)}</span>
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex items-center">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        isFrei
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {isFrei ? tx('Frei') : tx('Belegt')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-3">
          <h2 className="text-base font-semibold">{tx('Buchungsanfrage stellen')}</h2>
          {freieZeitraeume.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {tx('Es gibt freie Zeiträume — stelle jetzt deine Anfrage und wir melden uns bei dir.')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tx('Du möchtest einen bestimmten Zeitraum anfragen? Schreib uns — wir schauen was möglich ist.')}
            </p>
          )}
          <button
            type="button"
            onClick={() => setStep('formular')}
            className="w-full sm:w-auto rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {tx('Jetzt anfragen')}
          </button>
        </div>

      </div>
    </PublicShell>
  );
}
