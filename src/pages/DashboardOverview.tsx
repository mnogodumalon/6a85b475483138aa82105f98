import { useMemo } from 'react';
import { format, parseISO, differenceInCalendarDays, addDays, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { IconPlus, IconInbox, IconCalendarEvent } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import type { Belegungskalender, Buchungsanfrage } from '@/types/app';
import { lookupOption } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { tx, dateFnsLocale } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { CalendarWidget, type CalendarEvent } from '@/components/widgets/CalendarWidget';

const MIN_NIGHTS = 3;

const nightsOf = (from?: string, to?: string) =>
  from && to ? differenceInCalendarDays(parseISO(to), parseISO(from)) : 0;

// Turnover day allowed: a stay may start on the day another one ends.
const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string) =>
  aFrom < bTo && bFrom < aTo;

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { belegungskalender, buchungsanfrage, setBelegungskalender, fetchAll } = data;
  const clock = useClock();
  const today = format(clock, 'yyyy-MM-dd');

  const guestName = (a: Buchungsanfrage) =>
    [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('Gast');

  const belegt = useMemo(
    () => belegungskalender.filter(b => lookupKey(b.fields.status) === 'belegt' && b.fields.anreisedatum && b.fields.abreisedatum),
    [belegungskalender],
  );

  // Rule at every write choke point: min. 3 nights + no double booking.
  const ruleViolation = (from: string, to: string, ignoreId?: string): string | null => {
    if (nightsOf(from, to) < MIN_NIGHTS) return tx`Mindestaufenthalt: ${MIN_NIGHTS} Nächte`;
    const clash = belegt.find(b =>
      b.record_id !== ignoreId && overlaps(from, to, b.fields.anreisedatum!, b.fields.abreisedatum!));
    return clash ? tx`Zeitraum überschneidet sich mit einer Belegung (${formatDate(clash.fields.anreisedatum)} – ${formatDate(clash.fields.abreisedatum)})` : null;
  };

  // A request counts as answered once a Belegung with the same dates exists.
  const offeneAnfragen = useMemo(() =>
    buchungsanfrage
      .filter(a => a.fields.wunsch_anreise && a.fields.wunsch_abreise
        && !belegt.some(b => b.fields.anreisedatum === a.fields.wunsch_anreise && b.fields.abreisedatum === a.fields.wunsch_abreise))
      .sort((x, y) => (x.createdat < y.createdat ? 1 : -1)),
    [buchungsanfrage, belegt]);

  const kommende = useMemo(() =>
    belegt.filter(b => b.fields.abreisedatum! >= today)
      .sort((x, y) => x.fields.anreisedatum!.localeCompare(y.fields.anreisedatum!)),
    [belegt, today]);

  const naechsteAnreise = kommende.find(b => b.fields.anreisedatum! >= today);

  const auslastung = useMemo(() => {
    const start = startOfDay(clock);
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const d = format(addDays(start, i), 'yyyy-MM-dd');
      if (belegt.some(b => b.fields.anreisedatum! <= d && d < b.fields.abreisedatum!)) n++;
    }
    return Math.round((n / 90) * 100);
  }, [belegt, clock]);

  // Shared write path: accept a request = create the matching Belegung (hero-less, list + overlay footer).
  const accept = async (a: Buchungsanfrage) => {
    const from = a.fields.wunsch_anreise!;
    const to = a.fields.wunsch_abreise!;
    const msg = ruleViolation(from, to);
    if (msg) { toast.error(msg); crud.buchungsanfrage.openDetail(a); return; }
    try {
      const res = await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: from, abreisedatum: to, status: 'belegt',
        interne_notiz: tx`Anfrage von ${guestName(a)}`,
      });
      setBelegungskalender(prev => [...prev, {
        record_id: res.record_id, created_at: format(clock, "yyyy-MM-dd'T'HH:mm"), updated_at: null,
        createdat: format(clock, "yyyy-MM-dd'T'HH:mm"), updatedat: null,
        fields: { anreisedatum: from, abreisedatum: to, status: lookupOption('belegungskalender', 'status', 'belegt'), interne_notiz: tx`Anfrage von ${guestName(a)}` },
      }]);
      undoToast(tx`${guestName(a)} — als belegt eingetragen`, () => {
        setBelegungskalender(prev => prev.filter(b => b.record_id !== res.record_id));
        LivingAppsService.deleteBelegungskalenderEntry(res.record_id).catch(() => fetchAll());
      });
    } catch { fetchAll(); }
  };

  const markBelegt = (b: Belegungskalender) => {
    const msg = ruleViolation(b.fields.anreisedatum!, b.fields.abreisedatum!, b.record_id);
    if (msg) { toast.error(msg); return; }
    const prevStatus = b.fields.status;
    const set = (s: typeof prevStatus) =>
      setBelegungskalender(prev => prev.map(r => r.record_id === b.record_id ? { ...r, fields: { ...r.fields, status: s } } : r));
    set(lookupOption('belegungskalender', 'status', 'belegt'));
    LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: 'belegt' }).catch(() => fetchAll());
    undoToast(tx`Zeitraum als belegt markiert`, () => {
      set(prevStatus);
      LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: prevStatus?.key ?? 'frei' }).catch(() => fetchAll());
    });
  };

  const crud = useEntityCrud(data, {
    footer: top => {
      if (top.type === 'buchungsanfrage') {
        const a = top.record;
        return offeneAnfragen.some(o => o.record_id === a.record_id)
          ? { label: tx('Anfrage annehmen & Zeitraum belegen'), onClick: () => accept(a) } : undefined;
      }
      if (top.type === 'belegungskalender') {
        const b = top.record;
        return lookupKey(b.fields.status) === 'frei'
          ? { label: tx('Als belegt markieren'), onClick: () => markBelegt(b) } : undefined;
      }
      return undefined;
    },
  });

  const events = useMemo<CalendarEvent[]>(() => {
    const bel: CalendarEvent[] = belegungskalender
      .filter(b => b.fields.anreisedatum && b.fields.abreisedatum)
      .map(b => ({
        id: `belegung:${b.record_id}`,
        start: b.fields.anreisedatum!, end: b.fields.abreisedatum, allDay: true,
        title: b.fields.status?.label ?? tx('Belegt'),
        subtitle: b.fields.interne_notiz,
        tone: lookupKey(b.fields.status) === 'belegt' ? 'primary' : 'success',
      }));
    const anf: CalendarEvent[] = offeneAnfragen.map(a => ({
      id: `anfrage:${a.record_id}`,
      start: a.fields.wunsch_anreise!, end: a.fields.wunsch_abreise, allDay: true,
      title: tx`Anfrage: ${a.fields.nachname ?? ''}`,
      subtitle: tx`${a.fields.anzahl_personen ?? 1} Pers.`,
      tone: 'warning',
    }));
    return [...bel, ...anf];
  }, [belegungskalender, offeneAnfragen]);

  const idOf = (ev: { id: string }) => ev.id.split(':')[1] ?? '';

  const move = (eventId: string, newStart: string, newEnd?: string): string | void => {
    const [kind, rid] = eventId.split(':');
    if (kind !== 'belegung') return tx('Anfragen bearbeitest du über die Liste oder die Detailansicht.');
    const rec = belegungskalender.find(b => b.record_id === rid);
    if (!rec) return;
    const from = newStart.slice(0, 10);
    const to = (newEnd ?? rec.fields.abreisedatum ?? newStart).slice(0, 10);
    if (lookupKey(rec.fields.status) === 'belegt') {
      const msg = ruleViolation(from, to, rid);
      if (msg) return msg;
    }
    const snapshot = { anreisedatum: rec.fields.anreisedatum, abreisedatum: rec.fields.abreisedatum };
    const apply = (f: { anreisedatum?: string; abreisedatum?: string }) =>
      setBelegungskalender(prev => prev.map(r => r.record_id === rid ? { ...r, fields: { ...r.fields, ...f } } : r));
    apply({ anreisedatum: from, abreisedatum: to });
    LivingAppsService.updateBelegungskalenderEntry(rid, { anreisedatum: from, abreisedatum: to }).catch(() => fetchAll());
    undoToast(tx`Zeitraum verschoben`, () => {
      apply(snapshot);
      LivingAppsService.updateBelegungskalenderEntry(rid, snapshot).catch(() => fetchAll());
    });
  };

  const ersteAnfrage = offeneAnfragen[0];
  const kontext = offeneAnfragen.length > 0
    ? tx`Neue Anfragen von ${namen(offeneAnfragen.map(a => a.fields.vorname ?? a.fields.nachname ?? ''))} warten auf deine Antwort.`
    : naechsteAnreise
      ? tx`Keine offenen Anfragen — nächste Anreise am ${format(parseISO(naechsteAnreise.fields.anreisedatum!), 'EEEE, d. MMMM', { locale: dateFnsLocale() })}.`
      : tx`Keine offenen Anfragen und aktuell keine kommende Belegung eingetragen.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{kontext}</p>
        </div>
        <Button
          onClick={() => crud.belegungskalender.openCreate({ status: 'belegt' })}
          className="w-full sm:w-auto"
        >
          <IconPlus size={16} className="shrink-0" />
          {tx('Zeitraum eintragen')}
        </Button>
      </div>

      <DashboardGrid
        variant="split"
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Offene Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconInbox size={16} />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={ersteAnfrage ? () => crud.buchungsanfrage.openDetail(ersteAnfrage) : undefined}
            />
            <StatStripItem
              title={tx('Nächste Anreise')}
              value={naechsteAnreise ? formatDate(naechsteAnreise.fields.anreisedatum) : tx('offen')}
              icon={<IconCalendarEvent size={16} />}
              onClick={naechsteAnreise ? () => crud.belegungskalender.openDetail(naechsteAnreise) : undefined}
            />
            <StatStripItem
              title={tx('Belegt, nächste 90 Tage')}
              value={`${auslastung} %`}
              tone={auslastung >= 70 ? 'success' : 'default'}
            />
          </StatStrip>
        }
        aside={
          <>
            <WorkList
              title={tx('Neue Anfragen')}
              icon={<IconInbox size={14} />}
              items={offeneAnfragen.map(a => {
                const from = a.fields.wunsch_anreise!;
                const to = a.fields.wunsch_abreise!;
                const problem = ruleViolation(from, to);
                return {
                  id: a.record_id,
                  title: guestName(a),
                  secondLine: (
                    <>
                      <span className={problem ? 'font-medium text-destructive' : 'font-medium text-amber-600'}>
                        {problem ? tx('Passt nicht') : tx('Frei')}
                      </span>
                      <span className="text-muted-foreground"> · {formatDate(from)} – {formatDate(to)} · {nightsOf(from, to)} {tx('Nächte')}</span>
                    </>
                  ),
                  action: problem ? undefined : { label: tx('✓ Annehmen'), onClick: () => accept(a) },
                };
              })}
              onItemClick={id => {
                const a = buchungsanfrage.find(r => r.record_id === id);
                if (a) crud.buchungsanfrage.openDetail(a);
              }}
              empty={{
                text: naechsteAnreise
                  ? tx`Keine offenen Anfragen — nächste Anreise am ${formatDate(naechsteAnreise.fields.anreisedatum)}`
                  : tx('Keine offenen Anfragen.'),
              }}
            />
            <WorkList
              title={tx('Kommende Belegungen')}
              icon={<IconCalendarEvent size={14} />}
              items={kommende.map(b => ({
                id: b.record_id,
                title: `${formatDate(b.fields.anreisedatum)} – ${formatDate(b.fields.abreisedatum)}`,
                secondLine: (
                  <>
                    <span className="font-medium text-primary">
                      {b.fields.anreisedatum! <= today ? tx('Aktuell belegt') : tx`in ${differenceInCalendarDays(parseISO(b.fields.anreisedatum!), clock)} Tagen`}
                    </span>
                    <span className="text-muted-foreground"> · {nightsOf(b.fields.anreisedatum, b.fields.abreisedatum)} {tx('Nächte')}</span>
                  </>
                ),
              }))}
              onItemClick={id => {
                const b = belegungskalender.find(r => r.record_id === id);
                if (b) crud.belegungskalender.openDetail(b);
              }}
              empty={{
                text: tx('Noch keine kommende Belegung eingetragen.'),
                action: { label: tx('Zeitraum eintragen'), onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }) },
              }}
            />
          </>
        }
        primary={
          <CalendarWidget
            events={events}
            locale={dateFnsLocale()}
            defaultView="month"
            onEventClick={ev => {
              if (ev.id.startsWith('anfrage:')) {
                const a = buchungsanfrage.find(r => r.record_id === idOf(ev));
                if (a) crud.buchungsanfrage.openDetail(a);
              } else {
                const b = belegungskalender.find(r => r.record_id === idOf(ev));
                if (b) crud.belegungskalender.openDetail(b);
              }
            }}
            onEventDrop={move}
            onEventResize={move}
            onRangeCreate={(start, end) => {
              const from = format(start, 'yyyy-MM-dd');
              const to = format(end, 'yyyy-MM-dd');
              const msg = ruleViolation(from, to);
              if (msg) { toast.error(msg); return; }
              crud.belegungskalender.openCreate({ anreisedatum: from, abreisedatum: to, status: 'belegt' });
            }}
          />
        }
      />
      {crud.surfaces}
    </div>
  );
}
