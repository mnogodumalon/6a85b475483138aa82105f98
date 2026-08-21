import { useMemo, useState, useCallback } from 'react';
import { format, parseISO, differenceInDays, isAfter, isBefore, startOfDay } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import type { CalendarEvent, CalendarTone } from '@/components/widgets/CalendarWidget';
import { LivingAppsService } from '@/services/livingAppsService';
import type { Belegungskalender } from '@/types/app';
import { lookupOption } from '@/types/app';
import { formatDate } from '@/lib/formatters';
import { useClock, gruss, undoToast } from '@/lib/polish';
import { dateFnsLocale } from '@/i18n';
import { tx, appLabel } from '@/i18n';
import {
  IconCalendar,
  IconCheck,
  IconStar,
  IconMailOpened,
  IconHome,
  IconAlertCircle,
} from '@tabler/icons-react';

function toneForBelegung(b: Belegungskalender): CalendarTone {
  const key = b.fields.status?.key;
  if (key === 'frei') return 'success';
  return 'primary';
}

export default function DashboardOverview() {
  const data = useDashboardData();
  const { belegungskalender, setBelegungskalender, buchungsanfrage, loading, error, fetchAll } = data;
  const crud = useEntityCrud(data);

  const clock = useClock();
  const [filterAnfragen, setFilterAnfragen] = useState(false);

  const today = useMemo(() => startOfDay(clock), [clock]);
  const todayStr = useMemo(() => format(clock, 'yyyy-MM-dd'), [clock]);

  // Compute KPI values
  const belegtHeute = useMemo(() => {
    return belegungskalender.filter(b => {
      const an = b.fields.anreisedatum;
      const ab = b.fields.abreisedatum;
      const key = b.fields.status?.key;
      if (key !== 'belegt' || !an || !ab) return false;
      return an <= todayStr && ab >= todayStr;
    });
  }, [belegungskalender, todayStr]);

  const naechsteAbreise = useMemo(() => {
    const future = belegungskalender
      .filter(b => b.fields.status?.key === 'belegt' && b.fields.abreisedatum && b.fields.abreisedatum >= todayStr)
      .sort((a, b) => (a.fields.abreisedatum ?? '').localeCompare(b.fields.abreisedatum ?? ''));
    return future[0] ?? null;
  }, [belegungskalender, todayStr]);

  const naechsteAnreise = useMemo(() => {
    const future = belegungskalender
      .filter(b => b.fields.status?.key === 'belegt' && b.fields.anreisedatum && b.fields.anreisedatum > todayStr)
      .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''));
    return future[0] ?? null;
  }, [belegungskalender, todayStr]);

  const neueAnfragen = useMemo(() => {
    return buchungsanfrage
      .slice()
      .sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? ''));
  }, [buchungsanfrage]);

  // Map records to calendar events
  const events = useMemo<CalendarEvent[]>(() => {
    return belegungskalender
      .filter(b => b.fields.anreisedatum && b.fields.abreisedatum)
      .map(b => ({
        id: `belegung:${b.record_id}`,
        start: b.fields.anreisedatum!,
        end: b.fields.abreisedatum!,
        allDay: true,
        title: b.fields.status?.key === 'belegt' ? tx('Belegt') : tx('Freigehalten'),
        subtitle: b.fields.interne_notiz ? b.fields.interne_notiz.split('\n')[0] : undefined,
        tone: toneForBelegung(b),
      }));
  }, [belegungskalender]);

  // Drag-to-move: optimistic update + PATCH
  const handleEventDrop = useCallback(async (eventId: string, newStart: string, newEnd?: string) => {
    const recId = eventId.split(':')[1] ?? '';
    const rec = belegungskalender.find(b => b.record_id === recId);
    if (!rec) return;
    // 3-night minimum check
    if (newStart && newEnd) {
      const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
      if (nights < 3) {
        return tx('Mindestaufenthalt: 3 Nächte');
      }
    }
    const snap: Belegungskalender = JSON.parse(JSON.stringify(rec));
    setBelegungskalender(prev =>
      prev.map(b => b.record_id === recId
        ? { ...b, fields: { ...b.fields, anreisedatum: newStart.slice(0, 10), ...(newEnd ? { abreisedatum: newEnd.slice(0, 10) } : {}) } }
        : b
      )
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(recId, {
        anreisedatum: newStart.slice(0, 10),
        ...(newEnd ? { abreisedatum: newEnd.slice(0, 10) } : {}),
      });
      undoToast(tx('Buchung verschoben'), () => {
        setBelegungskalender(prev => prev.map(b => b.record_id === recId ? snap : b));
        void LivingAppsService.updateBelegungskalenderEntry(recId, {
          anreisedatum: snap.fields.anreisedatum,
          abreisedatum: snap.fields.abreisedatum,
        });
      });
    } catch {
      fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll]);

  // Drag-to-resize
  const handleEventResize = useCallback(async (eventId: string, newStart: string, newEnd: string) => {
    const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
    if (nights < 3) {
      return tx('Mindestaufenthalt: 3 Nächte');
    }
    const recId = eventId.split(':')[1] ?? '';
    const rec = belegungskalender.find(b => b.record_id === recId);
    if (!rec) return;
    const snap: Belegungskalender = JSON.parse(JSON.stringify(rec));
    setBelegungskalender(prev =>
      prev.map(b => b.record_id === recId
        ? { ...b, fields: { ...b.fields, anreisedatum: newStart.slice(0, 10), abreisedatum: newEnd.slice(0, 10) } }
        : b
      )
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(recId, {
        anreisedatum: newStart.slice(0, 10),
        abreisedatum: newEnd.slice(0, 10),
      });
      undoToast(tx('Aufenthalt angepasst'), () => {
        setBelegungskalender(prev => prev.map(b => b.record_id === recId ? snap : b));
        void LivingAppsService.updateBelegungskalenderEntry(recId, {
          anreisedatum: snap.fields.anreisedatum,
          abreisedatum: snap.fields.abreisedatum,
        });
      });
    } catch {
      fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll]);

  // Drag-to-create new booking
  const handleRangeCreate = useCallback((start: Date, end: Date) => {
    const nights = differenceInDays(end, start);
    if (nights < 3) {
      // open create anyway, let dialog enforce
    }
    crud.belegungskalender.openCreate({
      anreisedatum: format(start, 'yyyy-MM-dd'),
      abreisedatum: format(end, 'yyyy-MM-dd'),
      status: 'belegt',
    });
  }, [crud]);

  // Mark booking as free (make it available)
  const markAsFrei = useCallback(async (b: Belegungskalender) => {
    const snap: Belegungskalender = JSON.parse(JSON.stringify(b));
    const newStatus = lookupOption('belegungskalender', 'status', 'frei');
    setBelegungskalender(prev =>
      prev.map(r => r.record_id === b.record_id
        ? { ...r, fields: { ...r.fields, status: newStatus } }
        : r
      )
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: 'frei' });
      undoToast(tx('Als frei markiert'), () => {
        setBelegungskalender(prev => prev.map(r => r.record_id === b.record_id ? snap : r));
        void LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: 'belegt' });
      });
    } catch {
      fetchAll();
    }
  }, [setBelegungskalender, fetchAll]);

  const belegungsRate = useMemo(() => {
    // Count nights booked in next 30 days
    const total = 30;
    let booked = 0;
    for (let i = 0; i < total; i++) {
      const d = format(new Date(today.getTime() + i * 86400000), 'yyyy-MM-dd');
      const isBelegt = belegungskalender.some(b => {
        return b.fields.status?.key === 'belegt'
          && b.fields.anreisedatum && b.fields.abreisedatum
          && b.fields.anreisedatum <= d && b.fields.abreisedatum > d;
      });
      if (isBelegt) booked++;
    }
    return Math.round((booked / total) * 100);
  }, [belegungskalender, today]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Context line
  const contextLine = (() => {
    if (belegtHeute.length > 0) {
      if (naechsteAbreise) {
        return tx`Heute belegt — Abreise ${formatDate(naechsteAbreise.fields.abreisedatum)}`;
      }
      return tx('Wohnung ist heute belegt.');
    }
    if (naechsteAnreise) {
      return tx`Frei — nächste Anreise am ${formatDate(naechsteAnreise.fields.anreisedatum)}`;
    }
    return tx('Keine Buchungen eingetragen.');
  })();

  // Hero: new requests waiting
  const offeneAnfragen = neueAnfragen.filter(a => {
    // treat all inquiries as "open" since no status field on Buchungsanfrage
    return !!a.fields.wunsch_anreise;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {gruss(clock)} — {appLabel('belegungskalender')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{contextLine}</p>
        </div>
        <button
          onClick={() => crud.belegungskalender.openCreate({ status: 'belegt' })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <IconCalendar size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={offeneAnfragen.length > 0 ? (
          <HeroBanner
            icon={<IconMailOpened size={18} />}
            action={{
              label: tx('Anfrage öffnen'),
              onClick: () => crud.buchungsanfrage.openDetail(offeneAnfragen[0]),
            }}
          >
            {offeneAnfragen.length === 1
              ? tx`${offeneAnfragen[0].fields.vorname ?? ''} ${offeneAnfragen[0].fields.nachname ?? ''} — neue Buchungsanfrage für ${formatDate(offeneAnfragen[0].fields.wunsch_anreise)} bis ${formatDate(offeneAnfragen[0].fields.wunsch_abreise)}.`
              : tx`${String(offeneAnfragen.length)} neue Buchungsanfragen — älteste von ${offeneAnfragen[offeneAnfragen.length - 1].fields.vorname ?? ''} ${offeneAnfragen[offeneAnfragen.length - 1].fields.nachname ?? ''}.`
            }
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Auslastung (30 Tage)')}
              value={`${belegungsRate} %`}
              icon={<IconHome size={16} className="shrink-0" />}
              tone={belegungsRate > 70 ? 'success' : belegungsRate > 30 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Buchungen gesamt')}
              value={belegungskalender.filter(b => b.fields.status?.key === 'belegt').length}
              icon={<IconCalendar size={16} className="shrink-0" />}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={neueAnfragen.length}
              icon={<IconStar size={16} className="shrink-0" />}
              tone={neueAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilterAnfragen(f => !f)}
              active={filterAnfragen}
            />
          </StatStrip>
        }
        primary={
          <CalendarWidget
            events={events}
            defaultView="month"
            locale={dateFnsLocale()}
            onEventClick={(ev) => {
              const recId = ev.id.split(':')[1] ?? '';
              const rec = belegungskalender.find(b => b.record_id === recId);
              if (rec) crud.belegungskalender.openDetail(rec);
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onRangeCreate={handleRangeCreate}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={neueAnfragen.slice(0, 8).map(a => ({
                id: a.record_id,
                title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('Unbekannt'),
                secondLine: (
                  <span className="text-muted-foreground text-xs">
                    {formatDate(a.fields.wunsch_anreise)} – {formatDate(a.fields.wunsch_abreise)}
                    {a.fields.anzahl_personen != null && (
                      <> · {a.fields.anzahl_personen} {a.fields.anzahl_personen === 1 ? tx('Person') : tx('Personen')}</>
                    )}
                  </span>
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
              onItemClick={(id) => {
                const a = buchungsanfrage.find(r => r.record_id === id);
                if (a) crud.buchungsanfrage.openDetail(a);
              }}
              empty={{
                text: naechsteAnreise
                  ? tx`Keine offenen Anfragen — nächste Anreise ${formatDate(naechsteAnreise.fields.anreisedatum)}`
                  : tx('Noch keine Anfragen eingegangen.'),
                action: { label: tx('Neue Buchung'), onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }) },
              }}
            />
            <WorkList
              title={tx('Bald frei')}
              items={belegungskalender
                .filter(b =>
                  b.fields.status?.key === 'belegt'
                  && b.fields.abreisedatum
                  && b.fields.abreisedatum >= todayStr
                  && differenceInDays(parseISO(b.fields.abreisedatum), today) <= 14
                )
                .sort((a, b) => (a.fields.abreisedatum ?? '').localeCompare(b.fields.abreisedatum ?? ''))
                .slice(0, 5)
                .map(b => ({
                  id: b.record_id,
                  title: tx`Abreise ${formatDate(b.fields.abreisedatum)}`,
                  secondLine: (
                    <span className="text-muted-foreground text-xs">
                      {b.fields.interne_notiz?.split('\n')[0] ?? tx('Keine Notiz')}
                    </span>
                  ),
                  action: {
                    label: tx('Als frei'),
                    onClick: () => markAsFrei(b),
                  },
                }))
              }
              onItemClick={(id) => {
                const b = belegungskalender.find(r => r.record_id === id);
                if (b) crud.belegungskalender.openDetail(b);
              }}
              empty={{
                text: tx('Keine Abreisen in den nächsten 14 Tagen.'),
                action: { label: tx('Belegung eintragen'), onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }) },
              }}
            />
          </>
        }
      />
      {crud.surfaces}
    </div>
  );
}
