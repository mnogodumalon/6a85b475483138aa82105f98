import { useEffect, useState } from 'react';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { IconCalendar, IconUser, IconMail, IconPhone, IconCheck, IconSend } from '@tabler/icons-react';
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
  type DateRangeValue,
  type AvailabilityRange,
} from '@/components/blocks/AvailabilityRangePicker';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { tx } from '@/i18n';

const SLUG = 'verfuegbarkeit';
const DATE_FMT = 'yyyy-MM-dd';

interface BelegungRecord {
  id: string;
  anreisedatum: string | null;
  abreisedatum: string | null;
  status: string | null;
}

interface FormData {
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  anzahl_personen: string;
  anmerkungen: string;
  datenschutz: boolean;
}

const emptyForm = (): FormData => ({
  vorname: '',
  nachname: '',
  email: '',
  telefon: '',
  anzahl_personen: '',
  anmerkungen: '',
  datenschutz: false,
});

export default function Verfuegbarkeit() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [belegungen, setBelegungen] = useState<BelegungRecord[]>([]);
  const [belegungLoading, setBelegungLoading] = useState(false);

  const [step, setStep] = useState(1);
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [form, setForm] = useState<FormData>(emptyForm());
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // ALL hooks before any early return
  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setCfgLoading(false);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        else setUnavailable(true);
        setCfgLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'list' && e.entity === 'belegungskalender');
    if (!ep) return;
    setBelegungLoading(true);
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 500 })
      .then(res => {
        const records: BelegungRecord[] = Object.values(res).map(r => ({
          id: r.id,
          anreisedatum: (r.fields.anreisedatum as string) ?? null,
          abreisedatum: (r.fields.abreisedatum as string) ?? null,
          status: (r.fields.status as string) ?? null,
        }));
        setBelegungen(records);
      })
      .finally(() => setBelegungLoading(false));
  }, [cfg, page]);

  if (cfgLoading || belegungLoading) {
    return <PublicShell loading />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable />;
  }

  const blocked: AvailabilityRange[] = belegungen
    .filter(b => b.status === 'belegt' && b.anreisedatum)
    .map(b => ({ start: b.anreisedatum!, end: b.abreisedatum }));

  const nights =
    range.from && range.to
      ? differenceInCalendarDays(parseISO(range.to), parseISO(range.from))
      : 0;

  const validateRange = (): boolean => {
    const today = format(new Date(), DATE_FMT);
    if (!range.from || !range.to) {
      setRangeError(tx('Bitte wähle Anreise- und Abreisedatum.'));
      return false;
    }
    if (range.from < today || range.to < today) {
      setRangeError(tx('Beide Daten müssen in der Zukunft liegen.'));
      return false;
    }
    if (nights < 3) {
      setRangeError(tx('Der Mindestaufenthalt beträgt 3 Nächte.'));
      return false;
    }
    if (!rangeIsFree(range.from, range.to, blocked)) {
      setRangeError(tx('Der gewählte Zeitraum überschneidet sich mit einer bestehenden Belegung.'));
      return false;
    }
    setRangeError(null);
    return true;
  };

  const validateForm = (): boolean => {
    const errors: Partial<Record<keyof FormData, string>> = {};
    if (!form.vorname.trim()) errors.vorname = tx('Pflichtfeld');
    if (!form.nachname.trim()) errors.nachname = tx('Pflichtfeld');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = tx('Bitte gib eine gültige E-Mail-Adresse an.');
    }
    const n = Number(form.anzahl_personen);
    if (!form.anzahl_personen || isNaN(n) || n < 1) {
      errors.anzahl_personen = tx('Bitte gib die Anzahl der Personen an.');
    }
    if (!form.datenschutz) {
      errors.datenschutz = tx('Bitte stimme der Datenschutzerklärung zu.');
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToStep2 = () => {
    if (!validateRange()) return;
    const ep = page.endpoints?.find(e => e.op === 'create');
    if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
    setStep(2);
  };

  const goBack = () => setStep(1);

  const handleSubmit = async () => {
    if (!validateRange() || !validateForm()) return;
    const ep = page.endpoints?.find(e => e.op === 'create');
    if (!ep) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: range.from,
        wunsch_abreise: range.to,
        anzahl_personen: Number(form.anzahl_personen),
        vorname: form.vorname.trim(),
        nachname: form.nachname.trim(),
        email: form.email.trim(),
        telefon: form.telefon.trim() || null,
        anmerkungen: form.anmerkungen.trim() || null,
        datenschutz: form.datenschutz,
      });
      setSubmitted(true);
      setStep(3);
    } catch {
      setSubmitError(tx('Die Anfrage konnte nicht gesendet werden. Bitte versuche es erneut.'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }));
    if (formErrors[key]) setFormErrors(fe => ({ ...fe, [key]: undefined }));
  };

  const steps = [
    { label: tx('Zeitraum') },
    { label: tx('Kontaktdaten') },
    { label: tx('Bestätigung') },
  ];

  return (
    <PublicShell
      title={tx('Verfügbarkeit & Buchungsanfrage')}
      description={tx('Prüfe freie Zeiträume und stelle eine unverbindliche Buchungsanfrage.')}
      plain
    >
      <div className="max-w-2xl mx-auto px-4 pb-12">
        <IntentWizardShell
          steps={steps}
          currentStep={step}
          onStepChange={s => { if (s < step) setStep(s); }}
          back={false}
        >
          {/* ── Step 1: Zeitraum wählen ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-4 sm:p-6 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconCalendar size={16} className="shrink-0 text-primary" />
                  <span>{tx('Wunschzeitraum wählen')}</span>
                </div>
                <AvailabilityRangePicker
                  blocked={blocked}
                  value={range}
                  onChange={v => { setRange(v); setRangeError(null); }}
                  minNights={3}
                  months={2}
                />
                {rangeError && (
                  <p className="text-sm text-destructive" role="alert">{rangeError}</p>
                )}
                {range.from && range.to && nights >= 3 && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-sm space-y-0.5">
                    <p className="font-medium text-foreground">
                      {format(parseISO(range.from), 'dd.MM.yyyy')} {tx('&rarr;')} {format(parseISO(range.to), 'dd.MM.yyyy')}
                    </p>
                    <p className="text-muted-foreground">
                      {nights === 1 ? tx('1 Nacht') : `${nights} ${tx('Nächte')}`}
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <p>{tx('Mindestaufenthalt: 3 Nächte. Durchgestrichene Tage sind bereits belegt.')}</p>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={goToStep2}
              >
                {tx('Weiter zu Kontaktdaten')}
              </Button>
            </div>
          )}

          {/* ── Step 2: Kontaktdaten ── */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Summary */}
              {range.from && range.to && (
                <div className="rounded-xl border bg-primary/5 px-4 py-3 text-sm flex items-center gap-3">
                  <IconCalendar size={16} className="shrink-0 text-primary" />
                  <div>
                    <span className="font-medium">
                      {format(parseISO(range.from), 'dd.MM.yyyy')} – {format(parseISO(range.to), 'dd.MM.yyyy')}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      ({nights} {nights === 1 ? tx('Nacht') : tx('Nächte')})
                    </span>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border bg-card p-4 sm:p-6 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconUser size={16} className="shrink-0 text-primary" />
                  <span>{tx('Persönliche Angaben')}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="vorname">{tx('Vorname')} *</Label>
                    <Input
                      id="vorname"
                      value={form.vorname}
                      onChange={field('vorname')}
                      placeholder={tx('Max')}
                      autoComplete="given-name"
                    />
                    {formErrors.vorname && (
                      <p className="text-xs text-destructive">{formErrors.vorname}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nachname">{tx('Nachname')} *</Label>
                    <Input
                      id="nachname"
                      value={form.nachname}
                      onChange={field('nachname')}
                      placeholder={tx('Mustermann')}
                      autoComplete="family-name"
                    />
                    {formErrors.nachname && (
                      <p className="text-xs text-destructive">{formErrors.nachname}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    <span className="flex items-center gap-1.5">
                      <IconMail size={14} className="shrink-0" />
                      {tx('E-Mail-Adresse')} *
                    </span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={field('email')}
                    placeholder="max@beispiel.de" /* i18n-exempt */
                    autoComplete="email"
                  />
                  {formErrors.email && (
                    <p className="text-xs text-destructive">{formErrors.email}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="telefon">
                      <span className="flex items-center gap-1.5">
                        <IconPhone size={14} className="shrink-0" />
                        {tx('Telefonnummer')}
                      </span>
                    </Label>
                    <Input
                      id="telefon"
                      type="tel"
                      value={form.telefon}
                      onChange={field('telefon')}
                      autoComplete="tel"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="anzahl_personen">{tx('Anzahl Personen')} *</Label>
                    <Input
                      id="anzahl_personen"
                      type="number"
                      min={1}
                      max={20}
                      value={form.anzahl_personen}
                      onChange={field('anzahl_personen')}
                      placeholder="2"
                    />
                    {formErrors.anzahl_personen && (
                      <p className="text-xs text-destructive">{formErrors.anzahl_personen}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="anmerkungen">{tx('Anmerkungen und Wünsche')}</Label>
                  <Textarea
                    id="anmerkungen"
                    value={form.anmerkungen}
                    onChange={field('anmerkungen')}
                    rows={3}
                    placeholder={tx('Haustier, Kinderbett, Anreisezeit ...')}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="datenschutz"
                      checked={form.datenschutz}
                      onCheckedChange={checked => {
                        setForm(f => ({ ...f, datenschutz: checked === true }));
                        if (formErrors.datenschutz) setFormErrors(fe => ({ ...fe, datenschutz: undefined }));
                      }}
                    />
                    <Label htmlFor="datenschutz" className="text-sm leading-snug cursor-pointer">
                      {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
                      {' *'}
                    </Label>
                  </div>
                  {formErrors.datenschutz && (
                    <p className="text-xs text-destructive">{formErrors.datenschutz}</p>
                  )}
                </div>
              </div>

              {submitError && (
                <p className="text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3" role="alert">
                  {submitError}
                </p>
              )}

              <div className="flex gap-3">
                <Button variant="outline" onClick={goBack} className="flex-1">
                  {tx('Zurück')}
                </Button>
                <Button
                  className="flex-1"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? tx('Wird gesendet …') : (
                    <span className="flex items-center gap-2">
                      <IconSend size={16} className="shrink-0" />
                      {tx('Anfrage absenden')}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Bestätigung ── */}
          {step === 3 && submitted && (
            <div className="rounded-2xl border bg-card p-6 sm:p-8 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <IconCheck size={28} stroke={2} className="text-emerald-600" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">{tx('Anfrage eingegangen!')}</h2>
                <p className="text-muted-foreground text-sm">
                  {tx('Vielen Dank,')} {form.vorname}!{' '}
                  {tx('Wir melden uns so schnell wie möglich bei dir unter')} {form.email}.
                </p>
              </div>
              {range.from && range.to && (
                <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-left space-y-1">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide font-medium">{tx('Dein Wunschzeitraum')}</p>
                  <p className="font-medium">
                    {format(parseISO(range.from), 'dd.MM.yyyy')} – {format(parseISO(range.to), 'dd.MM.yyyy')}
                  </p>
                  <p className="text-muted-foreground">{nights} {nights === 1 ? tx('Nacht') : tx('Nächte')} · {form.anzahl_personen} {tx('Personen')}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {tx('Die Buchungsanfrage ist unverbindlich. Nach Prüfung erhältst du eine Bestätigungsmail.')}
              </p>
            </div>
          )}
        </IntentWizardShell>
      </div>
    </PublicShell>
  );
}
