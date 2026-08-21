import { useEffect, useRef, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  listPublicRecords,
  createPublicRecord,
  prepareChallenge,
  PageUnavailableError,
  RateLimitedError,
  FieldValidationError,
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
import { format } from 'date-fns';
import { IconCalendar, IconSend, IconWaveSine, IconBuildingCottage } from '@tabler/icons-react';

interface BelegungRecord {
  anreisedatum: string;
  abreisedatum: string;
  status: string;
}

const SLUG = 'ferienwohnung';

export default function Ferienwohnung() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [belegungen, setBelegungen] = useState<BelegungRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });

  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [email, setEmail] = useState('');
  const [telefon, setTelefon] = useState('');
  const [anzahlPersonen, setAnzahlPersonen] = useState('');
  const [anmerkungen, setAnmerkungen] = useState('');
  const [datenschutz, setDatenschutz] = useState(false);

  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'list');
    if (!ep) return;
    setDataLoading(true);
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 500 })
      .then(result => {
        const records = Object.values(result).map(r => ({
          anreisedatum: (r.fields.anreisedatum as string) ?? '',
          abreisedatum: (r.fields.abreisedatum as string) ?? '',
          status: (r.fields.status as string) ?? '',
        })).filter(r => r.anreisedatum && r.abreisedatum);
        setBelegungen(records);
      })
      .catch(() => {
        // Falls die Liste nicht geladen werden kann, zeige leeren Kalender
      })
      .finally(() => setDataLoading(false));
  }, [cfg, page]);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) return <PublicShell loading />;
  if (!cfg || !page) return <PublicShell unavailable />;

  const blocked: AvailabilityRange[] = belegungen
    .filter(b => b.status === 'belegt')
    .map(b => ({ start: b.anreisedatum, end: b.abreisedatum }));

  const createEp = page.endpoints?.find(e => e.op === 'create');
  const createAppId = createEp?.app_id ?? page.app_id;
  const createPath = `/apps/${createAppId}/records`;

  const handleFocus = () => {
    prepareChallenge(cfg, page, 'POST', createPath);
  };

  const handleRangeChange = (newRange: DateRangeValue) => {
    setRange(newRange);
    setRangeError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mindestaufenthalt validieren
    if (!range.from || !range.to) {
      setRangeError(tx('Bitte wähle Anreise- und Abreisedatum im Kalender aus.'));
      return;
    }
    const nights = Math.round(
      (new Date(range.to).getTime() - new Date(range.from).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (nights < 3) {
      setRangeError(tx('Der Mindestaufenthalt beträgt 3 Nächte. Bitte wähle ein späteres Abreisedatum.'));
      return;
    }
    if (!rangeIsFree(range.from, range.to, blocked)) {
      setRangeError(tx('Der gewählte Zeitraum ist leider nicht mehr verfügbar. Bitte wähle andere Daten.'));
      return;
    }

    setRangeError(null);
    setSubmitState('submitting');
    setErrorMsg(null);

    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: range.from,
        wunsch_abreise: range.to,
        anzahl_personen: Number(anzahlPersonen),
        vorname: vorname.trim(),
        nachname: nachname.trim(),
        email: email.trim(),
        telefon: telefon.trim() || undefined,
        anmerkungen: anmerkungen.trim() || undefined,
        datenschutz,
      });
      setSubmitState('success');
    } catch (err) {
      setSubmitState('error');
      if (err instanceof RateLimitedError) {
        setErrorMsg(tx('Zu viele Anfragen. Bitte versuche es in einigen Minuten erneut.'));
      } else if (err instanceof FieldValidationError) {
        setErrorMsg(tx('Einige Felder konnten nicht übermittelt werden. Bitte überprüfe deine Angaben.'));
      } else if (err instanceof PageUnavailableError) {
        setErrorMsg(tx('Diese Seite ist vorübergehend nicht verfügbar.'));
      } else {
        setErrorMsg(tx('Ein Fehler ist aufgetreten. Bitte versuche es erneut.'));
      }
    }
  };

  if (submitState === 'success') {
    return (
      <PublicShell title={tx('Anfrage gesendet!')} description={tx('Vielen Dank für deine Buchungsanfrage.')}>
        <div className="text-center space-y-4 py-6">
          <div className="flex justify-center">
            <span className="text-5xl" aria-hidden="true">🌊</span>
          </div>
          <p className="text-muted-foreground">
            {tx('Wir melden uns so schnell wie möglich bei dir. Schau auch in deinen Spam-Ordner, falls du nichts von uns hörst.')}
          </p>
          {range.from && range.to && (
            <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-center">
              <p className="font-medium">{tx('Deine Wunschdaten')}</p>
              <p className="text-muted-foreground">
                {format(new Date(range.from), 'dd.MM.yyyy')} – {format(new Date(range.to), 'dd.MM.yyyy')}
              </p>
            </div>
          )}
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell fullBleed>
      {/* Hero */}
      <div className="bg-gradient-to-b from-sky-50 to-white dark:from-sky-950/30 dark:to-background border-b">
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16 text-center space-y-4">
          <div className="flex justify-center mb-2">
            <IconBuildingCottage size={44} className="text-sky-500" stroke={1.5} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {tx('Ferienwohnung an der Ostsee')}
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            {tx('Prüfe die Verfügbarkeit und stelle direkt eine Buchungsanfrage — wir melden uns schnell bei dir.')}
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <IconWaveSine size={16} className="shrink-0" />
            <span>{tx('Mindestaufenthalt 3 Nächte')}</span>
          </div>
          <button
            type="button"
            onClick={scrollToForm}
            className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-sm"
          >
            <IconCalendar size={16} className="shrink-0" />
            {tx('Jetzt anfragen')}
          </button>
        </div>
      </div>

      {/* Verfügbarkeitskalender */}
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="space-y-2 mb-6">
          <h2 className="text-xl font-semibold">{tx('Verfügbarkeit')}</h2>
          <p className="text-sm text-muted-foreground">
            {tx('Wähle dein Wunsch-Anreisedatum, dann das Abreisedatum. Belegte Zeiträume sind durchgestrichen.')}
          </p>
        </div>
        {dataLoading ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            {tx('Kalender wird geladen …')}
          </div>
        ) : (
          <AvailabilityRangePicker
            blocked={blocked}
            value={range}
            onChange={handleRangeChange}
            minNights={3}
            months={2}
          />
        )}
        {rangeError && (
          <p className="mt-3 text-sm text-destructive" role="alert">{rangeError}</p>
        )}
        {range.from && range.to && !rangeError && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg px-4 py-2.5 text-sm">
              <span className="font-medium">{format(new Date(range.from), 'dd.MM.yyyy')}</span>
              <span className="text-muted-foreground mx-2">→</span>
              <span className="font-medium">{format(new Date(range.to), 'dd.MM.yyyy')}</span>
              <span className="text-muted-foreground ml-2">
                ({Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (1000 * 60 * 60 * 24))} {tx('Nächte')})
              </span>
            </div>
            <button
              type="button"
              onClick={scrollToForm}
              className="shrink-0 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {tx('Weiter zur Anfrage')}
            </button>
          </div>
        )}
      </div>

      {/* Trennlinie */}
      <div className="border-t max-w-3xl mx-auto" />

      {/* Buchungsanfrage-Formular */}
      <div className="max-w-3xl mx-auto px-4 py-10" ref={formRef}>
        <div className="space-y-2 mb-6">
          <h2 className="text-xl font-semibold">{tx('Buchungsanfrage stellen')}</h2>
          <p className="text-sm text-muted-foreground">
            {tx('Fülle das Formular aus — wir bestätigen die Verfügbarkeit und melden uns innerhalb von 24 Stunden.')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" onFocus={handleFocus}>
          {/* Reisedaten-Zusammenfassung */}
          {range.from && range.to ? (
            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg px-4 py-3 text-sm space-y-1">
              <p className="font-medium text-sky-800 dark:text-sky-200">{tx('Gewählte Reisedaten')}</p>
              <p className="text-sky-700 dark:text-sky-300">
                {tx('Anreise:')} <b>{format(new Date(range.from), 'dd.MM.yyyy')}</b>
                {'  ·  '}
                {tx('Abreise:')} <b>{format(new Date(range.to), 'dd.MM.yyyy')}</b>
                {'  ·  '}
                {Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (1000 * 60 * 60 * 24))} {tx('Nächte')}
              </p>
            </div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              {tx('Bitte wähle zuerst deinen Reisezeitraum im Kalender oben aus.')}
            </div>
          )}

          {/* Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="vorname" className="block text-sm font-medium">
                {tx('Vorname')} <span className="text-destructive">*</span>
              </label>
              <input
                id="vorname"
                type="text"
                required
                value={vorname}
                onChange={e => setVorname(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                placeholder={tx('z. B. Maria')}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="nachname" className="block text-sm font-medium">
                {tx('Nachname')} <span className="text-destructive">*</span>
              </label>
              <input
                id="nachname"
                type="text"
                required
                value={nachname}
                onChange={e => setNachname(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                placeholder={tx('z. B. Müller')}
              />
            </div>
          </div>

          {/* Kontakt */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium">
                {tx('E-Mail-Adresse')} <span className="text-destructive">*</span>
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                placeholder={tx('beispiel@email.de')}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="telefon" className="block text-sm font-medium">
                {tx('Telefonnummer')}
              </label>
              <input
                id="telefon"
                type="tel"
                value={telefon}
                onChange={e => setTelefon(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                placeholder={tx('z. B. +49 151 12345678')}
              />
            </div>
          </div>

          {/* Personen */}
          <div className="space-y-1.5 max-w-xs">
            <label htmlFor="anzahl_personen" className="block text-sm font-medium">
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
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
              placeholder="2"
            />
          </div>

          {/* Anmerkungen */}
          <div className="space-y-1.5">
            <label htmlFor="anmerkungen" className="block text-sm font-medium">
              {tx('Anmerkungen und Wünsche')}
            </label>
            <textarea
              id="anmerkungen"
              rows={3}
              value={anmerkungen}
              onChange={e => setAnmerkungen(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors resize-none"
              placeholder={tx('z. B. Haustier, Kinderbett, besondere Wünsche …')}
            />
          </div>

          {/* Datenschutz */}
          <div className="flex items-start gap-3">
            <input
              id="datenschutz"
              type="checkbox"
              required
              checked={datenschutz}
              onChange={e => setDatenschutz(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-primary"
            />
            <label htmlFor="datenschutz" className="text-sm text-muted-foreground leading-snug">
              {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
              {' '}<span className="text-destructive">*</span>
            </label>
          </div>

          {/* Fehler */}
          {submitState === 'error' && errorMsg && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2" role="alert">
              {errorMsg}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitState === 'submitting'}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 disabled:pointer-events-none transition-colors"
          >
            <IconSend size={16} className="shrink-0" />
            {submitState === 'submitting' ? tx('Anfrage wird gesendet …') : tx('Anfrage absenden')}
          </button>

          <p className="text-xs text-muted-foreground">
            {tx('Mit * markierte Felder sind Pflichtfelder.')}
          </p>
        </form>
      </div>

      {/* Footer-Abstand */}
      <div className="h-8" />
    </PublicShell>
  );
}
