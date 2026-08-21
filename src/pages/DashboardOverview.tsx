import { useMemo, useState } from 'react';
import { format, parseISO, isAfter, isBefore, addDays, startOfDay } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { HeroBanner } from '@/components/HeroBanner';
import { CalendarWidget, type CalendarEvent } from '@/components/widgets/CalendarWidget';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { formatDate, lookupKey } from '@/lib/formatters';
import { lookupOption } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import type { Belegungskalender } from '@/types/app';
import {
  IconCalendar,
  IconClock,
  IconUsers,
  IconCheck,
  IconAlertCircle,
  IconStar,
} from '@tabler/icons-react';

// ─── Tone helper ─────────────────────────────────────────────────────────────
function toneForBelegung(b: Belegungskalender) {
  const key = lookupKey(b.fields.status);
  if (key === 'belegt') return 'primary' as const;
  return 'success' as const;
}

export default function DashboardOverview() {
  const data = useDashboardData();
  const { belegungskalender, setBelegungskalender, buchungsanfrage, loading, error, fetchAll } = data;
  const crud = useEntityCrud(data);
  const clock = useClock();

  // ─── Derived data ──────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const belegtEntries = useMemo(
    () => belegungskalender.filter(b => lookupKey(b.fields.status) === 'belegt'),
    [belegungskalender]
  );

  // Active bookings: anreise <= today <= abreise
  const aktuelleGaeste = useMemo(
    () => belegtEntries.filter(b => {
      const an = b.fields.anreisedatum;
      const ab = b.fields.abreisedatum;
      if (!an || !ab) return false;
      return an <= today && ab >= today;
    }),
    [belegtEntries, today]
  );

  // Upcoming bookings in the next 30 days
  const kommendeGaeste = useMemo(
    () => belegtEntries.filter(b => {
      const an = b.fields.anreisedatum;
      if (!an) return false;
      const next30 = format(addDays(clock, 30), 'yyyy-MM-dd');
      return an > today && an <= next30;
    }),
    [belegtEntries, today, clock]
  );

  // All Buchungsanfragen (sorted newest first)
  const offeneAnfragen = useMemo(
    () => [...buchungsanfrage].sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? '')),
    [buchungsanfrage]
  );

  // Context line names
  const gaesteNamen = useMemo(
    () => aktuelleGaeste.map(b => `${b.fields.anreisedatum ?? ''}`.slice(0, 0) || [b.fields.interne_notiz ?? ''].join('')).filter(Boolean),
    [aktuelleGaeste]
  );

  // Upcoming arrivals (next 7 days)
  const baldAnreisende = useMemo(
    () => belegtEntries.filter(b => {
      const an = b.fields.anreisedatum;
      if (!an) return false;
      const in7 = format(addDays(clock, 7), 'yyyy-MM-dd');
      return an > today && an <= in7;
    }),
    [belegtEntries, today, clock]
  );

  // Calendar events
  const calendarEvents = useMemo<CalendarEvent[]>(
    () => belegtEntries.flatMap(b => {
      const start = b.fields.anreisedatum;
      const end = b.fields.abreisedatum;
      if (!start) return [];
      return [{
        id: `belegung:${b.record_id}`,
        start,
        end: end ?? start,
        allDay: true,
        title: tx('Belegt'),
        subtitle: b.fields.interne_notiz ?? undefined,
        tone: toneForBelegung(b),
      }];
    }),
    [belegtEntries]
  );

  // ─── Advance helper: confirm a Buchungsanfrage → create a Belegungskalender entry ──
  const [filter, setFilter] = useState<'alle' | 'anfragen'>('alle');

  const handleConfirmAnfrage = async (anfrage: typeof buchungsanfrage[0]) => {
    const anreise = anfrage.fields.wunsch_anreise;
    const abreise = anfrage.fields.wunsch_abreise;
    if (!anreise || !abreise) return;

    const notiz = `${anfrage.fields.vorname ?? ''} ${anfrage.fields.nachname ?? ''}`.trim();

    // Optimistic: add a new belegungskalender entry
    const tempId = `__temp_${Date.now()}`;
    const tempEntry: Belegungskalender = {
      record_id: tempId,
      created_at: format(clock, "yyyy-MM-dd'T'HH:mm"),
      updated_at: null,
      createdat: format(clock, "yyyy-MM-dd'T'HH:mm"),
      updatedat: null,
      fields: {
        anreisedatum: anreise,
        abreisedatum: abreise,
        status: lookupOption('belegungskalender', 'status', 'belegt'),
        interne_notiz: notiz,
      },
    };
    const prev = [...belegungskalender];
    setBelegungskalender([...belegungskalender, tempEntry]);

    try {
      await LivingAppsService.createBelegungskalenderEntry({
        anreisedatum: anreise,
        abreisedatum: abreise,
        status: 'belegt',
        interne_notiz: notiz,
      });
      undoToast(tx`${notiz} — als Buchung eingetragen`, async () => {
        setBelegungskalender(prev);
      });
      fetchAll();
    } catch {
      setBelegungskalender(prev);
      fetchAll();
    }
  };

  // ─── Drag: reschedule a booking ───────────────────────────────────────────
  const handleEventDrop = async (eventId: string, newStart: string, newEnd?: string) => {
    const recordId = eventId.split(':')[1] ?? '';
    const record = belegungskalender.find(b => b.record_id === recordId);
    if (!record) return;

    // Check 3-night minimum
    if (newStart && newEnd) {
      const startDate = parseISO(newStart);
      const endDate = parseISO(newEnd);
      const nights = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
      if (nights < 3) return tx('Mindestaufenthalt: 3 Nächte') as string;
    }

    const prev = [...belegungskalender];
    setBelegungskalender(belegungskalender.map(b =>
      b.record_id === recordId
        ? { ...b, fields: { ...b.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
        : b
    ));

    try {
      await LivingAppsService.updateBelegungskalenderEntry(recordId, {
        anreisedatum: newStart,
        ...(newEnd ? { abreisedatum: newEnd } : {}),
      });
      undoToast(tx('Buchung verschoben'), async () => {
        setBelegungskalender(prev);
        await LivingAppsService.updateBelegungskalenderEntry(recordId, {
          anreisedatum: record.fields.anreisedatum,
          abreisedatum: record.fields.abreisedatum,
        });
      });
    } catch {
      setBelegungskalender(prev);
      fetchAll();
    }
  };

  const handleEventResize = async (eventId: string, newStart: string, newEnd: string) => {
    const recordId = eventId.split(':')[1] ?? '';
    const record = belegungskalender.find(b => b.record_id === recordId);
    if (!record) return;

    // Check 3-night minimum
    const startDate = parseISO(newStart);
    const endDate = parseISO(newEnd);
    const nights = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
    if (nights < 3) return tx('Mindestaufenthalt: 3 Nächte') as string;

    const prev = [...belegungskalender];
    setBelegungskalender(belegungskalender.map(b =>
      b.record_id === recordId
        ? { ...b, fields: { ...b.fields, anreisedatum: newStart, abreisedatum: newEnd } }
        : b
    ));

    try {
      await LivingAppsService.updateBelegungskalenderEntry(recordId, {
        anreisedatum: newStart,
        abreisedatum: newEnd,
      });
      undoToast(tx('Buchung angepasst'), async () => {
        setBelegungskalender(prev);
        await LivingAppsService.updateBelegungskalenderEntry(recordId, {
          anreisedatum: record.fields.anreisedatum,
          abreisedatum: record.fields.abreisedatum,
        });
      });
    } catch {
      setBelegungskalender(prev);
      fetchAll();
    }
  };

  // ─── Early returns ─────────────────────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Context line ──────────────────────────────────────────────────────────
  const contextLine = aktuelleGaeste.length > 0
    ? tx`Aktuell ${aktuelleGaeste.length === 1 ? tx('ist') : tx('sind')} ${String(aktuelleGaeste.length)} ${aktuelleGaeste.length === 1 ? tx('Gast') : tx('Gäste')} in der Wohnung.`
    : kommendeGaeste.length > 0
      ? tx`Nächste Anreise: ${formatDate(kommendeGaeste[0].fields.anreisedatum)}.`
      : tx('Aktuell ist die Wohnung frei — klicke im Kalender auf einen Zeitraum zum Eintragen.');

  // Filtered anfragen for aside
  const visibleAnfragen = filter === 'anfragen' ? offeneAnfragen : offeneAnfragen;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">{gruss(clock)} </h1>
        <p className="text-muted-foreground text-sm">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          baldAnreisende.length > 0
            ? (
              <HeroBanner
                icon={<IconCalendar size={18} />}
                action={{
                  label: tx('Anreise vorbereiten'),
                  onClick: () => crud.belegungskalender.openDetail(baldAnreisende[0]),
                }}
              >
                {tx`Anreise in Kürze: ${formatDate(baldAnreisende[0].fields.anreisedatum)}`}
                {baldAnreisende[0].fields.interne_notiz ? ` — ${baldAnreisende[0].fields.interne_notiz}` : ''}
              </HeroBanner>
            )
            : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Aktuell belegt')}
              value={aktuelleGaeste.length}
              icon={<IconUsers size={16} className="shrink-0" />}
              tone={aktuelleGaeste.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconStar size={16} className="shrink-0" />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilter(f => f === 'anfragen' ? 'alle' : 'anfragen')}
              active={filter === 'anfragen'}
            />
            <StatStripItem
              title={tx('Nächste 30 Tage')}
              value={kommendeGaeste.length}
              icon={<IconClock size={16} className="shrink-0" />}
              tone="default"
            />
            <StatStripItem
              title={tx('Belegungen gesamt')}
              value={belegtEntries.length}
              icon={<IconCalendar size={16} className="shrink-0" />}
              tone="default"
            />
          </StatStrip>
        }
        primary={
          <CalendarWidget
            events={calendarEvents}
            defaultView="month"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const recordId = ev.id.split(':')[1] ?? '';
              const record = belegungskalender.find(b => b.record_id === recordId);
              if (record) crud.belegungskalender.openDetail(record);
            }}
            onRangeCreate={(start, end) => {
              // Check minimum 3 nights
              const nights = Math.round((end.getTime() - start.getTime()) / 86400000);
              if (nights < 3) return;
              crud.belegungskalender.openCreate({
                anreisedatum: format(start, 'yyyy-MM-dd'),
                abreisedatum: format(end, 'yyyy-MM-dd'),
                status: 'belegt',
              });
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={visibleAnfragen.map(a => ({
                id: a.record_id,
                title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || tx('Unbekannt'),
                secondLine: (
                  <>
                    <span className="text-muted-foreground">
                      {formatDate(a.fields.wunsch_anreise)} – {formatDate(a.fields.wunsch_abreise)}
                    </span>
                    {a.fields.anzahl_personen != null && (
                      <span className="text-muted-foreground"> · {a.fields.anzahl_personen} {tx('Pers.')}</span>
                    )}
                  </>
                ),
                action: {
                  label: tx('Bestätigen'),
                  onClick: () => handleConfirmAnfrage(a),
                },
              }))}
              onItemClick={id => {
                const record = buchungsanfrage.find(a => a.record_id === id);
                if (record) crud.buchungsanfrage.openDetail(record);
              }}
              empty={{
                text: tx('Keine offenen Anfragen — alles erledigt!'),
                action: { label: tx('Neue Anfrage'), onClick: () => crud.buchungsanfrage.openCreate({}) },
              }}
            />

            <WorkList
              title={tx('Bald belegte Zeiträume')}
              items={kommendeGaeste.slice(0, 5).map(b => ({
                id: b.record_id,
                title: b.fields.interne_notiz || tx('Belegt'),
                secondLine: (
                  <span className="text-muted-foreground">
                    {formatDate(b.fields.anreisedatum)} – {formatDate(b.fields.abreisedatum)}
                  </span>
                ),
                action: {
                  label: tx('Details'),
                  onClick: () => crud.belegungskalender.openDetail(b),
                },
              }))}
              onItemClick={id => {
                const record = belegungskalender.find(b => b.record_id === id);
                if (record) crud.belegungskalender.openDetail(record);
              }}
              empty={{
                text: tx('Keine Buchungen in den nächsten 30 Tagen.'),
                action: { label: tx('Termin eintragen'), onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }) },
              }}
            />
          </>
        }
      />

      {crud.surfaces}
    </div>
  );
}
