import { useEffect, useState, useRef } from 'react';
import { format, parseISO, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, isWithinInterval, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
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
import { tx } from '@/i18n';
import {
  IconCalendar,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconUser,
  IconMail,
  IconPhone,
  IconBed,
  IconAlertCircle,
  IconChevronRight,
} from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BelegungEntry {
  id: string;
  anreisedatum: string;
  abreisedatum: string;
  status: string; // 'belegt' | 'frei'
}

interface AnfrageForm {
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

const EMPTY_FORM: AnfrageForm = {
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

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

type DayTone = 'belegt' | 'frei' | 'start' | 'end' | 'middle' | null;

function getDayTone(day: Date, entries: BelegungEntry[]): { tone: DayTone; status: string | null } {
  const dayStr = format(day, 'yyyy-MM-dd');
  for (const e of entries) {
    const start = e.anreisedatum;
    const end = e.abreisedatum;
    if (dayStr >= start && dayStr <= end) {
      const isStart = dayStr === start;
      const isEnd = dayStr === end;
      if (isStart && isEnd) return { tone: e.status === 'belegt' ? 'belegt' : 'frei', status: e.status };
      if (isStart) return { tone: 'start', status: e.status };
      if (isEnd) return { tone: 'end', status: e.status };
      return { tone: 'middle', status: e.status };
    }
  }
  return { tone: null, status: null };
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step }: { step: number }) {
  const steps = [
    tx('Verfügbarkeit'),
    tx('Anfrageformular'),
    tx('Bestätigung'),
  ];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = step === idx;
        const done = step > idx;
        return (
          <div key={idx} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {done ? <IconCheck size={14} /> : idx}
              </div>
              <span className={['text-xs font-medium', active ? 'text-foreground' : 'text-muted-foreground'].join(' ')}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={['w-12 h-px mt-[-10px] mx-1', step > idx ? 'bg-emerald-500' : 'bg-muted'].join(' ')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month calendar
// ---------------------------------------------------------------------------

function MonthCalendar({
  year,
  month,
  entries,
  selectedStart,
  selectedEnd,
  onDayClick,
}: {
  year: number;
  month: number;
  entries: BelegungEntry[];
  selectedStart: string;
  selectedEnd: string;
  onDayClick: (day: string) => void;
}) {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fill leading blanks (Mon=0)
  const firstDow = (monthStart.getDay() + 6) % 7;
  const blanks = Array(firstDow).fill(null);

  const today = startOfDay(new Date());

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map(day => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const { tone, status } = getDayTone(day, entries);
          const isPast = startOfDay(day) < today;
          const isSelStart = dayStr === selectedStart;
          const isSelEnd = dayStr === selectedEnd;
          const inRange =
            selectedStart && selectedEnd && dayStr > selectedStart && dayStr < selectedEnd;

          let bg = 'bg-background hover:bg-muted';
          let textColor = isPast ? 'text-muted-foreground/50' : 'text-foreground';
          let cursor = isPast ? 'cursor-default' : 'cursor-pointer';

          if (tone === 'belegt' || tone === 'start' || tone === 'end' || tone === 'middle') {
            if (status === 'belegt') {
              bg = tone === 'start' ? 'bg-red-500 rounded-l-full' : tone === 'end' ? 'bg-red-500 rounded-r-full' : tone === 'middle' ? 'bg-red-200' : 'bg-red-500 rounded-full';
              textColor = status === 'belegt' && (tone === 'start' || tone === 'end' || tone === 'belegt') ? 'text-white' : 'text-red-700';
              cursor = 'cursor-default';
            } else {
              bg = tone === 'start' ? 'bg-emerald-500 rounded-l-full' : tone === 'end' ? 'bg-emerald-500 rounded-r-full' : tone === 'middle' ? 'bg-emerald-100' : 'bg-emerald-500 rounded-full';
              textColor = status === 'frei' && (tone === 'start' || tone === 'end' || tone === 'frei') ? 'text-white' : 'text-emerald-700';
            }
          }

          if (isSelStart || isSelEnd) {
            bg = 'bg-primary rounded-full';
            textColor = 'text-primary-foreground';
          } else if (inRange) {
            bg = 'bg-primary/20';
            textColor = 'text-foreground';
          }

          if (isToday(day) && !isSelStart && !isSelEnd) {
            textColor = textColor + ' font-bold underline';
          }

          return (
            <button
              key={dayStr}
              disabled={isPast || (tone !== null && status === 'belegt')}
              onClick={() => !isPast && cursor !== 'cursor-default' && onDayClick(dayStr)}
              className={[
                'relative aspect-square flex items-center justify-center text-sm transition-colors min-h-[2rem]',
                bg, textColor, cursor,
                isPast || (tone !== null && status === 'belegt') ? 'pointer-events-none' : '',
              ].join(' ')}
              aria-label={dayStr}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Verfügbarkeitskalender
// ---------------------------------------------------------------------------

function Step1Availability({
  entries,
  onNext,
  initialStart,
  initialEnd,
}: {
  entries: BelegungEntry[];
  onNext: (start: string, end: string) => void;
  initialStart: string;
  initialEnd: string;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selStart, setSelStart] = useState(initialStart);
  const [selEnd, setSelEnd] = useState(initialEnd);
  const [minNightsError, setMinNightsError] = useState(false);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleDayClick = (dayStr: string) => {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(dayStr);
      setSelEnd('');
      setMinNightsError(false);
    } else {
      if (dayStr <= selStart) {
        setSelStart(dayStr);
        setSelEnd('');
      } else {
        setSelEnd(dayStr);
        const nights = differenceInDays(parseISO(dayStr), parseISO(selStart));
        setMinNightsError(nights < 3);
      }
    }
  };

  const nights = selStart && selEnd ? differenceInDays(parseISO(selEnd), parseISO(selStart)) : 0;
  const canProceed = selStart && selEnd && nights >= 3 && !minNightsError;

  const monthLabel = format(new Date(viewYear, viewMonth, 1), 'MMMM yyyy', { locale: de });

  // Show two months
  const nextViewMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextViewYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-emerald-500 shrink-0" />
          {tx('Frei')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-red-500 shrink-0" />
          {tx('Belegt')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-primary shrink-0" />
          {tx('Deine Auswahl')}
        </span>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label={tx('Vorheriger Monat')}>
          <IconArrowLeft size={18} />
        </button>
        <span className="font-semibold capitalize">{monthLabel}</span>
        <button onClick={nextMonth} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label={tx('Nächster Monat')}>
          <IconArrowRight size={18} />
        </button>
      </div>

      {/* Calendars — 1 on mobile, 2 on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-center text-sm font-medium text-muted-foreground mb-2 capitalize">
            {format(new Date(viewYear, viewMonth, 1), 'MMMM yyyy', { locale: de })}
          </div>
          <MonthCalendar
            year={viewYear}
            month={viewMonth}
            entries={entries}
            selectedStart={selStart}
            selectedEnd={selEnd}
            onDayClick={handleDayClick}
          />
        </div>
        <div className="hidden md:block">
          <div className="text-center text-sm font-medium text-muted-foreground mb-2 capitalize">
            {format(new Date(nextViewYear, nextViewMonth, 1), 'MMMM yyyy', { locale: de })}
          </div>
          <MonthCalendar
            year={nextViewYear}
            month={nextViewMonth}
            entries={entries}
            selectedStart={selStart}
            selectedEnd={selEnd}
            onDayClick={handleDayClick}
          />
        </div>
      </div>

      {/* Selection summary */}
      {selStart && (
        <div className="rounded-lg border bg-muted/40 p-4 space-y-1">
          <div className="flex gap-4 text-sm flex-wrap">
            <span>
              <span className="text-muted-foreground">{tx('Anreise:')}</span>{' '}
              <span className="font-medium">{format(parseISO(selStart), 'dd. MMMM yyyy', { locale: de })}</span>
            </span>
            {selEnd && (
              <>
                <span>
                  <span className="text-muted-foreground">{tx('Abreise:')}</span>{' '}
                  <span className="font-medium">{format(parseISO(selEnd), 'dd. MMMM yyyy', { locale: de })}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">{tx('Nächte:')}</span>{' '}
                  <span className="font-medium">{nights}</span>
                </span>
              </>
            )}
          </div>
          {!selEnd && (
            <p className="text-sm text-muted-foreground">{tx('Bitte wähle nun das Abreisedatum.')}</p>
          )}
        </div>
      )}

      {minNightsError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
          {tx('Der Mindestaufenthalt beträgt 3 Nächte. Bitte wähle ein späteres Abreisedatum.')}
        </div>
      )}

      <button
        disabled={!canProceed}
        onClick={() => canProceed && onNext(selStart, selEnd)}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {tx('Weiter zur Anfrage')}
        <IconChevronRight size={18} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Anfrageformular
// ---------------------------------------------------------------------------

function Step2Form({
  initialDates,
  cfg,
  page,
  onBack,
  onSuccess,
}: {
  initialDates: { start: string; end: string };
  cfg: PublicPagesConfig;
  page: PublicPageConfig;
  onBack: () => void;
  onSuccess: (form: AnfrageForm) => void;
}) {
  const [form, setForm] = useState<AnfrageForm>({
    ...EMPTY_FORM,
    wunsch_anreise: initialDates.start,
    wunsch_abreise: initialDates.end,
    anzahl_personen: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AnfrageForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const createEp = page.endpoints?.find(e => e.op === 'create' && e.entity === 'buchungsanfrage');

  // Warm up challenge on first interaction
  const challenged = useRef(false);
  const warmChallenge = () => {
    if (!challenged.current && createEp) {
      challenged.current = true;
      prepareChallenge(cfg, page, 'POST', `/apps/${createEp.app_id}/records`);
    }
  };

  const set = (key: keyof AnfrageForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    warmChallenge();
    setForm(f => ({ ...f, [key]: e.target.value }));
    setErrors(err => ({ ...err, [key]: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof AnfrageForm, string>> = {};
    if (!form.wunsch_anreise) newErrors.wunsch_anreise = tx('Pflichtfeld');
    if (!form.wunsch_abreise) newErrors.wunsch_abreise = tx('Pflichtfeld');
    if (form.wunsch_anreise && form.wunsch_abreise) {
      const nights = differenceInDays(parseISO(form.wunsch_abreise), parseISO(form.wunsch_anreise));
      if (nights < 3) newErrors.wunsch_abreise = tx('Mindestaufenthalt 3 Nächte');
    }
    if (!form.anzahl_personen || Number(form.anzahl_personen) < 1) newErrors.anzahl_personen = tx('Bitte Anzahl angeben');
    if (!form.vorname.trim()) newErrors.vorname = tx('Pflichtfeld');
    if (!form.nachname.trim()) newErrors.nachname = tx('Pflichtfeld');
    if (!form.email.trim()) newErrors.email = tx('Pflichtfeld');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = tx('Ungültige E-Mail-Adresse');
    if (!form.datenschutz) newErrors.datenschutz = tx('Bitte stimme den Datenschutzhinweisen zu');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!createEp) { setSubmitError(tx('Konfigurationsfehler')); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      await createPublicRecord(cfg, page, {
        wunsch_anreise: form.wunsch_anreise,
        wunsch_abreise: form.wunsch_abreise,
        anzahl_personen: Number(form.anzahl_personen),
        vorname: form.vorname.trim(),
        nachname: form.nachname.trim(),
        email: form.email.trim(),
        telefon: form.telefon.trim() || null,
        anmerkungen: form.anmerkungen.trim() || null,
        datenschutz: form.datenschutz,
      });
      onSuccess(form);
    } catch {
      setSubmitError(tx('Beim Absenden ist ein Fehler aufgetreten. Bitte versuche es erneut.'));
    } finally {
      setSubmitting(false);
    }
  };

  const nights = form.wunsch_anreise && form.wunsch_abreise
    ? differenceInDays(parseISO(form.wunsch_abreise), parseISO(form.wunsch_anreise))
    : 0;

  const fieldClass = (key: keyof AnfrageForm) =>
    [
      'w-full rounded-lg border px-3 py-2 text-sm bg-background transition-colors',
      'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
      errors[key] ? 'border-red-400' : 'border-input',
    ].join(' ');

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Date summary */}
      <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-4">
        <div className="flex items-start gap-3">
          <IconCalendar size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm space-y-0.5">
            <div className="font-medium text-emerald-800">
              {format(parseISO(form.wunsch_anreise), 'dd. MMMM yyyy', { locale: de })}
              {' — '}
              {format(parseISO(form.wunsch_abreise), 'dd. MMMM yyyy', { locale: de })}
            </div>
            <div className="text-emerald-600">{tx`${nights} Nächte`}</div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="ml-auto text-xs text-emerald-700 underline hover:no-underline"
          >
            {tx('Ändern')}
          </button>
        </div>
      </div>

      {/* Dates (editable fallback) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{tx('Anreisedatum')} <span className="text-red-500">*</span></label>
          <input type="date" className={fieldClass('wunsch_anreise')} value={form.wunsch_anreise}
            onChange={set('wunsch_anreise')} required />
          {errors.wunsch_anreise && <p className="text-xs text-red-500 mt-1">{errors.wunsch_anreise}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{tx('Abreisedatum')} <span className="text-red-500">*</span></label>
          <input type="date" className={fieldClass('wunsch_abreise')} value={form.wunsch_abreise}
            onChange={set('wunsch_abreise')} required />
          {errors.wunsch_abreise && <p className="text-xs text-red-500 mt-1">{errors.wunsch_abreise}</p>}
        </div>
      </div>

      {/* Personen */}
      <div>
        <label className="block text-sm font-medium mb-1">{tx('Anzahl der Personen')} <span className="text-red-500">*</span></label>
        <div className="relative">
          <IconBed size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
          <input type="number" min={1} max={20} className={fieldClass('anzahl_personen') + ' pl-9'}
            value={form.anzahl_personen} onChange={set('anzahl_personen')} placeholder="2" required />
        </div>
        {errors.anzahl_personen && <p className="text-xs text-red-500 mt-1">{errors.anzahl_personen}</p>}
      </div>

      {/* Name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{tx('Vorname')} <span className="text-red-500">*</span></label>
          <div className="relative">
            <IconUser size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
            <input type="text" className={fieldClass('vorname') + ' pl-9'} value={form.vorname}
              onChange={set('vorname')} placeholder={tx('Maria')} required />
          </div>
          {errors.vorname && <p className="text-xs text-red-500 mt-1">{errors.vorname}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{tx('Nachname')} <span className="text-red-500">*</span></label>
          <input type="text" className={fieldClass('nachname')} value={form.nachname}
            onChange={set('nachname')} placeholder={tx('Mustermann')} required />
          {errors.nachname && <p className="text-xs text-red-500 mt-1">{errors.nachname}</p>}
        </div>
      </div>

      {/* Kontakt */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{tx('E-Mail-Adresse')} <span className="text-red-500">*</span></label>
          <div className="relative">
            <IconMail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
            <input type="email" className={fieldClass('email') + ' pl-9'} value={form.email}
              onChange={set('email')} placeholder="maria@beispiel.de" required />
          </div>
          {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{tx('Telefon')} <span className="text-muted-foreground text-xs ml-1">{tx('(optional)')}</span></label>
          <div className="relative">
            <IconPhone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
            <input type="tel" className={fieldClass('telefon') + ' pl-9'} value={form.telefon}
              onChange={set('telefon')} placeholder="+49 151 …" />
          </div>
        </div>
      </div>

      {/* Anmerkungen */}
      <div>
        <label className="block text-sm font-medium mb-1">{tx('Anmerkungen und Wünsche')} <span className="text-muted-foreground text-xs ml-1">{tx('(optional)')}</span></label>
        <textarea className={fieldClass('anmerkungen')} rows={3} value={form.anmerkungen}
          onChange={set('anmerkungen')}
          placeholder={tx('z.B. Kinderbett gewünscht, Haustier, Anreisezeit …')} />
      </div>

      {/* Datenschutz */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={form.datenschutz}
            onChange={e => { warmChallenge(); setForm(f => ({ ...f, datenschutz: e.target.checked })); setErrors(err => ({ ...err, datenschutz: undefined })); }}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
          />
          <span className="text-sm text-muted-foreground leading-snug">
            {tx('Ich habe die Datenschutzhinweise gelesen und stimme der Verarbeitung meiner Daten zur Bearbeitung meiner Anfrage zu.')}
            <span className="text-red-500 ml-1">*</span>
          </span>
        </label>
        {errors.datenschutz && <p className="text-xs text-red-500 mt-1 ml-7">{errors.datenschutz}</p>}
      </div>

      {submitError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
          {submitError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" onClick={onBack}
          className="flex items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors">
          <IconArrowLeft size={16} />
          {tx('Zurück')}
        </button>
        <button type="submit" disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-2.5 font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors">
          {submitting ? tx('Wird gesendet …') : tx('Anfrage absenden')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Bestätigung
// ---------------------------------------------------------------------------

function Step3Confirmation({ form }: { form: AnfrageForm }) {
  const nights = differenceInDays(parseISO(form.wunsch_abreise), parseISO(form.wunsch_anreise));
  return (
    <div className="text-center space-y-6 py-4">
      <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
        <IconCheck size={32} className="text-emerald-600" />
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-2">{tx('Anfrage erfolgreich gesendet!')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {tx('Vielen Dank für deine Anfrage, ')}
          <span className="font-medium text-foreground">{form.vorname} {form.nachname}</span>
          {tx('. Wir werden uns so schnell wie möglich per E-Mail bei dir melden.')}
        </p>
      </div>
      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-left space-y-2 max-w-sm mx-auto">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tx('Anreise')}</span>
          <span className="font-medium">{format(parseISO(form.wunsch_anreise), 'dd. MMM yyyy', { locale: de })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tx('Abreise')}</span>
          <span className="font-medium">{format(parseISO(form.wunsch_abreise), 'dd. MMM yyyy', { locale: de })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tx('Nächte')}</span>
          <span className="font-medium">{nights}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tx('Personen')}</span>
          <span className="font-medium">{form.anzahl_personen}</span>
        </div>
        <div className="border-t pt-2 flex justify-between">
          <span className="text-muted-foreground">{tx('E-Mail')}</span>
          <span className="font-medium truncate max-w-[160px]">{form.email}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {tx('Bitte überprüfe deinen Spam-Ordner, falls du keine Nachricht erhältst.')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Verfuegbarkeit() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [entries, setEntries] = useState<BelegungEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [step, setStep] = useState(1);
  const [selectedDates, setSelectedDates] = useState({ start: '', end: '' });
  const [submittedForm, setSubmittedForm] = useState<AnfrageForm | null>(null);

  useEffect(() => {
    loadPublicPagesConfig('verfuegbarkeit')
      .then(c => {
        setCfg(c);
        const p = c?.pages['verfuegbarkeit'] ?? null;
        setPage(p);
        setLoadingCfg(false);
        if (p && c) {
          // Load calendar entries
          setLoadingEntries(true);
          const listEp = p.endpoints?.find(e => e.op === 'list' && e.entity === 'belegungskalender');
          if (listEp) {
            listPublicRecords(c, p, { appId: listEp.app_id })
              .then(res => {
                const loaded: BelegungEntry[] = Object.values(res).map(r => ({
                  id: r.id,
                  anreisedatum: (r.fields.anreisedatum as string) ?? '',
                  abreisedatum: (r.fields.abreisedatum as string) ?? '',
                  status: (r.fields.status as string) ?? '',
                })).filter(e => e.anreisedatum && e.abreisedatum);
                setEntries(loaded);
              })
              .catch(() => {/* non-critical, show empty calendar */})
              .finally(() => setLoadingEntries(false));
          } else {
            setLoadingEntries(false);
          }
        }
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoadingCfg(false);
      });
  }, []);

  if (loadingCfg || (!cfg || !page)) {
    return <PublicShell loading={loadingCfg} unavailable={unavailable} />;
  }

  const handleStep1Next = (start: string, end: string) => {
    setSelectedDates({ start, end });
    setStep(2);
  };

  const handleStep2Success = (form: AnfrageForm) => {
    setSubmittedForm(form);
    setStep(3);
  };

  return (
    <PublicShell
      title={tx('Verfügbarkeit & Buchungsanfrage')}
      description={tx('Ostsee Ferienwohnung — Prüfe freie Zeiträume und stelle deine Anfrage direkt online.')}
      wide
    >
      <StepIndicator step={step} />

      {step === 1 && (
        <Step1Availability
          entries={entries}
          onNext={handleStep1Next}
          initialStart={selectedDates.start}
          initialEnd={selectedDates.end}
        />
      )}

      {step === 2 && cfg && page && (
        <Step2Form
          initialDates={selectedDates}
          cfg={cfg}
          page={page}
          onBack={() => setStep(1)}
          onSuccess={handleStep2Success}
        />
      )}

      {step === 3 && submittedForm && (
        <Step3Confirmation form={submittedForm} />
      )}

      {step === 1 && loadingEntries && (
        <p className="text-center text-sm text-muted-foreground mt-4">{tx('Belegungskalender wird geladen …')}</p>
      )}
    </PublicShell>
  );
}
