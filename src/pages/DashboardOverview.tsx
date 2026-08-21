import { useMemo, useState } from 'react';
import { format, parseISO, isAfter, isBefore, startOfToday, differenceInDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { CalendarWidget, type CalendarEvent } from '@/components/widgets/CalendarWidget';
import { LivingAppsService } from '@/services/livingAppsService';
import { useClock, gruss, undoToast } from '@/lib/polish';
import { dateFnsLocale } from '@/i18n';
import { tx, appLabel } from '@/i18n';
import { formatDate } from '@/lib/formatters';
import { lookupOption } from '@/types/app';
import { IconAlertTriangle, IconCalendarCheck, IconCalendarX, IconInbox, IconCircleCheck } from '@tabler/icons-react';

export default function DashboardOverview() {
  const data = useDashboardData();
  const {
    belegungskalender, setBelegungskalender,
    buchungsanfrage,
    loading, error, fetchAll,
  } = data;

  const clock = useClock();
  const crud = useEntityCrud(data);

  const [filterAnfragen, setFilterAnfragen] = useState(false);

  // Belegungskalender → CalendarEvents (multi-day spans)
  const calEvents = useMemo<CalendarEvent[]>(() => {
    return belegungskalender
      .filter(b => !!b.fields.anreisedatum)
      .map(b => ({
        id: `belegung:${b.record_id}`,
        start: b.fields.anreisedatum!,
        end: b.fields.abreisedatum,
        allDay: true,
        title: b.fields.status?.key === 'belegt'
          ? tx('Belegt')
          : tx('Frei'),
        subtitle: b.fields.abreisedatum
          ? tx`${formatDate(b.fields.anreisedatum)} – ${formatDate(b.fields.abreisedatum)}`
          : undefined,
        tone: b.fields.status?.key === 'belegt' ? 'primary' : 'success',
      }));
  }, [belegungskalender]);

  // ─── all hooks above early returns ────────────────────────────────────────

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── plain derivations only below ─────────────────────────────────────────

  const today = startOfToday();

  // Pending requests
  const pendingAnfragen = buchungsanfrage;

  // Current / upcoming occupancy
  const belegtJetzt = belegungskalender.filter(b => {
    if (b.fields.status?.key !== 'belegt') return false;
    const an = b.fields.anreisedatum;
    const ab = b.fields.abreisedatum;
    if (!an) return false;
    return !isAfter(parseISO(an), today) && (!ab || !isBefore(parseISO(ab), today));
  });

  const naechsteAnreise = belegungskalender
    .filter(b => b.fields.anreisedatum && isAfter(parseISO(b.fields.anreisedatum), today))
    .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''));
  const naechsteBuchung = naechsteAnreise[0];

  const belegtDieseWoche = belegungskalender.filter(b => {
    if (b.fields.status?.key !== 'belegt') return false;
    const an = b.fields.anreisedatum;
    if (!an) return false;
    const diff = differenceInDays(parseISO(an), today);
    return diff >= 0 && diff <= 7;
  });

  // Früheste unbestätigte Anfrage (coming soon, urgent if request date is past)
  const fruehesteAnfrage = pendingAnfragen
    .filter(a => !!a.fields.wunsch_anreise)
    .sort((a, b) => (a.fields.wunsch_anreise ?? '').localeCompare(b.fields.wunsch_anreise ?? ''))[0];

  // Hero: show banner if there are pending requests
  const hatAnfragen = pendingAnfragen.length > 0;

  // Context line
  const contextLine = (() => {
    if (belegtJetzt.length > 0) {
      return naechsteBuchung
        ? tx`Wohnung derzeit belegt — nächste Anreise ${formatDate(naechsteBuchung.fields.anreisedatum)}.`
        : tx`Wohnung derzeit belegt.`;
    }
    if (naechsteBuchung) {
      return tx`Wohnung gerade frei — nächste Anreise ${formatDate(naechsteBuchung.fields.anreisedatum)}.`;
    }
    return tx('Noch keine Buchungen eingetragen — lass den Kalender befüllen!');
  })();

  // Reschedule handler (drag on calendar)
  const handleEventDrop = async (eventId: string, newStart: string, newEnd?: string) => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    const prev = belegungskalender.find(b => b.record_id === rid);
    if (!prev) return;
    const snapshot = prev;
    setBelegungskalender(list =>
      list.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
          : b,
      ),
    );
    undoToast(
      tx`Buchung verschoben auf ${formatDate(newStart)}`,
      async () => {
        setBelegungskalender(list =>
          list.map(b => b.record_id === rid ? snapshot : b),
        );
        await LivingAppsService.updateBelegungskalenderEntry(rid, {
          anreisedatum: snapshot.fields.anreisedatum,
          abreisedatum: snapshot.fields.abreisedatum,
        });
      },
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(rid, {
        anreisedatum: newStart,
        ...(newEnd ? { abreisedatum: newEnd } : {}),
      });
    } catch {
      await fetchAll();
    }
  };

  const handleEventResize = async (eventId: string, newStart: string, newEnd: string) => {
    return handleEventDrop(eventId, newStart, newEnd);
  };

  // Mark a booking as "belegt" (confirm occupation)
  const markBelegt = async (id: string) => {
    const rec = belegungskalender.find(b => b.record_id === id);
    if (!rec) return;
    const snapshot = rec;
    setBelegungskalender(list =>
      list.map(b =>
        b.record_id === id
          ? { ...b, fields: { ...b.fields, status: lookupOption('belegungskalender', 'status', 'belegt') } }
          : b,
      ),
    );
    undoToast(
      tx('Zeitraum als belegt markiert'),
      async () => {
        setBelegungskalender(list =>
          list.map(b => b.record_id === id ? snapshot : b),
        );
        await LivingAppsService.updateBelegungskalenderEntry(id, { status: 'frei' });
      },
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(id, { status: 'belegt' });
    } catch {
      await fetchAll();
    }
  };

  const freieZeitraeume = belegungskalender.filter(b => b.fields.status?.key === 'frei');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {gruss(clock)} {/* i18n-exempt */}
        </h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="split"
        hero={
          hatAnfragen && (
            <HeroBanner
              icon={<IconInbox size={18} />}
              action={{
                label: tx('Anfragen ansehen'),
                onClick: () => {
                  setFilterAnfragen(f => !f);
                },
              }}
            >
              {pendingAnfragen.length === 1
                ? fruehesteAnfrage
                  ? tx`${fruehesteAnfrage.fields.vorname ?? ''} ${fruehesteAnfrage.fields.nachname ?? ''} fragt an — Wunschanreise ${formatDate(fruehesteAnfrage.fields.wunsch_anreise)}.`
                  : tx`1 neue Buchungsanfrage wartet auf deine Antwort.`
                : tx`${pendingAnfragen.length} Buchungsanfragen warten auf deine Antwort.`}
            </HeroBanner>
          )
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Jetzt belegt')}
              value={belegtJetzt.length > 0 ? tx('Ja') : tx('Nein')}
              icon={<IconCalendarCheck size={16} className="shrink-0" />}
              tone={belegtJetzt.length > 0 ? 'primary' : 'success'}
            />
            <StatStripItem
              title={tx('Anreisen diese Woche')}
              value={belegtDieseWoche.length}
              icon={<IconCalendarCheck size={16} className="shrink-0" />}
              tone={belegtDieseWoche.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Freie Zeiträume')}
              value={freieZeitraeume.length}
              icon={<IconCalendarX size={16} className="shrink-0" />}
              tone={freieZeitraeume.length > 0 ? 'success' : 'default'}
            />
            <StatStripItem
              title={appLabel('buchungsanfrage')}
              value={pendingAnfragen.length}
              icon={<IconInbox size={16} className="shrink-0" />}
              tone={pendingAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilterAnfragen(f => !f)}
              active={filterAnfragen}
            />
          </StatStrip>
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={pendingAnfragen.map(a => ({
                id: a.record_id,
                title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('Unbekannt'),
                secondLine: (
                  <>
                    <span className="text-muted-foreground">
                      {a.fields.wunsch_anreise
                        ? tx`${formatDate(a.fields.wunsch_anreise)} – ${formatDate(a.fields.wunsch_abreise)}`
                        : tx('Kein Datum')}
                    </span>
                    {a.fields.anzahl_personen != null && (
                      <span className="text-muted-foreground"> · {a.fields.anzahl_personen} {tx('Pers.')}</span>
                    )}
                  </>
                ),
                action: {
                  label: tx('Eintragen'),
                  onClick: () => {
                    crud.belegungskalender.openCreate({
                      anreisedatum: a.fields.wunsch_anreise,
                      abreisedatum: a.fields.wunsch_abreise,
                      status: 'belegt',
                    });
                  },
                },
              }))}
              onItemClick={id => {
                const rec = buchungsanfrage.find(a => a.record_id === id);
                if (rec) crud.buchungsanfrage.openDetail(rec);
              }}
              empty={{
                text: tx('Keine offenen Anfragen — die Wohnung ist gut vermarktet!'),
                action: {
                  label: tx('Buchung eintragen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }),
                },
              }}
            />
            <WorkList
              title={tx('Freie Zeiträume')}
              items={freieZeitraeume.map(b => ({
                id: b.record_id,
                title: b.fields.anreisedatum
                  ? tx`${formatDate(b.fields.anreisedatum)} – ${formatDate(b.fields.abreisedatum)}`
                  : tx('Unbekannter Zeitraum'),
                secondLine: (
                  <span className="font-medium text-emerald-600">{tx('Frei')}</span>
                ),
                action: {
                  label: tx('Belegen'),
                  onClick: () => markBelegt(b.record_id),
                },
              }))}
              onItemClick={id => {
                const rec = belegungskalender.find(b => b.record_id === id);
                if (rec) crud.belegungskalender.openDetail(rec);
              }}
              empty={{
                text: naechsteBuchung
                  ? tx`Nächste Anreise: ${formatDate(naechsteBuchung.fields.anreisedatum)}`
                  : tx('Keine freien Zeiträume eingetragen.'),
                action: {
                  label: tx('Freien Zeitraum eintragen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'frei' }),
                },
              }}
            />
          </>
        }
        primary={
          <CalendarWidget
            events={calEvents}
            defaultView="month"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const rid = ev.id.split(':')[1];
              const rec = belegungskalender.find(b => b.record_id === rid);
              if (rec) crud.belegungskalender.openDetail(rec);
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onRangeCreate={(start, end) => {
              crud.belegungskalender.openCreate({
                anreisedatum: format(start, 'yyyy-MM-dd'),
                abreisedatum: format(end, 'yyyy-MM-dd'),
                status: 'belegt',
              });
            }}
          />
        }
      />

      {crud.surfaces}
    </div>
  );
}
