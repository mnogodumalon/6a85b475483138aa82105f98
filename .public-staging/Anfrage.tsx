import { useEffect, useState } from 'react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  createPublicRecord,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { tx } from '@/i18n';
import { IconCalendar, IconUsers, IconUser, IconMail, IconPhone, IconMessageCircle, IconCheck, IconArrowLeft } from '@tabler/icons-react';

const SLUG = 'anfrage';
const MIN_NIGHTS = 3;

interface FormState {
  wunsch_anreise: string;
  wunsch_abreise: string;
  anzahl_personen: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  anmerkungen: string;
  datenschutz: boolean;
}

const EMPTY_FORM: FormState = {
  wunsch_anreise: '',
  wunsch_abreise: '',
  anzahl_personen: '',
  vorname: '',
  nachname: '',
  email: '',
  telefon: '',
  anmerkungen: '',
  datenschutz: false,
};

function nightsCount(anreise: string, abreise: string): number | null {
  if (!anreise || !abreise) return null;
  try {
    return differenceInDays(parseISO(abreise), parseISO(anreise));
  } catch {
    return null;
  }
}

export default function Anfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'nights', string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setLoading(false);
        if (!c?.pages[SLUG]) setUnavailable(true);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) {
          setUnavailable(true);
        }
        setLoading(false);
      });
  }, []);

  // ALL hooks before early returns
  const nights = nightsCount(form.wunsch_anreise, form.wunsch_abreise);

  function handleFirstInteraction() {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'create');
    if (!ep) return;
    prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
    if (key === 'wunsch_anreise' || key === 'wunsch_abreise') {
      setErrors(prev => ({ ...prev, nights: undefined }));
    }
  }

  function validate(): boolean {
    const next: typeof errors = {};

    if (!form.wunsch_anreise) next.wunsch_anreise = tx('Pflichtfeld');
    if (!form.wunsch_abreise) next.wunsch_abreise = tx('Pflichtfeld');
    if (form.wunsch_anreise && form.wunsch_abreise) {
      const n = nightsCount(form.wunsch_anreise, form.wunsch_abreise);
      if (n === null || n < MIN_NIGHTS) {
        next.nights = tx('Mindestaufenthalt: 3 Nächte');
      }
    }
    if (!form.anzahl_personen || Number(form.anzahl_personen) < 1) {
      next.anzahl_personen = tx('Bitte Personenzahl angeben');
    }
    if (!form.vorname.trim()) next.vorname = tx('Pflichtfeld');
    if (!form.nachname.trim()) next.nachname = tx('Pflichtfeld');
    if (!form.email.trim()) next.email = tx('Pflichtfeld');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = tx('Ungültige E-Mail-Adresse');
    if (!form.datenschutz) next.datenschutz = tx('Bitte Datenschutz zustimmen');

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg || !page) return;
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload: Record<string, unknown> = {
        wunsch_anreise: form.wunsch_anreise,
        wunsch_abreise: form.wunsch_abreise,
        anzahl_personen: Number(form.anzahl_personen),
        vorname: form.vorname.trim(),
        nachname: form.nachname.trim(),
        email: form.email.trim(),
        datenschutz: true,
      };
      if (form.telefon.trim()) payload.telefon = form.telefon.trim();
      if (form.anmerkungen.trim()) payload.anmerkungen = form.anmerkungen.trim();

      await createPublicRecord(cfg, page, payload);
      setSubmitted(true);
    } catch {
      setSubmitError(tx('Ein Fehler ist aufgetreten. Bitte versuche es erneut.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || unavailable) {
    return <PublicShell loading={loading} unavailable={unavailable} />;
  }

  if (!cfg || !page) {
    return <PublicShell unavailable />;
  }

  if (submitted) {
    return (
      <PublicShell title={tx('Anfrage gesendet')} description={tx('Deine Buchungsanfrage ist bei uns eingegangen.')}>
        <div className="flex flex-col items-center gap-6 py-8 text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100">
            <IconCheck size={32} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">{tx('Vielen Dank für deine Anfrage!')}</h2>
            <p className="text-muted-foreground max-w-sm">
              {tx('Wir haben deine Buchungsanfrage erhalten und melden uns so schnell wie möglich bei dir.')}
            </p>
          </div>
          {form.wunsch_anreise && form.wunsch_abreise && (
            <div className="rounded-lg border bg-card px-6 py-4 text-sm space-y-1 w-full max-w-xs">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{tx('Anreise')}</span>
                <span className="font-medium">{format(parseISO(form.wunsch_anreise), 'dd.MM.yyyy')}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{tx('Abreise')}</span>
                <span className="font-medium">{format(parseISO(form.wunsch_abreise), 'dd.MM.yyyy')}</span>
              </div>
              {nights !== null && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{tx('Nächte')}</span>
                  <span className="font-medium">{nights}</span>
                </div>
              )}
            </div>
          )}
          <a
            href="/#/public/verfuegbarkeit"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <IconArrowLeft size={16} className="shrink-0" />
            {tx('Zurück zur Verfügbarkeitsübersicht')}
          </a>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell
      title={tx('Buchungsanfrage')}
      description={tx('Sende uns deine Wunschdaten – wir melden uns so schnell wie möglich.')}
    >
      <form
        onSubmit={handleSubmit}
        onFocus={handleFirstInteraction}
        noValidate
        className="flex flex-col gap-6"
      >
        {/* Reisedaten */}
        <section className="rounded-lg border bg-card p-4 flex flex-col gap-4">
          <h2 className="font-semibold flex items-center gap-2 text-base">
            <IconCalendar size={18} className="shrink-0 text-muted-foreground" />
            {tx('Reisedaten')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="wunsch_anreise" className="text-sm font-medium">
                {tx('Anreisedatum')} <span className="text-destructive">*</span>
              </label>
              <input
                id="wunsch_anreise"
                type="date"
                value={form.wunsch_anreise}
                min={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setField('wunsch_anreise', e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.wunsch_anreise ? 'border-destructive' : 'border-input'}`}
              />
              {errors.wunsch_anreise && (
                <p className="text-xs text-destructive">{errors.wunsch_anreise}</p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="wunsch_abreise" className="text-sm font-medium">
                {tx('Abreisedatum')} <span className="text-destructive">*</span>
              </label>
              <input
                id="wunsch_abreise"
                type="date"
                value={form.wunsch_abreise}
                min={form.wunsch_anreise || format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setField('wunsch_abreise', e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.wunsch_abreise || errors.nights ? 'border-destructive' : 'border-input'}`}
              />
              {errors.wunsch_abreise && (
                <p className="text-xs text-destructive">{errors.wunsch_abreise}</p>
              )}
              {errors.nights && (
                <p className="text-xs text-destructive">{errors.nights}</p>
              )}
            </div>
          </div>

          {nights !== null && nights >= MIN_NIGHTS && (
            <p className="text-sm text-emerald-600 font-medium">
              {tx('Aufenthalt')}{': '}{nights} {tx('Nächte')}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="anzahl_personen" className="text-sm font-medium flex items-center gap-2">
              <IconUsers size={16} className="shrink-0 text-muted-foreground" />
              {tx('Anzahl der Personen')} <span className="text-destructive">*</span>
            </label>
            <input
              id="anzahl_personen"
              type="number"
              min={1}
              max={20}
              value={form.anzahl_personen}
              onChange={e => setField('anzahl_personen', e.target.value)}
              placeholder="2"
              className={`w-full sm:w-32 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.anzahl_personen ? 'border-destructive' : 'border-input'}`}
            />
            {errors.anzahl_personen && (
              <p className="text-xs text-destructive">{errors.anzahl_personen}</p>
            )}
          </div>
        </section>

        {/* Persönliche Daten */}
        <section className="rounded-lg border bg-card p-4 flex flex-col gap-4">
          <h2 className="font-semibold flex items-center gap-2 text-base">
            <IconUser size={18} className="shrink-0 text-muted-foreground" />
            {tx('Persönliche Daten')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="vorname" className="text-sm font-medium">
                {tx('Vorname')} <span className="text-destructive">*</span>
              </label>
              <input
                id="vorname"
                type="text"
                value={form.vorname}
                onChange={e => setField('vorname', e.target.value)}
                autoComplete="given-name"
                className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.vorname ? 'border-destructive' : 'border-input'}`}
              />
              {errors.vorname && (
                <p className="text-xs text-destructive">{errors.vorname}</p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="nachname" className="text-sm font-medium">
                {tx('Nachname')} <span className="text-destructive">*</span>
              </label>
              <input
                id="nachname"
                type="text"
                value={form.nachname}
                onChange={e => setField('nachname', e.target.value)}
                autoComplete="family-name"
                className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.nachname ? 'border-destructive' : 'border-input'}`}
              />
              {errors.nachname && (
                <p className="text-xs text-destructive">{errors.nachname}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
              <IconMail size={16} className="shrink-0 text-muted-foreground" />
              {tx('E-Mail-Adresse')} <span className="text-destructive">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={e => setField('email', e.target.value)}
              autoComplete="email"
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.email ? 'border-destructive' : 'border-input'}`}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="telefon" className="text-sm font-medium flex items-center gap-2">
              <IconPhone size={16} className="shrink-0 text-muted-foreground" />
              {tx('Telefonnummer')}
              <span className="text-muted-foreground text-xs font-normal">{tx('(optional)')}</span>
            </label>
            <input
              id="telefon"
              type="tel"
              value={form.telefon}
              onChange={e => setField('telefon', e.target.value)}
              autoComplete="tel"
              className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </section>

        {/* Anmerkungen */}
        <section className="rounded-lg border bg-card p-4 flex flex-col gap-4">
          <h2 className="font-semibold flex items-center gap-2 text-base">
            <IconMessageCircle size={18} className="shrink-0 text-muted-foreground" />
            {tx('Anmerkungen und Wünsche')}
            <span className="text-muted-foreground text-xs font-normal">{tx('(optional)')}</span>
          </h2>
          <textarea
            id="anmerkungen"
            value={form.anmerkungen}
            onChange={e => setField('anmerkungen', e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
          />
        </section>

        {/* Datenschutz */}
        <div className="flex flex-col gap-1">
          <label className={`flex items-start gap-3 cursor-pointer ${errors.datenschutz ? 'text-destructive' : ''}`}>
            <input
              type="checkbox"
              checked={form.datenschutz}
              onChange={e => setField('datenschutz', e.target.checked)}
              className="mt-0.5 shrink-0 h-4 w-4 rounded border-input"
            />
            <span className="text-sm leading-snug">
              {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
              {' '}<span className="text-destructive">*</span>
            </span>
          </label>
          {errors.datenschutz && (
            <p className="text-xs text-destructive ml-7">{errors.datenschutz}</p>
          )}
        </div>

        {submitError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <a
            href="/#/public/verfuegbarkeit"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft size={16} className="shrink-0" />
            {tx('Verfügbarkeit prüfen')}
          </a>

          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? tx('Wird gesendet…') : tx('Anfrage absenden')}
          </button>
        </div>
      </form>
    </PublicShell>
  );
}
