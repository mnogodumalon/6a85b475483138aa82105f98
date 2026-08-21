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
import { AvailabilityRangePicker, rangeIsFree, type AvailabilityRange, type DateRangeValue } from '@/components/blocks/AvailabilityRangePicker';
import { tx } from '@/i18n';
import { format, differenceInCalendarDays } from 'date-fns';
import { IconCalendar, IconCheck, IconUsers, IconUser, IconMail, IconPhone, IconNotes } from '@tabler/icons-react';

const SLUG = 'buchungsanfrage';
const MIN_NIGHTS = 3;

interface BelegungRecord {
  anreisedatum: string;
  abreisedatum: string;
  status: string;
}

type Step = 'zeitraum' | 'kontakt' | 'danke';

interface ContactForm {
  anzahl_personen: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  anmerkungen: string;
  datenschutz: boolean;
}

export default function Buchungsanfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [belegungen, setBelegungen] = useState<BelegungRecord[]>([]);
  const [loadingBelegungen, setLoadingBelegungen] = useState(false);

  const [step, setStep] = useState<Step>('zeitraum');
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [contact, setContact] = useState<ContactForm>({
    anzahl_personen: '',
    vorname: '',
    nachname: '',
    email: '',
    telefon: '',
    anmerkungen: '',
    datenschutz: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ContactForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load config
  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      if (!c || !c.pages[SLUG]) {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      setCfg(c);
      setPage(c.pages[SLUG]);
      setLoading(false);
    }).catch(() => {
      setUnavailable(true);
      setLoading(false);
    });
  }, []);

  // Load Belegungskalender once config is ready
  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'list' && e.entity === 'belegungskalender');
    if (!ep) return;
    setLoadingBelegungen(true);
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 200 })
      .then(records => {
        const list = Object.values(records).map(r => ({
          anreisedatum: (r.fields.anreisedatum as string) ?? '',
          abreisedatum: (r.fields.abreisedatum as string) ?? '',
          status: (r.fields.status as string) ?? '',
        })).filter(r => r.status === 'belegt' && r.anreisedatum);
        setBelegungen(list);
      })
      .catch(() => {
        // Non-fatal: the calendar will just show all nights as available
      })
      .finally(() => setLoadingBelegungen(false));
  }, [cfg, page]);

  // ALL hooks must be before early returns
  const blocked: AvailabilityRange[] = belegungen.map(b => ({
    start: b.anreisedatum,
    end: b.abreisedatum || undefined,
  }));

  const nights = range.from && range.to
    ? differenceInCalendarDays(
        new Date(range.to + 'T00:00:00'),
        new Date(range.from + 'T00:00:00'),
      )
    : 0;

  const nightsLabel = range.from && range.to
    ? format(new Date(range.from + 'T00:00:00'), 'dd.MM.yyyy') +
      ' – ' +
      format(new Date(range.to + 'T00:00:00'), 'dd.MM.yyyy')
    : '';

  if (loading) {
    return <PublicShell loading />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable />;
  }

  const createEp = page.endpoints?.find(e => e.op === 'create' && e.entity === 'buchungsanfrage');

  const handleRangeNext = () => {
    if (!range.from || !range.to) {
      setRangeError(tx('Bitte wähle An- und Abreisedatum aus.'));
      return;
    }
    if (nights < MIN_NIGHTS) {
      setRangeError(tx('Der Mindestaufenthalt beträgt 3 Nächte. Bitte wähle einen längeren Zeitraum.'));
      return;
    }
    if (!rangeIsFree(range.from, range.to, blocked)) {
      setRangeError(tx('Der gewählte Zeitraum ist leider nicht verfügbar. Bitte wähle einen anderen Zeitraum.'));
      return;
    }
    setRangeError(null);
    if (createEp) {
      prepareChallenge(cfg, page, 'POST', `/apps/${createEp.app_id}/records`);
    }
    setStep('kontakt');
  };

  const handleContactChange = (field: keyof ContactForm, value: string | boolean) => {
    setContact(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validateContact = (): boolean => {
    const newErrors: Partial<Record<keyof ContactForm, string>> = {};
    if (!contact.vorname.trim()) newErrors.vorname = tx('Bitte gib deinen Vornamen ein.');
    if (!contact.nachname.trim()) newErrors.nachname = tx('Bitte gib deinen Nachnamen ein.');
    if (!contact.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
      newErrors.email = tx('Bitte gib eine gültige E-Mail-Adresse ein.');
    if (!contact.anzahl_personen || Number(contact.anzahl_personen) < 1)
      newErrors.anzahl_personen = tx('Bitte gib die Anzahl der Personen an.');
    if (!contact.datenschutz)
      newErrors.datenschutz = tx('Bitte stimme den Datenschutzhinweisen zu.');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateContact()) return;
    if (!range.from || !range.to) {
      setStep('zeitraum');
      return;
    }
    // Re-validate availability at submit time
    if (!rangeIsFree(range.from, range.to, blocked)) {
      setRangeError(tx('Dieser Zeitraum ist leider nicht mehr verfügbar. Bitte wähle einen neuen Zeitraum.'));
      setStep('zeitraum');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: range.from,
        wunsch_abreise: range.to,
        anzahl_personen: Number(contact.anzahl_personen),
        vorname: contact.vorname.trim(),
        nachname: contact.nachname.trim(),
        email: contact.email.trim(),
        telefon: contact.telefon.trim() || undefined,
        anmerkungen: contact.anmerkungen.trim() || undefined,
        datenschutz: contact.datenschutz,
      });
      setStep('danke');
    } catch (err) {
      if (err instanceof PageUnavailableError) {
        setSubmitError(tx('Diese Seite ist derzeit nicht verfügbar. Bitte versuche es später erneut.'));
      } else {
        setSubmitError(tx('Beim Senden der Anfrage ist ein Fehler aufgetreten. Bitte versuche es erneut.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ——— Danke-Seite ———
  if (step === 'danke') {
    return (
      <PublicShell
        title={tx('Anfrage gesendet')}
        description={tx('Wir haben deine Buchungsanfrage erhalten.')}
        wide
      >
        <div className="text-center space-y-4 py-4">
          <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100">
            <IconCheck size={28} className="text-emerald-600" stroke={2} />
          </div>
          <h2 className="text-xl font-semibold">{tx('Vielen Dank!')}</h2>
          <p className="text-muted-foreground">{tx('Wir melden uns in Kürze.')}</p>
          {range.from && range.to && (
            <p className="text-sm text-muted-foreground mt-2">
              {tx('Dein Wunschzeitraum:')} <strong>{nightsLabel}</strong>
            </p>
          )}
        </div>
      </PublicShell>
    );
  }

  // ——— Schritt 1: Zeitraum wählen ———
  if (step === 'zeitraum') {
    return (
      <PublicShell
        title={tx('Buchungsanfrage')}
        description={tx('Wähle deinen Wunschzeitraum. Belegte Nächte sind gesperrt und nicht auswählbar.')}
        wide
      >
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">1</span>
            <span className="font-medium text-foreground">{tx('Zeitraum wählen')}</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground/70">{tx('Kontaktdaten')}</span>
          </div>

          {loadingBelegungen ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{tx('Verfügbarkeit wird geladen …')}</div>
          ) : (
            <AvailabilityRangePicker
              blocked={blocked}
              value={range}
              onChange={v => { setRange(v); setRangeError(null); }}
              minNights={MIN_NIGHTS}
              months={2}
            />
          )}

          {rangeError && (
            <p className="text-sm text-destructive" role="alert">{rangeError}</p>
          )}

          <p className="text-xs text-muted-foreground">
            {tx('Mindestaufenthalt: 3 Nächte')}
          </p>

          <button
            type="button"
            onClick={handleRangeNext}
            disabled={loadingBelegungen}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {tx('Weiter zu Kontaktdaten')}
          </button>
        </div>
      </PublicShell>
    );
  }

  // ——— Schritt 2: Kontaktdaten ———
  return (
    <PublicShell
      title={tx('Buchungsanfrage')}
      description={tx('Fast geschafft! Gib deine Kontaktdaten ein und sende die Anfrage ab.')}
      wide
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-medium">1</span>
          <span className="text-muted-foreground/70">{tx('Zeitraum wählen')}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">2</span>
          <span className="font-medium text-foreground">{tx('Kontaktdaten')}</span>
        </div>

        {/* Zeitraum-Zusammenfassung */}
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
          <IconCalendar size={18} className="shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{nightsLabel}</p>
            <p className="text-xs text-muted-foreground">
              {nights === 1
                ? tx('1 Nacht')
                : nights > 1
                  ? tx(tx`${nights} Nächte`)
                  : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep('zeitraum')}
            className="ml-auto text-xs text-primary hover:underline shrink-0"
          >
            {tx('Ändern')}
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); handleSubmit(); }}
          onFocus={() => {
            if (createEp) prepareChallenge(cfg, page, 'POST', `/apps/${createEp.app_id}/records`);
          }}
        >
          {/* Anzahl Personen */}
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="anzahl_personen">
              <span className="inline-flex items-center gap-1.5">
                <IconUsers size={15} className="shrink-0" />
                {tx('Anzahl der Personen')}
                <span className="text-destructive">*</span>
              </span>
            </label>
            <input
              id="anzahl_personen"
              type="number"
              min={1}
              max={20}
              value={contact.anzahl_personen}
              onChange={e => handleContactChange('anzahl_personen', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="2"
            />
            {errors.anzahl_personen && (
              <p className="mt-1 text-xs text-destructive">{errors.anzahl_personen}</p>
            )}
          </div>

          {/* Vorname + Nachname */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="vorname">
                <span className="inline-flex items-center gap-1.5">
                  <IconUser size={15} className="shrink-0" />
                  {tx('Vorname')}
                  <span className="text-destructive">*</span>
                </span>
              </label>
              <input
                id="vorname"
                type="text"
                autoComplete="given-name"
                value={contact.vorname}
                onChange={e => handleContactChange('vorname', e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={tx('Max')}
              />
              {errors.vorname && (
                <p className="mt-1 text-xs text-destructive">{errors.vorname}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="nachname">
                {tx('Nachname')}
                <span className="text-destructive ml-0.5">*</span>
              </label>
              <input
                id="nachname"
                type="text"
                autoComplete="family-name"
                value={contact.nachname}
                onChange={e => handleContactChange('nachname', e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={tx('Mustermann')}
              />
              {errors.nachname && (
                <p className="mt-1 text-xs text-destructive">{errors.nachname}</p>
              )}
            </div>
          </div>

          {/* E-Mail */}
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="email">
              <span className="inline-flex items-center gap-1.5">
                <IconMail size={15} className="shrink-0" />
                {tx('E-Mail-Adresse')}
                <span className="text-destructive">*</span>
              </span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={contact.email}
              onChange={e => handleContactChange('email', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={tx('max@beispiel.de')}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Telefon */}
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="telefon">
              <span className="inline-flex items-center gap-1.5">
                <IconPhone size={15} className="shrink-0" />
                {tx('Telefonnummer')}
                <span className="text-muted-foreground text-xs font-normal ml-1">{tx('(optional)')}</span>
              </span>
            </label>
            <input
              id="telefon"
              type="tel"
              autoComplete="tel"
              value={contact.telefon}
              onChange={e => handleContactChange('telefon', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="+49 170 1234567"
            />
          </div>

          {/* Anmerkungen */}
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="anmerkungen">
              <span className="inline-flex items-center gap-1.5">
                <IconNotes size={15} className="shrink-0" />
                {tx('Anmerkungen und Wünsche')}
                <span className="text-muted-foreground text-xs font-normal ml-1">{tx('(optional)')}</span>
              </span>
            </label>
            <textarea
              id="anmerkungen"
              rows={3}
              value={contact.anmerkungen}
              onChange={e => handleContactChange('anmerkungen', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder={tx('z. B. Haustier, Kinderbett, spätere Anreise …')}
            />
          </div>

          {/* Datenschutz */}
          <div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={contact.datenschutz}
                onChange={e => handleContactChange('datenschutz', e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <span className="text-sm text-muted-foreground leading-snug">
                {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
                <span className="text-destructive ml-0.5">*</span>
              </span>
            </label>
            {errors.datenschutz && (
              <p className="mt-1 text-xs text-destructive">{errors.datenschutz}</p>
            )}
          </div>

          {submitError && (
            <p className="text-sm text-destructive rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2" role="alert">
              {submitError}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep('zeitraum')}
              className="w-full sm:w-auto rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              {tx('Zurück')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {submitting ? tx('Wird gesendet …') : tx('Anfrage absenden')}
            </button>
          </div>
        </form>
      </div>
    </PublicShell>
  );
}
