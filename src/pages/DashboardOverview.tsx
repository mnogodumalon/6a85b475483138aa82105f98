import { useMemo } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { IconCalendarPlus, IconCheck, IconCalendarEvent, IconBeach } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import type { Belegungskalender, Buchungsanfrage } from '@/types/app';
import { lookupOption } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { dateFnsLocale, tx } from '@/i18n';
import { gruss, namen, undoToast, useClock } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatCard, StatCardRow } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { CalendarWidget, type CalendarEvent } from '@/components/widgets/CalendarWidget';

const MIN_NIGHTS = 3;
const DAY = 'yyyy-MM-dd';

type Stay = { id: string; start: string; end: string };
type RequestState = 'offen' | 'konflikt' | 'bestaetigt';

function nightsBetween(start: string, end: string) {
  return differenceInCalendarDays(parseISO(end), parseISO(start));
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start < b.end && b.start < a.end;
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { belegungskalender, buchungsanfrage, setBelegungskalender, fetchAll } = data;
  const clock = useClock();
  const today = format(clock, DAY);

  // belegte Zeiträume (nur "belegt" blockiert den Kalender)
  const stays = useMemo<Stay[]>(
    () => belegungskalender
      .filter(b => lookupKey(b.fields.status) === 'belegt' && b.fields.anreisedatum && b.fields.abreisedatum)
      .map(b => ({ id: b.record_id, start: b.fields.anreisedatum!, end: b.fields.abreisedatum! })),
    [belegungskalender],
  );

  // ONE rule check for every write path (drag, resize, drag-create, accept)
  const ruleViolation = (start: string, end: string, ignoreId?: string): string | null => {
    if (nightsBetween(start, end) < MIN_NIGHTS) return tx`Mindestaufenthalt sind ${MIN_NIGHTS} Nächte.`;
    const clash = stays.find(s => s.id !== ignoreId && overlaps({ start, end }, s));
    if (clash) return tx`Der Zeitraum überschneidet sich mit einer Belegung (${formatDate(clash.start)} – ${formatDate(clash.end)}).`;
    return null;
  };

  const requests = useMemo(() => {
    return buchungsanfrage
      .filter(a => a.fields.wunsch_anreise && a.fields.wunsch_abreise && a.fields.wunsch_abreise >= today)
      .map(a => {
        const start = a.fields.wunsch_anreise!;
        const end = a.fields.wunsch_abreise!;
        const confirmed = stays.some(s => s.start === start && s.end === end);
        const conflict = nightsBetween(start, end) < MIN_NIGHTS || stays.some(s => overlaps({ start, end }, s));
        const state: RequestState = confirmed ? 'bestaetigt' : conflict ? 'konflikt' : 'offen';
        const name = `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || tx('Anfrage');
        return { rec: a, start, end, state, name };
      })
      .sort((x, y) => String(x.rec.createdat ?? '').localeCompare(String(y.rec.createdat ?? '')));
  }, [buchungsanfrage, stays, today]);

  const pending = requests.filter(r => r.state !== 'bestaetigt');
  const openOnes = requests.filter(r => r.state === 'offen');

  // Annehmen = Zeitraum als "belegt" eintragen (shared by list action + overlay footer)
  const accept = async (a: Buchungsanfrage) => {
    const start = a.fields.wunsch_anreise;
    const end = a.fields.wunsch_abreise;
    if (!start || !end) return;
    const violation = ruleViolation(start, end);
    if (violation) { toast.error(violation); return; }
    const name = `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim();
    try {
      const res = await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: start,
        abreisedatum: end,
        status: 'belegt',
        interne_notiz: name ? tx`Anfrage von ${name}` : undefined,
      });
      await fetchAll();
      undoToast(tx`${formatDate(start)} – ${formatDate(end)} als belegt eingetragen`, () => {
        void LivingAppsService.deleteBelegungskalenderEntry(res.record_id).then(() => fetchAll());
      });
    } catch {
      await fetchAll();
    }
  };

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'buchungsanfrage') return undefined;
      const rec = top.record as unknown as Buchungsanfrage;
      const r = requests.find(x => x.rec.record_id === rec.record_id);
      if (!r || r.state !== 'offen') return undefined;
      return { label: tx('Annehmen & als belegt eintragen'), onClick: () => { void accept(rec); } };
    },
  });

  // Freie Zeiträume (≥ Mindestaufenthalt) in den nächsten 120 Tagen
  const gaps = useMemo(() => {
    const horizon = format(addDays(parseISO(today), 120), DAY);
    const sorted = stays.filter(s => s.end > today).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const out: { start: string; end: string; open: boolean }[] = [];
    let cur = today;
    for (const s of sorted) {
      if (s.start > cur && nightsBetween(cur, s.start) >= MIN_NIGHTS) out.push({ start: cur, end: s.start, open: false });
      if (s.end > cur) cur = s.end;
    }
    if (cur < horizon) out.push({ start: cur, end: horizon, open: true });
    return out;
  }, [stays, today]);

  // Auslastung der nächsten 90 Nächte
  const occupancy = useMemo(() => {
    const occupied = new Set<string>();
    for (const s of stays) {
      for (let d = parseISO(s.start); format(d, DAY) < s.end; d = addDays(d, 1)) occupied.add(format(d, DAY));
    }
    let n = 0;
    for (let i = 0; i < 90; i++) if (occupied.has(format(addDays(parseISO(today), i), DAY))) n++;
    return { nights: n, pct: Math.round((n / 90) * 100) };
  }, [stays, today]);

  const nextArrival = useMemo(
    () => belegungskalender
      .filter(b => lookupKey(b.fields.status) === 'belegt' && b.fields.anreisedatum && b.fields.anreisedatum >= today)
      .sort((a, b) => a.fields.anreisedatum!.localeCompare(b.fields.anreisedatum!))[0],
    [belegungskalender, today],
  );

  const events = useMemo<CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const b of belegungskalender) {
      if (!b.fields.anreisedatum || !b.fields.abreisedatum) continue;
      const belegt = lookupKey(b.fields.status) === 'belegt';
      out.push({
        id: `bk:${b.record_id}`,
        start: b.fields.anreisedatum,
        end: b.fields.abreisedatum,
        allDay: true,
        title: belegt ? tx('Belegt') : tx('Frei'),
        tone: belegt ? 'primary' : 'success',
      });
    }
    for (const r of pending) {
      out.push({
        id: `ba:${r.rec.record_id}`,
        start: r.start,
        end: r.end,
        allDay: true,
        title: r.name,
        subtitle: r.state === 'konflikt' ? tx('Anfrage – Konflikt') : tx('Anfrage'),
        tone: r.state === 'konflikt' ? 'destructive' : 'warning',
      });
    }
    return out;
  }, [belegungskalender, pending]);

  const findStay = (id: string): Belegungskalender | undefined => belegungskalender.find(b => b.record_id === id);

  // drag / resize of a Belegung: rule first (return reason), optimistic, PATCH, undo
  const moveStay = (eventId: string, newStart: string, newEnd?: string): string | void => {
    const [kind, id] = eventId.split(':');
    if (kind !== 'bk') return tx('Anfragen lassen sich nur annehmen, nicht verschieben.');
    const before = findStay(id);
    if (!before || !newEnd) return;
    const start = newStart.slice(0, 10);
    const end = newEnd.slice(0, 10);
    if (lookupKey(before.fields.status) === 'belegt') {
      const violation = ruleViolation(start, end, id);
      if (violation) return violation;
    }
    const prev = { anreisedatum: before.fields.anreisedatum, abreisedatum: before.fields.abreisedatum };
    setBelegungskalender(list => list.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, anreisedatum: start, abreisedatum: end } } : b));
    LivingAppsService.updateBelegungskalenderEntry(id, { anreisedatum: start, abreisedatum: end })
      .then(() => undoToast(tx`Zeitraum verschoben: ${formatDate(start)} – ${formatDate(end)}`, () => {
        setBelegungskalender(list => list.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, ...prev } } : b));
        LivingAppsService.updateBelegungskalenderEntry(id, prev).catch(() => fetchAll());
      }))
      .catch(() => fetchAll());
  };

  const nameList = openOnes.map(r => r.name);
  const context = openOnes.length > 0
    ? tx`${namen(nameList)} wartet auf deine Antwort.`
    : pending.length > 0
      ? tx`${namen(pending.map(r => r.name))}: Der Wunschzeitraum passt nicht zur Belegung.`
      : nextArrival
        ? tx`Keine offenen Anfragen — nächste Anreise am ${formatDate(nextArrival.fields.anreisedatum)}.`
        : tx`Keine offenen Anfragen und aktuell keine kommende Belegung.`;

  const statusWord = (s: RequestState) => s === 'konflikt'
    ? <span className="font-medium text-destructive">{tx('Passt nicht')}</span>
    : <span className="font-medium text-amber-600">{tx('Neu')}</span>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        <button
          type="button"
          onClick={() => crud.belegungskalender.openCreate({ status: 'belegt' })}
          className="inline-flex items-center gap-2 min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconCalendarPlus size={16} className="shrink-0" />
          {tx('Belegung eintragen')}
        </button>
      </div>

      <DashboardGrid
        variant="split"
        kpis={
          <StatCardRow>
            <StatCard
              title={tx('Auslastung (90 Tage)')}
              value={`${occupancy.pct} %`}
              description={tx`${occupancy.nights} von 90 Nächten belegt`}
              icon={<IconBeach size={18} className="text-muted-foreground" />}
              tone={occupancy.pct >= 80 ? 'success' : 'default'}
            />
            <StatCard
              title={tx('Nächste Anreise')}
              value={nextArrival ? formatDate(nextArrival.fields.anreisedatum) : tx('keine')}
              description={nextArrival ? tx`bis ${formatDate(nextArrival.fields.abreisedatum)}` : tx('Alles frei')}
              icon={<IconCalendarEvent size={18} className="text-muted-foreground" />}
              onClick={nextArrival ? () => crud.belegungskalender.openDetail(nextArrival) : undefined}
            />
          </StatCardRow>
        }
        aside={
          <>
            <WorkList
              title={tx('Anfragen prüfen')}
              items={pending.map(r => ({
                id: r.rec.record_id,
                title: r.name,
                secondLine: (
                  <>
                    {statusWord(r.state)}
                    <span className="text-muted-foreground"> · {formatDate(r.start)} – {formatDate(r.end)} · {nightsBetween(r.start, r.end)} {tx('Nächte')}</span>
                  </>
                ),
                action: r.state === 'offen'
                  ? { label: <><IconCheck size={14} className="inline shrink-0" /> {tx('Annehmen')}</>, onClick: () => { void accept(r.rec); } }
                  : undefined,
              }))}
              onItemClick={id => {
                const rec = buchungsanfrage.find(a => a.record_id === id);
                if (rec) crud.buchungsanfrage.openDetail(rec);
              }}
              empty={{
                text: nextArrival
                  ? tx`Keine offenen Anfragen — nächste Anreise am ${formatDate(nextArrival.fields.anreisedatum)}.`
                  : tx('Keine offenen Anfragen.'),
              }}
            />
            <WorkList
              title={tx('Freie Zeiträume')}
              items={gaps.map(g => ({
                id: g.start,
                title: g.open ? tx`ab ${formatDate(g.start)}` : `${formatDate(g.start)} – ${formatDate(g.end)}`,
                secondLine: <span className="text-muted-foreground">{g.open ? tx('frei in den nächsten Monaten') : tx`${nightsBetween(g.start, g.end)} Nächte frei`}</span>,
                action: {
                  label: tx('Belegen'),
                  onClick: () => crud.belegungskalender.openCreate({
                    anreisedatum: g.start,
                    abreisedatum: g.open ? format(addDays(parseISO(g.start), MIN_NIGHTS), DAY) : g.end,
                    status: 'belegt',
                  }),
                },
              }))}
              onItemClick={id => {
                const g = gaps.find(x => x.start === id);
                if (g) crud.belegungskalender.openCreate({
                  anreisedatum: g.start,
                  abreisedatum: g.open ? format(addDays(parseISO(g.start), MIN_NIGHTS), DAY) : g.end,
                  status: 'belegt',
                });
              }}
              empty={{ text: tx('Aktuell ist alles belegt.') }}
            />
          </>
        }
        primary={
          <CalendarWidget
            events={events}
            defaultView="month"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const [kind, id] = ev.id.split(':');
              if (kind === 'bk') {
                const rec = belegungskalender.find(b => b.record_id === id);
                if (rec) crud.belegungskalender.openDetail(rec);
              } else {
                const rec = buchungsanfrage.find(a => a.record_id === id);
                if (rec) crud.buchungsanfrage.openDetail(rec);
              }
            }}
            onEventDrop={moveStay}
            onEventResize={moveStay}
            onRangeCreate={(start, end) => {
              const s = format(start, DAY);
              const e = format(end, DAY);
              const violation = ruleViolation(s, e);
              if (violation) { toast.error(violation); return; }
              crud.belegungskalender.openCreate({
                anreisedatum: s,
                abreisedatum: e,
                status: lookupOption('belegungskalender', 'status', 'belegt').key,
              });
            }}
          />
        }
      />
      {crud.surfaces}
    </div>
  );
}
