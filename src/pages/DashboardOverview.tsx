import { useMemo, useState } from 'react';
import { format, parseISO, isAfter, isBefore, startOfDay, addDays, differenceInCalendarDays } from 'date-fns';
import { IconCalendar, IconInbox, IconCheck, IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { CalendarWidget, type CalendarEvent, type CalendarTone } from '@/components/widgets/CalendarWidget';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupOption } from '@/types/app';
import { tx, appLabel } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { dateFnsLocale } from '@/i18n';
import type { Belegungskalender } from '@/types/app';

export default function DashboardOverview() {
  const data = useDashboardData();
  const { belegungskalender, setBelegungskalender, buchungsanfrage, loading, error, fetchAll } = data;

  const clock = useClock();
  const [filterStatus, setFilterStatus] = useState<'alle' | 'anfragen'>('alle');

  // ─── Derived values needed by hooks (before early-returns) ───
  const today = startOfDay(clock);
  const todayStr = format(today, 'yyyy-MM-dd');

  const belegtEintraege = useMemo(
    () => belegungskalender.filter(b => b.fields.status?.key === 'belegt'),
    [belegungskalender]
  );

  const offeneAnfragen = useMemo(
    () => buchungsanfrage
      .filter(r => {
        if (!r.fields.wunsch_anreise) return false;
        return isAfter(parseISO(r.fields.wunsch_anreise), addDays(today, -1));
      })
      .sort((a, b) => (a.fields.wunsch_anreise ?? '').localeCompare(b.fields.wunsch_anreise ?? '')),
    [buchungsanfrage, today]
  );

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungsanfrage') {
        const req = buchungsanfrage.find(r => r.record_id === top.record.record_id);
        if (!req) return undefined;
        return {
          label: tx('Buchung bestätigen'),
          onClick: () => {
            const snapshot = [...belegungskalender];
            void LivingAppsService.createBelegungskalenderEntry({
              anreisedatum: req.fields.wunsch_anreise,
              abreisedatum: req.fields.wunsch_abreise,
              status: 'belegt',
            }).then(() => fetchAll()).catch(() => {
              setBelegungskalender(snapshot);
              fetchAll();
            });
            undoToast(tx`${req.fields.vorname ?? ''} ${req.fields.nachname ?? ''} — Anfrage bestätigt`);
            crud.overlay.close();
          },
        };
      }
      return undefined;
    },
  });

  // ─── ALL hooks above early-returns ───

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Plain derivations below ───

  const aktuelleGaeste = belegtEintraege.filter(b => {
    if (!b.fields.anreisedatum || !b.fields.abreisedatum) return false;
    return !isAfter(parseISO(b.fields.anreisedatum), today) && !isBefore(parseISO(b.fields.abreisedatum), today);
  });

  // Upcoming arrivals (next 14 days)
  const naechsteAnreisen = belegtEintraege
    .filter(b => {
      if (!b.fields.anreisedatum) return false;
      const anreise = parseISO(b.fields.anreisedatum);
      return isAfter(anreise, today) && differenceInCalendarDays(anreise, today) <= 14;
    })
    .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''));

  // Occupancy: is the flat currently occupied?
  const istBelegt = aktuelleGaeste.length > 0;

  // Context greeting
  let contextLine: string;
  if (istBelegt && aktuelleGaeste.length > 0) {
    contextLine = aktuelleGaeste[0].fields.abreisedatum
      ? tx`Deine Wohnung ist belegt — Abreise am ${formatDate(aktuelleGaeste[0].fields.abreisedatum)}.`
      : tx`Deine Wohnung ist aktuell belegt.`;
  } else if (naechsteAnreisen.length > 0) {
    const naechste = naechsteAnreisen[0];
    contextLine = tx`Nächste Anreise am ${formatDate(naechste.fields.anreisedatum)}.`;
  } else if (offeneAnfragen.length > 0) {
    contextLine = tx`${offeneAnfragen.length} offene Anfrage${offeneAnfragen.length === 1 ? '' : 'n'} — noch nichts gebucht.`;
  } else {
    contextLine = tx`Die Wohnung steht frei — kein Aufenthalt geplant.`;
  }

  // Advance a booking: mark as belegt (from free)
  const markAsBelegt = (b: Belegungskalender) => {
    const snapshot = [...belegungskalender];
    setBelegungskalender(prev => prev.map(r =>
      r.record_id === b.record_id
        ? { ...r, fields: { ...r.fields, status: lookupOption('belegungskalender', 'status', 'belegt') } }
        : r
    ));
    LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: 'belegt' })
      .then(() => { undoToast(tx`${b.fields.anreisedatum ?? ''} — als belegt markiert`, () => {
        setBelegungskalender(snapshot);
        LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: 'frei' }).catch(() => fetchAll());
      }); })
      .catch(() => { setBelegungskalender(snapshot); fetchAll(); });
  };

  // Accept a booking request: create a calendar entry
  const acceptAnfrage = (anfrage: typeof buchungsanfrage[number]) => {
    void LivingAppsService.createBelegungskalenderEntry({
      anreisedatum: anfrage.fields.wunsch_anreise,
      abreisedatum: anfrage.fields.wunsch_abreise,
      status: 'belegt',
    }).then(() => {
      fetchAll();
      undoToast(tx`${anfrage.fields.vorname ?? ''} ${anfrage.fields.nachname ?? ''} — Anfrage bestätigt`);
    }).catch(() => fetchAll());
  };

  // Nights count helper
  const naechte = (start?: string, end?: string) => {
    if (!start || !end) return null;
    return differenceInCalendarDays(parseISO(end), parseISO(start));
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          offeneAnfragen.length > 0 ? (
            <HeroBanner
              icon={<IconInbox size={18} />}
              action={{
                label: offeneAnfragen.length === 1
                  ? tx('Anfrage öffnen')
                  : tx('Erste Anfrage öffnen'),
                onClick: () => crud.buchungsanfrage.openDetail(offeneAnfragen[0]),
              }}
            >
              {offeneAnfragen.length === 1
                ? tx`Neue Buchungsanfrage von ${offeneAnfragen[0].fields.vorname ?? ''} ${offeneAnfragen[0].fields.nachname ?? ''} — ${formatDate(offeneAnfragen[0].fields.wunsch_anreise)} bis ${formatDate(offeneAnfragen[0].fields.wunsch_abreise)}.`
                : tx`${offeneAnfragen.length} neue Buchungsanfragen — älteste von ${offeneAnfragen[0].fields.vorname ?? ''} ${offeneAnfragen[0].fields.nachname ?? ''}.`
              }
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Status')}
              value={istBelegt ? tx('Belegt') : tx('Frei')}
              icon={<IconCalendar size={16} />}
              tone={istBelegt ? 'primary' : 'success'}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconInbox size={16} />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilterStatus(f => f === 'anfragen' ? 'alle' : 'anfragen')}
              active={filterStatus === 'anfragen'}
            />
            <StatStripItem
              title={tx('Buchungen gesamt')}
              value={belegtEintraege.length}
              icon={<IconCheck size={16} />}
              tone="default"
            />
            <StatStripItem
              title={tx('Nächste Anreise')}
              value={naechsteAnreisen.length > 0 ? formatDate(naechsteAnreisen[0].fields.anreisedatum) : tx('—')}
              icon={<IconCalendar size={16} />}
              tone={naechsteAnreisen.length > 0 ? 'default' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <CalendarWidget
            events={
              filterStatus === 'anfragen'
                ? offeneAnfragen.filter(a => a.fields.wunsch_anreise).map(a => ({
                    id: `buchungsanfrage:${a.record_id}`,
                    start: a.fields.wunsch_anreise!,
                    end: a.fields.wunsch_abreise,
                    allDay: true,
                    title: tx`Anfrage: ${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`,
                    tone: 'warning' as CalendarTone,
                  }))
                : [
                    ...belegtEintraege.filter(b => b.fields.anreisedatum).map(b => ({
                      id: `belegungskalender:${b.record_id}`,
                      start: b.fields.anreisedatum!,
                      end: b.fields.abreisedatum,
                      allDay: true,
                      title: tx('Belegt'),
                      subtitle: b.fields.interne_notiz ?? undefined,
                      tone: 'primary' as CalendarTone,
                    })),
                    ...offeneAnfragen.filter(a => a.fields.wunsch_anreise).map(a => ({
                      id: `buchungsanfrage:${a.record_id}`,
                      start: a.fields.wunsch_anreise!,
                      end: a.fields.wunsch_abreise,
                      allDay: true,
                      title: tx`Anfrage: ${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`,
                      tone: 'warning' as CalendarTone,
                    })),
                  ]
            }
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const [type, id] = ev.id.split(':');
              if (type === 'belegungskalender') {
                const rec = belegungskalender.find(b => b.record_id === id);
                if (rec) crud.belegungskalender.openDetail(rec);
              } else if (type === 'buchungsanfrage') {
                const rec = buchungsanfrage.find(a => a.record_id === id);
                if (rec) crud.buchungsanfrage.openDetail(rec);
              }
            }}
            onEventDrop={(eventId, newStart, newEnd) => {
              const [type, id] = eventId.split(':');
              if (type !== 'belegungskalender') return tx('Anfragen können nicht verschoben werden');
              const rec = belegungskalender.find(b => b.record_id === id);
              if (!rec) return;
              const snapshot = [...belegungskalender];
              setBelegungskalender(prev => prev.map(b =>
                b.record_id === id
                  ? { ...b, fields: { ...b.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
                  : b
              ));
              LivingAppsService.updateBelegungskalenderEntry(id, {
                anreisedatum: newStart,
                ...(newEnd ? { abreisedatum: newEnd } : {}),
              }).then(() => {
                undoToast(tx`Buchung verschoben — ${formatDate(newStart)}`, () => {
                  setBelegungskalender(snapshot);
                  LivingAppsService.updateBelegungskalenderEntry(id, {
                    anreisedatum: rec.fields.anreisedatum,
                    abreisedatum: rec.fields.abreisedatum,
                  }).catch(() => fetchAll());
                });
              }).catch(() => { setBelegungskalender(snapshot); fetchAll(); });
            }}
            onRangeCreate={(start, end) => {
              crud.belegungskalender.openCreate({
                anreisedatum: format(start, 'yyyy-MM-dd'),
                abreisedatum: format(end, 'yyyy-MM-dd'),
                status: 'belegt',
              });
            }}
            onEmptyClick={date => {
              crud.belegungskalender.openCreate({
                anreisedatum: format(date, 'yyyy-MM-dd'),
                status: 'belegt',
              });
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={offeneAnfragen.slice(0, 8).map(a => {
                const n = naechte(a.fields.wunsch_anreise, a.fields.wunsch_abreise);
                return {
                  id: a.record_id,
                  title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || tx('Unbekannte Person'),
                  secondLine: (
                    <>
                      <span className="text-muted-foreground">
                        {formatDate(a.fields.wunsch_anreise)}
                        {a.fields.wunsch_abreise ? ` – ${formatDate(a.fields.wunsch_abreise)}` : ''}
                        {n != null && n > 0 ? ` · ${n} ${n === 1 ? tx('Nacht') : tx('Nächte')}` : ''}
                        {a.fields.anzahl_personen ? ` · ${a.fields.anzahl_personen} ${tx('Pers.')}` : ''}
                      </span>
                    </>
                  ),
                  action: {
                    label: tx('Bestätigen'),
                    onClick: () => acceptAnfrage(a),
                  },
                };
              })}
              onItemClick={id => {
                const rec = buchungsanfrage.find(a => a.record_id === id);
                if (rec) crud.buchungsanfrage.openDetail(rec);
              }}
              empty={{
                text: tx('Keine offenen Anfragen — die Wohnung steht frei.'),
                action: {
                  label: tx('Belegung eintragen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: todayStr }),
                },
              }}
            />
            <WorkList
              title={tx('Nächste Anreisen')}
              items={naechsteAnreisen.slice(0, 5).map(b => {
                const n = naechte(b.fields.anreisedatum, b.fields.abreisedatum);
                const inTagen = differenceInCalendarDays(parseISO(b.fields.anreisedatum!), today);
                return {
                  id: b.record_id,
                  title: b.fields.interne_notiz
                    ? b.fields.interne_notiz.split('\n')[0]
                    : tx('Belegung'),
                  secondLine: (
                    <span className="text-muted-foreground">
                      {inTagen === 0 ? tx('Heute') : inTagen === 1 ? tx('Morgen') : tx`In ${inTagen} Tagen`}
                      {' · '}
                      {formatDate(b.fields.anreisedatum)}
                      {n != null && n > 0 ? ` · ${n} ${n === 1 ? tx('Nacht') : tx('Nächte')}` : ''}
                    </span>
                  ),
                  action:
                    b.fields.status?.key !== 'belegt'
                      ? { label: tx('Als belegt markieren'), onClick: () => markAsBelegt(b) }
                      : undefined,
                };
              })}
              onItemClick={id => {
                const rec = belegungskalender.find(b => b.record_id === id);
                if (rec) crud.belegungskalender.openDetail(rec);
              }}
              empty={{
                text: tx('Keine Anreisen in den nächsten 14 Tagen.'),
                action: {
                  label: tx('Buchung anlegen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: todayStr }),
                },
              }}
            />
          </>
        }
      />

      {belegungskalender.length === 0 && buchungsanfrage.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <IconCalendar size={48} className="text-muted-foreground" stroke={1.5} />
          <div>
            <p className="font-medium">{tx('Noch keine Belegungen eingetragen')}</p>
            <p className="text-sm text-muted-foreground mt-1">{tx('Trag deinen ersten Aufenthalt ein, um den Kalender zu befüllen.')}</p>
          </div>
          <button
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: todayStr })}
          >
            <IconPlus size={16} />
            {tx('Erste Belegung anlegen')}
          </button>
        </div>
      )}

      {crud.surfaces}
    </div>
  );
}
