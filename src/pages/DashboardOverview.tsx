import { useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { IconAlertTriangle, IconBed, IconCalendarEvent, IconChartBar, IconPlus } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import type { Belegungskalender, Buchungsanfrage } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { dateFnsLocale, tx } from '@/i18n';
import { gruss, namen, undoToast, useClock } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatCard, StatCardRow } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { CalendarWidget, useCalendar, type CalendarEvent } from '@/components/widgets/CalendarWidget';

const MIN_NIGHTS = 3;

type Filter = 'all' | 'belegt' | 'frei';

function guestName(r: Buchungsanfrage): string {
  return `${r.fields.vorname ?? ''} ${r.fields.nachname ?? ''}`.trim();
}

// Analyse: Belegungskalender (Zeiträume) + Buchungsanfragen → CalendarWidget (Monat) als Hauptfläche,
// split-Variante, Hero nur bei Anfragen auf bereits belegte Zeiträume; mobil rücken die Listen vor den Kalender.
export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { belegungskalender, buchungsanfrage, setBelegungskalender, fetchAll } = data;
  const clock = useClock();
  const cal = useCalendar({ initialView: 'month' });
  const [filter, setFilter] = useState<Filter>('all');
  const todayKey = format(clock, 'yyyy-MM-dd');

  // Belegte Zeiträume als schlanke Intervalle (Abreisetag ist wieder frei)
  const belegt = useMemo(() => belegungskalender.flatMap(b => {
    const a = b.fields.anreisedatum?.slice(0, 10);
    const e = b.fields.abreisedatum?.slice(0, 10);
    return lookupKey(b.fields.status) === 'belegt' && a && e ? [{ id: b.record_id, a, e }] : [];
  }), [belegungskalender]);

  const nightsOf = (a: string, e: string) => differenceInCalendarDays(parseISO(e), parseISO(a));

  // Offene Anfragen: zukünftig und noch nicht als Belegung eingetragen
  const openRequests = useMemo(() => buchungsanfrage
    .flatMap(r => {
      const a = r.fields.wunsch_anreise?.slice(0, 10);
      const e = r.fields.wunsch_abreise?.slice(0, 10);
      if (!a || !e || e < todayKey) return [];
      if (belegt.some(b => b.a === a && b.e === e)) return [];
      const n = nightsOf(a, e);
      return [{
        r, a, e, n,
        short: n < MIN_NIGHTS,
        conflict: belegt.some(b => a < b.e && b.a < e),
      }];
    })
    .sort((x, y) => (y.r.createdat ?? '').localeCompare(x.r.createdat ?? '')),
  [buchungsanfrage, belegt, todayKey]);

  const conflicts = openRequests.filter(x => x.conflict);

  const upcomingStays = useMemo(() => belegt
    .filter(b => b.a >= todayKey)
    .sort((x, y) => (x.a ?? '').localeCompare(y.a ?? '')), [belegt, todayKey]);

  const upcomingFree = belegungskalender.filter(b =>
    lookupKey(b.fields.status) === 'frei' && (b.fields.abreisedatum ?? '') >= todayKey).length;

  const occupancy = useMemo(() => {
    const start = startOfDay(clock);
    let occupied = 0;
    for (let i = 0; i < 90; i++) {
      const day = format(addDays(start, i), 'yyyy-MM-dd');
      if (belegt.some(b => b.a <= day && day < b.e)) occupied++;
    }
    return Math.round((occupied / 90) * 100);
  }, [belegt, clock]);

  // Gemeinsamer Schreibpfad: Anfrage → belegter Zeitraum (Hero-frei, Liste, Overlay-Footer)
  const acceptRequest = async (r: Buchungsanfrage) => {
    const a = r.fields.wunsch_anreise?.slice(0, 10);
    const e = r.fields.wunsch_abreise?.slice(0, 10);
    if (!a || !e) return;
    const name = guestName(r);
    const res = await LivingAppsService.createBelegungskalenderEntry({
      anreisedatum: a,
      abreisedatum: e,
      status: 'belegt',
      interne_notiz: `Anfrage von ${name}`, // i18n-exempt
    });
    await fetchAll();
    undoToast(tx`${name} — Zeitraum als belegt eingetragen`, async () => {
      await LivingAppsService.deleteBelegungskalenderEntry(res.record_id);
      await fetchAll();
    });
  };

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'buchungsanfrage') return undefined;
      const hit = openRequests.find(x => x.r.record_id === top.record.record_id);
      if (!hit || hit.short || hit.conflict) return undefined;
      return { label: tx('Als belegt eintragen'), onClick: () => void acceptRequest(hit.r) };
    },
  });

  const events = useMemo<CalendarEvent[]>(() => belegungskalender.flatMap(b => {
    const key = lookupKey(b.fields.status);
    const a = b.fields.anreisedatum;
    if (!a || (filter !== 'all' && key !== filter)) return [];
    const e = b.fields.abreisedatum;
    return [{
      id: `belegung:${b.record_id}`,
      start: a,
      end: e,
      allDay: true,
      title: b.fields.status?.label ?? '',
      subtitle: e ? tx`${nightsOf(a.slice(0, 10), e.slice(0, 10))} Nächte` : undefined,
      tone: key === 'belegt' ? 'primary' as const : 'success' as const,
    }];
  }), [belegungskalender, filter]);

  const recordOf = (ev: CalendarEvent): Belegungskalender | undefined =>
    belegungskalender.find(b => b.record_id === ev.id.split(':')[1]);

  const moveEntry = (eventId: string, newStart: string, newEnd?: string): string | void => {
    const id = eventId.split(':')[1];
    const rec = belegungskalender.find(b => b.record_id === id);
    if (!rec) return;
    const a = newStart.slice(0, 10);
    const e = (newEnd ?? rec.fields.abreisedatum ?? newStart).slice(0, 10);
    if (lookupKey(rec.fields.status) === 'belegt' && belegt.some(b => b.id !== id && a < b.e && b.a < e)) {
      return tx('Dieser Zeitraum überschneidet sich mit einer anderen Belegung.');
    }
    const before = { anreisedatum: rec.fields.anreisedatum, abreisedatum: rec.fields.abreisedatum };
    setBelegungskalender(prev => prev.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, anreisedatum: a, abreisedatum: e } } : b));
    LivingAppsService.updateBelegungskalenderEntry(id, { anreisedatum: a, abreisedatum: e })
      .catch(() => void fetchAll());
    undoToast(tx`Zeitraum verschoben`, () => {
      setBelegungskalender(prev => prev.map(b => b.record_id === id
        ? { ...b, fields: { ...b.fields, ...before } } : b));
      LivingAppsService.updateBelegungskalenderEntry(id, before).catch(() => void fetchAll());
    });
  };

  const openCreate = () => crud.belegungskalender.openCreate({ status: 'belegt' });
  const openRequest = (id: string) => {
    const rec = buchungsanfrage.find(r => r.record_id === id);
    if (rec) crud.buchungsanfrage.openDetail(rec);
  };

  const isEmpty = belegungskalender.length === 0 && buchungsanfrage.length === 0;
  const nextStay = upcomingStays[0];

  let context: string;
  if (openRequests.length > 0) {
    const names = namen(openRequests.map(x => guestName(x.r)).filter(Boolean));
    context = tx`Neue Anfragen von ${names} warten auf deine Antwort.`;
  } else if (nextStay) {
    const d = formatDate(nextStay.a);
    context = tx`Keine offenen Anfragen — nächste Anreise am ${d}.`;
  } else {
    context = tx`Keine offenen Anfragen und keine anstehende Anreise — die Wohnung ist frei.`;
  }

  const hero = isEmpty ? (
    <HeroBanner
      tone="primary"
      icon={<IconBed size={48} />}
      action={{ label: tx('Ersten Zeitraum eintragen'), onClick: openCreate }}
    >
      {tx('Richte deinen Belegungskalender ein: Trage ein, wann die Wohnung belegt oder frei ist.')}
    </HeroBanner>
  ) : conflicts.length > 0 ? (
    <HeroBanner
      icon={<IconAlertTriangle size={18} />}
      action={{ label: tx('Anfrage ansehen'), onClick: () => crud.buchungsanfrage.openDetail(conflicts[0].r) }}
    >
      <b>{namen(conflicts.map(x => guestName(x.r)).filter(Boolean))}</b>{' '}
      {conflicts.length === 1
        ? tx('hat einen bereits belegten Zeitraum angefragt.')
        : tx('haben bereits belegte Zeiträume angefragt.')}
    </HeroBanner>
  ) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <IconPlus size={16} className="shrink-0" />
          <span>{tx('Zeitraum eintragen')}</span>
        </Button>
      </div>

      <DashboardGrid
        variant="split"
        hero={hero}
        kpis={isEmpty ? undefined : (
          <StatCardRow>
            <StatCard
              title={tx('Belegt')}
              value={upcomingStays.length}
              description={tx('Anstehende belegte Zeiträume')}
              icon={<IconCalendarEvent size={18} className="text-muted-foreground" />}
              onClick={() => setFilter(f => (f === 'belegt' ? 'all' : 'belegt'))}
              active={filter === 'belegt'}
            />
            {upcomingFree > 0 && (
              <StatCard
                title={tx('Frei')}
                value={upcomingFree}
                description={tx('Als frei markierte Zeiträume')}
                icon={<IconBed size={18} className="text-muted-foreground" />}
                tone="success"
                onClick={() => setFilter(f => (f === 'frei' ? 'all' : 'frei'))}
                active={filter === 'frei'}
              />
            )}
            <StatCard
              title={tx('Auslastung')}
              value={`${occupancy} %`}
              description={tx('der nächsten 90 Nächte')}
              icon={<IconChartBar size={18} className="text-muted-foreground" />}
              footer={(
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${occupancy}%` }} />
                </div>
              )}
            />
          </StatCardRow>
        )}
        aside={(
          <>
            <WorkList
              title={tx('Neue Anfragen')}
              items={openRequests.map(x => ({
                id: x.r.record_id,
                title: guestName(x.r) || tx('Gast'),
                secondLine: (
                  <>
                    <span className="font-medium">
                      {x.short ? tx('Unter 3 Nächten') : x.conflict ? tx('Zeitraum belegt') : tx('Zeitraum frei')}
                    </span>
                    <span className="text-muted-foreground">
                      {' · '}{formatDate(x.a)} – {formatDate(x.e)}
                    </span>
                  </>
                ),
                action: x.short || x.conflict
                  ? undefined
                  : { label: tx('Eintragen'), onClick: () => void acceptRequest(x.r) },
              }))}
              onItemClick={openRequest}
              empty={{
                text: nextStay
                  ? tx`Keine offenen Anfragen — nächste Anreise am ${formatDate(nextStay.a)}`
                  : tx('Keine offenen Anfragen.'),
                action: { label: tx('Zeitraum eintragen'), onClick: openCreate },
              }}
            />
            <WorkList
              title={tx('Anstehende Anreisen')}
              items={upcomingStays.map(s => {
                const days = differenceInCalendarDays(parseISO(s.a), startOfDay(clock));
                return {
                  id: s.id,
                  title: days === 0 ? tx('Heute') : days === 1 ? tx('Morgen') : tx`In ${days} Tagen`,
                  secondLine: (
                    <span className="text-muted-foreground">
                      {formatDate(s.a)} – {formatDate(s.e)} · {tx`${nightsOf(s.a, s.e)} Nächte`}
                    </span>
                  ),
                };
              })}
              onItemClick={id => {
                const rec = belegungskalender.find(b => b.record_id === id);
                if (rec) crud.belegungskalender.openDetail(rec);
              }}
              empty={{ text: tx('Keine anstehenden Anreisen.') }}
            />
          </>
        )}
        primary={(
          <CalendarWidget
            events={events}
            view={cal.view}
            referenceDate={cal.cursor}
            locale={dateFnsLocale()}
            onViewChange={cal.setView}
            onCursorChange={cal.setCursor}
            onEventClick={ev => {
              const rec = recordOf(ev);
              if (rec) crud.belegungskalender.openDetail(rec);
            }}
            onEventDrop={moveEntry}
            onRangeCreate={(start, end) => crud.belegungskalender.openCreate({
              anreisedatum: format(start, 'yyyy-MM-dd'),
              abreisedatum: format(end, 'yyyy-MM-dd'),
              status: 'belegt',
            })}
          />
        )}
      />
      {crud.surfaces}
    </div>
  );
}
