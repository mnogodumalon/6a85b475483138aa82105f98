import { useEffect, useState, useMemo } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  listPublicRecords,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { tx } from '@/i18n';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  isBefore,
  isAfter,
  isSameDay,
  parseISO,
  getDay,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

interface BelegungRecord {
  id: string;
  anreisedatum: string;
  abreisedatum: string;
  status: string; // 'belegt' | 'frei'
}

type DayState = 'belegt' | 'frei' | 'none';

function getDayState(date: Date, records: BelegungRecord[]): DayState {
  const dateStr = format(date, 'yyyy-MM-dd');
  for (const r of records) {
    if (!r.anreisedatum || !r.abreisedatum) continue;
    if (dateStr >= r.anreisedatum && dateStr <= r.abreisedatum) {
      return r.status === 'belegt' ? 'belegt' : 'frei';
    }
  }
  return 'none';
}

function CalendarMonth({
  year,
  month,
  records,
}: {
  year: number;
  month: number;
  records: BelegungRecord[];
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const firstDay = startOfMonth(new Date(year, month));
  const lastDay = endOfMonth(firstDay);

  // pad so week starts on Monday (0=Mon … 6=Sun)
  const weekStart = startOfWeek(firstDay, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(lastDay, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const monthLabel = format(firstDay, 'MMMM yyyy', { locale: de });

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-border">
        <h3 className="font-semibold text-slate-800 text-sm text-center">
          {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
        </h3>
      </div>
      <div className="p-3">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {[tx('Mo'), tx('Di'), tx('Mi'), tx('Do'), tx('Fr'), tx('Sa'), tx('So')].map((d, i) => (
            <div key={i} className="text-center text-xs font-medium text-slate-400 py-1">
              {d}
            </div>
          ))}
        </div>
        {/* Day grid */}
        <div className="grid grid-cols-7 gap-px">
          {allDays.map((day) => {
            const isCurrentMonth = day.getMonth() === month;
            const dateStr = format(day, 'yyyy-MM-dd');
            const isPast = dateStr < today;
            const dayState = isCurrentMonth ? getDayState(day, records) : 'none';

            let cellClass =
              'relative flex items-center justify-center rounded-md h-9 text-sm font-medium transition-colors ';

            if (!isCurrentMonth) {
              cellClass += 'text-slate-200';
            } else if (isPast) {
              cellClass += 'text-slate-300';
            } else if (dayState === 'belegt') {
              cellClass += 'bg-red-100 text-red-700 font-semibold';
            } else if (dayState === 'frei') {
              cellClass += 'bg-emerald-100 text-emerald-700 font-semibold';
            } else {
              cellClass += 'text-slate-600';
            }

            if (isSameDay(day, new Date()) && isCurrentMonth) {
              cellClass += ' ring-2 ring-offset-1 ring-slate-400';
            }

            return (
              <div key={dateStr} className={cellClass}>
                {day.getDate()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Verfuegbarkeit() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [records, setRecords] = useState<BelegungRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const today = new Date();
  const [viewOffset, setViewOffset] = useState(0); // months offset from current

  const navigate = useNavigate();

  useEffect(() => {
    loadPublicPagesConfig('verfuegbarkeit')
      .then(async (c) => {
        setCfg(c);
        const p = c?.pages['verfuegbarkeit'] ?? null;
        setPage(p);
        if (!p) {
          setUnavailable(true);
          setLoading(false);
          return;
        }
        // load belegung records
        setDataLoading(true);
        const ep = p.endpoints?.find((e) => e.op === 'list' && e.entity === 'belegungskalender');
        if (ep) {
          try {
            const raw = await listPublicRecords(c!, p, {
              appId: ep.app_id,
              limit: 200,
            });
            const list: BelegungRecord[] = Object.values(raw).map((r) => ({
              id: r.id,
              anreisedatum: (r.fields.anreisedatum as string) ?? '',
              abreisedatum: (r.fields.abreisedatum as string) ?? '',
              status: (r.fields.status as string) ?? '',
            }));
            setRecords(list);
          } catch {
            // graceful — show calendar empty rather than crashing
          }
        }
        setDataLoading(false);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  // Show 3 months from current offset
  const months = useMemo(() => {
    return [0, 1, 2].map((i) => {
      const d = addMonths(today, viewOffset + i);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, [viewOffset]);

  // Upcoming free periods (for list view)
  const upcomingFree = useMemo(() => {
    const todayStr = format(today, 'yyyy-MM-dd');
    return records
      .filter((r) => r.status === 'frei' && r.abreisedatum >= todayStr)
      .sort((a, b) => a.anreisedatum.localeCompare(b.anreisedatum))
      .slice(0, 6);
  }, [records]);

  if (loading) return <PublicShell loading unavailable={false} />;
  if (unavailable || !cfg || !page) return <PublicShell loading={false} unavailable />;

  const handleAnfrage = () => {
    navigate('/public/anfrage');
  };

  return (
    <PublicShell
      title={tx('Verfügbarkeit Ferienwohnung')}
      description={tx('Überblick über freie und belegte Zeiträume — ohne Anmeldung')}
      fullBleed
    >
      {/* Hero band */}
      <div className="bg-gradient-to-br from-sky-600 to-teal-500 text-white py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-white/20 rounded-full p-3">
              <IconCalendar size={32} stroke={1.5} />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">{tx('Ostsee Ferienwohnung')}</h1>
          <p className="text-sky-100 text-lg mb-1">{tx('Verfügbarkeitskalender')}</p>
          <p className="text-sky-200 text-sm">
            {tx('Mindestaufenthalt: 3 Nächte')}
          </p>
        </div>
      </div>

      {/* Legend + nav */}
      <div className="max-w-4xl mx-auto px-4 mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-emerald-100 border border-emerald-300 shrink-0" />
              <span className="text-slate-700">{tx('Frei')}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-red-100 border border-red-300 shrink-0" />
              <span className="text-slate-700">{tx('Belegt')}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-slate-100 border border-slate-200 shrink-0" />
              <span className="text-slate-700">{tx('Keine Angabe')}</span>
            </span>
          </div>

          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewOffset((o) => Math.max(o - 1, 0))}
              disabled={viewOffset === 0}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={tx('Vorheriger Monat')}
            >
              <IconChevronLeft size={16} className="shrink-0" />
            </button>
            <span className="text-sm text-slate-500 min-w-[80px] text-center">
              {tx('3 Monate')}
            </span>
            <button
              onClick={() => setViewOffset((o) => o + 1)}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              aria-label={tx('Nächster Monat')}
            >
              <IconChevronRight size={16} className="shrink-0" />
            </button>
          </div>
        </div>

        {/* Calendar grid */}
        {dataLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-white shadow-sm h-64 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {months.map((m) => (
              <CalendarMonth key={`${m.year}-${m.month}`} year={m.year} month={m.month} records={records} />
            ))}
          </div>
        )}

        {/* Upcoming free periods */}
        {upcomingFree.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">{tx('Nächste freie Zeiträume')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {upcomingFree.map((r) => {
                const start = r.anreisedatum ? parseISO(r.anreisedatum) : null;
                const end = r.abreisedatum ? parseISO(r.abreisedatum) : null;
                if (!start || !end) return null;
                const nights = Math.round(
                  (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
                );
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                  >
                    <IconCircleCheck size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium text-emerald-800 text-sm">
                        {format(start, 'd. MMM', { locale: de })}
                        {' – '}
                        {format(end, 'd. MMM yyyy', { locale: de })}
                      </p>
                      <p className="text-emerald-600 text-xs mt-0.5">
                        {tx`${nights} Nächte verfügbar`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-10 mb-12 rounded-2xl bg-gradient-to-br from-sky-50 to-teal-50 border border-sky-200 p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-sky-100 rounded-full p-3">
              <IconCalendar size={28} className="text-sky-600" stroke={1.5} />
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            {tx('Wunschtermin anfragen')}
          </h2>
          <p className="text-slate-600 text-sm mb-1">
            {tx('Mindestaufenthalt: 3 Nächte. Wir melden uns schnellstmöglich!')}
          </p>
          <p className="text-slate-500 text-xs mb-6">
            {tx('Die Buchung erfolgt auf Anfrage — kein sofortiger Kaufabschluss.')}
          </p>
          <button
            onClick={handleAnfrage}
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <IconCalendar size={16} className="shrink-0" />
            {tx('Anfrage stellen')}
          </button>
        </div>
      </div>
    </PublicShell>
  );
}
