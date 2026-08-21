import { useEffect, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  listPublicRecords,
  createPublicRecord,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import {
  AvailabilityRangePicker,
  rangeIsFree,
  type AvailabilityRange,
  type DateRangeValue,
} from '@/components/blocks/AvailabilityRangePicker';
import { tx } from '@/i18n';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { IconCalendarCheck, IconUser, IconMail, IconPhone, IconCheck, IconAlertCircle, IconLoader2 } from '@tabler/icons-react';

const SLUG = 'ferienwohnung';

interface BelegungEntry {
  anreisedatum: string;
  abreisedatum: string;
  status: string;
}

type Step = 'availability' | 'contact' | 'success';

export default function Ferienwohnung() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [belegungen, setBelegungen] = useState<BelegungEntry[]>([]);
  const [belegungLoading, setBelegungLoading] = useState(true);

  const [step, setStep] = useState<Step>('availability');
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });

  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [email, setEmail] = useState('');
  const [telefon, setTelefon] = useState('');
  const [anzahlPersonen, setAnzahlPersonen] = useState('');
  const [anmerkungen, setAnmerkungen] = useState('');
  const [datenschutz, setDatenschutz] = useState(false);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // All hooks before early returns
  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setConfigLoading(false);
        if (!c?.pages[SLUG]) setUnavailable(true);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setConfigLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'list' && (e.entity === 'belegungskalender'));
    if (!ep) return;
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 500 })
      .then(res => {
        const entries = Object.values(res).map(r => ({
          anreisedatum: (r.fields.anreisedatum as string) ?? '',
          abreisedatum: (r.fields.abreisedatum as string) ?? '',
          status: (r.fields.status as string) ?? '',
        }));
        setBelegungen(entries);
        setBelegungLoading(false);
      })
      .catch(() => setBelegungLoading(false));
  }, [cfg, page]);

  if (configLoading) {
    return <PublicShell loading />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable />;
  }

  const blocked: AvailabilityRange[] = belegungen
    .filter(e => e.status === 'belegt')
    .map(e => ({ start: e.anreisedatum, end: e.abreisedatum }));

  const nights = range.from && range.to
    ? differenceInCalendarDays(parseISO(range.to), parseISO(range.from))
    : 0;

  const formatDisplayDate = (iso: string | null) => {
    if (!iso) return '—';
    return format(parseISO(iso), 'dd.MM.yyyy');
  };

  const handleAvailabilityNext = () => {
    if (!range.from || !range.to) return;
    if (nights < 3) return;
    if (!rangeIsFree(range.from, range.to, blocked)) return;
    const ep = page.endpoints?.find(e => e.op === 'create');
    if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
    setStep('contact');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!range.from || !range.to) return;
    if (!datenschutz) return;
    if (!rangeIsFree(range.from, range.to, blocked)) {
      setSubmitError(tx('Der gewählte Zeitraum ist leider nicht mehr verfügbar. Bitte wähle einen anderen.'));
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);

    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: range.from,
        wunsch_abreise: range.to,
        anzahl_personen: Number(anzahlPersonen),
        vorname,
        nachname,
        email,
        ...(telefon ? { telefon } : {}),
        ...(anmerkungen ? { anmerkungen } : {}),
        datenschutz: true,
      });
      setStep('success');
    } catch {
      setSubmitError(tx('Leider ist ein Fehler aufgetreten. Bitte versuche es erneut.'));
    } finally {
      setSubmitLoading(false);
    }
  };

  // Step: Success confirmation
  if (step === 'success') {
    return (
      <PublicShell title={page.title} description={page.description}>
        <div className="flex flex-col items-center text-center space-y-4 py-6">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <IconCheck size={36} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold">{tx('Anfrage erfolgreich eingegangen!')}</h2>
          <p className="text-muted-foreground max-w-sm">
            {tx('Vielen Dank für deine Buchungsanfrage. Wir melden uns innerhalb von 24 Stunden bei dir.')}
          </p>
          <div className="rounded-lg border bg-muted/40 px-6 py-4 text-sm text-left space-y-1 w-full max-w-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{tx('Anreise')}</span>
              <span className="font-medium">{formatDisplayDate(range.from)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{tx('Abreise')}</span>
              <span className="font-medium">{formatDisplayDate(range.to)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{tx('Nächte')}</span>
              <span className="font-medium">{nights}</span>
            </div>
          </div>
        </div>
      </PublicShell>
    );
  }

  // Step: Contact form
  if (step === 'contact') {
    return (
      <PublicShell title={page.title} description={page.description}>
        <div className="space-y-5">
          {/* Date summary bar */}
          <div className="rounded-lg border bg-muted/40 px-4 py-3 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <IconCalendarCheck size={16} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{tx('Anreise')}:</span>
              <span className="font-medium">{formatDisplayDate(range.from)}</span>
            </div>
            <div className="flex items-center gap-2">
              <IconCalendarCheck size={16} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{tx('Abreise')}:</span>
              <span className="font-medium">{formatDisplayDate(range.to)}</span>
            </div>
            <span className="text-muted-foreground">
              {tx`${nights} Nächte`}
            </span>
            <button
              type="button"
              className="ml-auto text-sm text-primary underline underline-offset-2 hover:text-primary/80"
              onClick={() => setStep('availability')}
            >
              {tx('Ändern')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="vorname">
                  {tx('Vorname')} <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <IconUser size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
                  <input
                    id="vorname"
                    type="text"
                    required
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder={tx('Max')}
                    className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="nachname">
                  {tx('Nachname')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="nachname"
                  type="text"
                  required
                  value={nachname}
                  onChange={e => setNachname(e.target.value)}
                  placeholder={tx('Mustermann')}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="email">
                {tx('E-Mail-Adresse')} <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <IconMail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={tx('max@beispiel.de')}
                  className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="telefon">
                  {tx('Telefonnummer')} <span className="text-muted-foreground text-xs">({tx('optional')})</span>
                </label>
                <div className="relative">
                  <IconPhone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
                  <input
                    id="telefon"
                    type="tel"
                    value={telefon}
                    onChange={e => setTelefon(e.target.value)}
                    placeholder={tx('+49 171 1234567')}
                    className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="anzahl_personen">
                  {tx('Anzahl der Personen')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="anzahl_personen"
                  type="number"
                  required
                  min="1"
                  max="20"
                  value={anzahlPersonen}
                  onChange={e => setAnzahlPersonen(e.target.value)}
                  placeholder="2"
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="anmerkungen">
                {tx('Anmerkungen und Wünsche')} <span className="text-muted-foreground text-xs">({tx('optional')})</span>
              </label>
              <textarea
                id="anmerkungen"
                rows={3}
                value={anmerkungen}
                onChange={e => setAnmerkungen(e.target.value)}
                placeholder={tx('Haustier, Kinderbett, Anreisezeit ...')}
                className="w-full px-3 py-2 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input
                id="datenschutz"
                type="checkbox"
                required
                checked={datenschutz}
                onChange={e => setDatenschutz(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-primary"
              />
              <label htmlFor="datenschutz" className="text-sm text-muted-foreground leading-snug cursor-pointer">
                {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
                <span className="text-destructive ml-1">*</span>
              </label>
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep('availability')}
                className="flex-1 px-4 py-2.5 rounded-md border text-sm font-medium hover:bg-accent transition-colors"
              >
                {tx('Zurück')}
              </button>
              <button
                type="submit"
                disabled={submitLoading || !datenschutz}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 disabled:pointer-events-none transition-colors"
              >
                {submitLoading && <IconLoader2 size={16} className="animate-spin shrink-0" />}
                {tx('Anfrage absenden')}
              </button>
            </div>
          </form>
        </div>
      </PublicShell>
    );
  }

  // Step: Availability picker (default)
  const canProceed = Boolean(
    range.from && range.to && nights >= 3 && rangeIsFree(range.from, range.to, blocked)
  );

  return (
    <PublicShell
      title={page.title}
      description={page.description ?? tx('Prüfe freie Zeiträume und stelle deine Buchungsanfrage — alles in einem Schritt.')}
      wide
    >
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-medium text-xs">1</span>
          <span className="font-medium text-foreground">{tx('Verfügbarkeit prüfen')}</span>
          <span className="mx-1 text-muted-foreground/50">→</span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full border text-muted-foreground font-medium text-xs">2</span>
          <span>{tx('Persönliche Daten')}</span>
        </div>

        {/* Availability section */}
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {tx('Belegte Zeiträume sind durchgestrichen. Wähle deinen gewünschten Anreise- und Abreisetermin. Mindestaufenthalt: 3 Nächte.')}
          </p>

          {belegungLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <IconLoader2 size={20} className="animate-spin shrink-0" />
              <span className="text-sm">{tx('Verfügbarkeit wird geladen …')}</span>
            </div>
          ) : (
            <AvailabilityRangePicker
              blocked={blocked}
              value={range}
              onChange={setRange}
              minNights={3}
              months={2}
            />
          )}
        </div>

        {/* Night summary & CTA */}
        <div className="space-y-3">
          {range.from && range.to && (
            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm flex flex-wrap gap-3 items-center">
              <span>
                <span className="text-muted-foreground">{tx('Anreise')}:</span>{' '}
                <strong>{formatDisplayDate(range.from)}</strong>
              </span>
              <span>
                <span className="text-muted-foreground">{tx('Abreise')}:</span>{' '}
                <strong>{formatDisplayDate(range.to)}</strong>
              </span>
              {nights > 0 && (
                <span className="text-muted-foreground">
                  {tx`${nights} Nächte`}
                </span>
              )}
              {nights > 0 && nights < 3 && (
                <span className="text-destructive text-xs font-medium">
                  {tx('Mindestaufenthalt: 3 Nächte')}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!canProceed}
            onClick={handleAvailabilityNext}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            <IconCalendarCheck size={18} className="shrink-0" />
            {tx('Weiter zur Buchungsanfrage')}
          </button>

          {!range.from && (
            <p className="text-center text-xs text-muted-foreground">
              {tx('Wähle zuerst ein Anreisedatum im Kalender')}
            </p>
          )}
          {range.from && !range.to && (
            <p className="text-center text-xs text-muted-foreground">
              {tx('Jetzt Abreisedatum wählen')}
            </p>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
