import { useState, useMemo } from 'react';
import { format, parseISO, isAfter, isBefore, addDays, differenceInDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import type { CalendarEvent } from '@/components/widgets/CalendarWidget';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { formatDate } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { lookupOption } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import {
  IconCalendarCheck,
  IconMailQuestion,
  IconBed,
  IconCalendarOff,
  IconUsers,
  IconCheck,
} from '@tabler/icons-react';

export default function DashboardOverview() {
  const data = useDashboardData();
  const {
    belegungskalender, setBelegungskalender,
    buchungsanfrage,
    loading, error, fetchAll,
  } = data;

  const crud = useEntityCrud(data);
  const clock = useClock();

  const [activeFilter, setActiveFilter] = useState<'anfragen' | 'belegt' | null>(null);

  // Calendar events: belegungen mapped to CalendarEvent — must be above early returns
  const calendarEvents: CalendarEvent[] = useMemo(() => {
    return belegungskalender
      .filter(b => b.fields.anreisedatum && b.fields.abreisedatum)
      .map(b => {
        const statusKey = b.fields.status?.key ?? 'belegt';
        const tone: CalendarEvent['tone'] = statusKey === 'frei' ? 'success' : 'primary';
        const nights = b.fields.anreisedatum && b.fields.abreisedatum
          ? differenceInDays(parseISO(b.fields.abreisedatum), parseISO(b.fields.anreisedatum))
          : 0;
        return {
          id: `belegung:${b.record_id}`,
          start: b.fields.anreisedatum!,
          end: b.fields.abreisedatum!,
          allDay: true,
          title: statusKey === 'frei' ? tx('Verfügbar') : tx('Belegt'),
          subtitle: nights > 0 ? (nights === 1 ? tx`${nights} Nacht` : tx`${nights} Nächte`) : undefined,
          tone,
        };
      });
  }, [belegungskalender]);

  // ─── All hooks above, derivations below ───────────────────────────────────

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  const today = format(clock, 'yyyy-MM-dd');
  const in30 = format(addDays(clock, 30), 'yyyy-MM-dd');
  const in7 = format(addDays(clock, 7), 'yyyy-MM-dd');

  // Pending requests (new booking inquiries)
  const offeneAnfragen = buchungsanfrage.filter(a => {
    const anreise = a.fields.wunsch_anreise;
    return anreise && anreise >= today;
  });

  // Upcoming arrivals in next 7 days
  const baldAnreisen = belegungskalender.filter(b => {
    const anreise = b.fields.anreisedatum;
    return anreise && anreise >= today && anreise <= in7 && b.fields.status?.key === 'belegt';
  });

  // Belegungen in next 30 days
  const naechste30 = belegungskalender.filter(b => {
    const anreise = b.fields.anreisedatum;
    return anreise && anreise >= today && anreise <= in30 && b.fields.status?.key === 'belegt';
  });

  // Currently booked (anreise in past, abreise in future)
  const jetztBelegt = belegungskalender.filter(b => {
    const anreise = b.fields.anreisedatum;
    const abreise = b.fields.abreisedatum;
    return anreise && abreise && anreise <= today && abreise >= today && b.fields.status?.key === 'belegt';
  });

  // Hero: upcoming arrivals very soon (next 3 days)
  const in3 = format(addDays(clock, 3), 'yyyy-MM-dd');
  const sehrBaldAnreisen = baldAnreisen.filter(b => b.fields.anreisedatum! <= in3);

  // Confirm a booking request = create a Belegung + mark as processed
  const handleAnfrageConfirm = async (anfrage: typeof buchungsanfrage[0]) => {
    const snapshot = [...belegungskalender];
    const newBelegung = {
      anreisedatum: anfrage.fields.wunsch_anreise,
      abreisedatum: anfrage.fields.wunsch_abreise,
      status: 'belegt',
    };
    try {
      await LivingAppsService.createBelegungskalenderEntry(newBelegung);
      undoToast(tx`Buchung für ${anfrage.fields.vorname ?? ''} ${anfrage.fields.nachname ?? ''} eingetragen`, async () => {
        setBelegungskalender(snapshot);
        fetchAll();
      });
      fetchAll();
    } catch {
      setBelegungskalender(snapshot);
    }
  };

  // Mark a period as free
  const handleMarkFrei = async (belegung: typeof belegungskalender[0]) => {
    const prev = belegungskalender.find(b => b.record_id === belegung.record_id);
    setBelegungskalender(belegungskalender.map(b =>
      b.record_id === belegung.record_id
        ? { ...b, fields: { ...b.fields, status: lookupOption('belegungskalender', 'status', 'frei') } }
        : b
    ));
    try {
      await LivingAppsService.updateBelegungskalenderEntry(belegung.record_id, { status: 'frei' });
      undoToast(tx`Zeitraum als frei markiert`, async () => {
        if (prev) {
          setBelegungskalender(belegungskalender.map(b =>
            b.record_id === belegung.record_id ? prev : b
          ));
          await LivingAppsService.updateBelegungskalenderEntry(belegung.record_id, { status: 'belegt' });
        }
      });
    } catch {
      fetchAll();
    }
  };

  // Drag-to-reschedule a belegung
  const handleEventDrop = async (eventId: string, newStart: string, newEnd?: string) => {
    const id = eventId.split(':')[1];
    const b = belegungskalender.find(b => b.record_id === id);
    if (!b) return;

    // Check min 3 nights
    if (newEnd) {
      const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
      if (nights < 3) return tx`Mindestaufenthalt: 3 Nächte`;
    }

    const prevAnreise = b.fields.anreisedatum;
    const prevAbreise = b.fields.abreisedatum;
    setBelegungskalender(belegungskalender.map(bel =>
      bel.record_id === id
        ? { ...bel, fields: { ...bel.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
        : bel
    ));
    try {
      await LivingAppsService.updateBelegungskalenderEntry(id, {
        anreisedatum: newStart,
        ...(newEnd ? { abreisedatum: newEnd } : {}),
      });
      undoToast(tx`Belegung verschoben`, async () => {
        setBelegungskalender(belegungskalender.map(bel =>
          bel.record_id === id
            ? { ...bel, fields: { ...bel.fields, anreisedatum: prevAnreise, abreisedatum: prevAbreise } }
            : bel
        ));
        await LivingAppsService.updateBelegungskalenderEntry(id, {
          anreisedatum: prevAnreise,
          abreisedatum: prevAbreise,
        });
      });
    } catch {
      fetchAll();
    }
  };

  // Drag-to-resize a belegung
  const handleEventResize = async (eventId: string, newStart: string, newEnd: string) => {
    const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
    if (nights < 3) return tx`Mindestaufenthalt: 3 Nächte`;

    const id = eventId.split(':')[1];
    const b = belegungskalender.find(b => b.record_id === id);
    if (!b) return;
    const prevAbreise = b.fields.abreisedatum;
    setBelegungskalender(belegungskalender.map(bel =>
      bel.record_id === id
        ? { ...bel, fields: { ...bel.fields, abreisedatum: newEnd } }
        : bel
    ));
    try {
      await LivingAppsService.updateBelegungskalenderEntry(id, { abreisedatum: newEnd });
      undoToast(tx`Abreise angepasst`, async () => {
        setBelegungskalender(belegungskalender.map(bel =>
          bel.record_id === id
            ? { ...bel, fields: { ...bel.fields, abreisedatum: prevAbreise } }
            : bel
        ));
        await LivingAppsService.updateBelegungskalenderEntry(id, { abreisedatum: prevAbreise });
      });
    } catch {
      fetchAll();
    }
  };

  // Create from calendar drag (range select)
  const handleRangeCreate = (start: Date, end: Date) => {
    const nights = differenceInDays(end, start);
    crud.belegungskalender.openCreate({
      anreisedatum: format(start, 'yyyy-MM-dd'),
      abreisedatum: format(end, 'yyyy-MM-dd'),
      status: nights >= 3 ? 'belegt' : 'belegt',
    });
  };

  // Context line
  const naechsteAnreise = belegungskalender
    .filter(b => b.fields.anreisedatum && b.fields.anreisedatum >= today && b.fields.status?.key === 'belegt')
    .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''))[0];

  let contextLine: string;
  if (jetztBelegt.length > 0) {
    const abreise = jetztBelegt[0]?.fields.abreisedatum;
    contextLine = abreise
      ? String(tx`Die Wohnung ist aktuell belegt — Abreise am ${formatDate(abreise)}.`)
      : String(tx`Die Wohnung ist aktuell belegt.`);
  } else if (naechsteAnreise) {
    contextLine = String(tx`Nächste Belegung: ${formatDate(naechsteAnreise.fields.anreisedatum)}.`);
  } else {
    contextLine = String(tx`Keine Buchungen in nächster Zeit — die Wohnung ist frei.`);
  }

  const greeting = gruss(clock);

  // Hero: arrivals in 3 days that might need prep
  const heroBanner = sehrBaldAnreisen.length > 0 && (
    <HeroBanner
      icon={<IconBed size={18} />}
      action={{
        label: tx('Details ansehen'),
        onClick: () => crud.belegungskalender.openDetail(sehrBaldAnreisen[0]),
      }}
    >
      {tx`Anreise in ${differenceInDays(parseISO(sehrBaldAnreisen[0].fields.anreisedatum!), clock)} Tagen`}{' '}
      — {formatDate(sehrBaldAnreisen[0].fields.anreisedatum)} {tx`bis`} {formatDate(sehrBaldAnreisen[0].fields.abreisedatum)}.
    </HeroBanner>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{greeting}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroBanner}
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Belegungen (30 Tage)')}
              value={naechste30.length}
              icon={<IconCalendarCheck size={16} className="shrink-0" />}
              tone={naechste30.length > 0 ? 'primary' : 'default'}
              onClick={() => setActiveFilter(f => f === 'belegt' ? null : 'belegt')}
              active={activeFilter === 'belegt'}
            />
            <StatStripItem
              title={tx('Offene Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconMailQuestion size={16} className="shrink-0" />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setActiveFilter(f => f === 'anfragen' ? null : 'anfragen')}
              active={activeFilter === 'anfragen'}
            />
            <StatStripItem
              title={tx('Bald anreisend (7 Tage)')}
              value={baldAnreisen.length}
              icon={<IconUsers size={16} className="shrink-0" />}
              tone={baldAnreisen.length > 0 ? 'success' : 'default'}
            />
            <StatStripItem
              title={tx('Aktuell belegt')}
              value={jetztBelegt.length > 0 ? tx('Ja') : tx('Frei')}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={jetztBelegt.length > 0 ? 'primary' : 'success'}
            />
          </StatStrip>
        }
        primary={
          <CalendarWidget
            events={calendarEvents}
            defaultView="month"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const id = ev.id.split(':')[1];
              const b = belegungskalender.find(b => b.record_id === id);
              if (b) crud.belegungskalender.openDetail(b);
            }}
            onRangeCreate={handleRangeCreate}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            views={['month', 'week', 'agenda']}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={(activeFilter === 'anfragen' ? offeneAnfragen : offeneAnfragen.slice(0, 5)).map(a => ({
                id: a.record_id,
                title: `${a.fields.vorname ?? ''} ${a.fields.nachname ?? ''}`.trim() || tx('Unbekannt'),
                secondLine: (
                  <>
                    <span className="text-muted-foreground">
                      {formatDate(a.fields.wunsch_anreise)} – {formatDate(a.fields.wunsch_abreise)}
                    </span>
                    {a.fields.anzahl_personen != null && (
                      <span className="text-muted-foreground"> · {a.fields.anzahl_personen} {tx('Personen')}</span>
                    )}
                  </>
                ),
                action: {
                  label: tx('Eintragen'),
                  onClick: () => handleAnfrageConfirm(a),
                },
              }))}
              onItemClick={id => {
                const a = buchungsanfrage.find(a => a.record_id === id);
                if (a) crud.buchungsanfrage.openDetail(a);
              }}
              empty={{
                text: tx('Keine offenen Anfragen — alles bearbeitet.'),
                action: {
                  label: tx('Neue Belegung eintragen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }),
                },
              }}
            />

            <WorkList
              title={tx('Nächste Belegungen (30 Tage)')}
              items={naechste30.slice(0, 5).map(b => ({
                id: b.record_id,
                title: formatDate(b.fields.anreisedatum),
                secondLine: (
                  <>
                    <span className="text-muted-foreground">
                      {tx`bis ${formatDate(b.fields.abreisedatum)}`}
                    </span>
                    {b.fields.interne_notiz && (
                      <span className="text-muted-foreground"> · {b.fields.interne_notiz.slice(0, 40)}{b.fields.interne_notiz.length > 40 ? '…' : ''}</span>
                    )}
                  </>
                ),
                action: {
                  label: tx('Freigeben'),
                  onClick: () => handleMarkFrei(b),
                },
              }))}
              onItemClick={id => {
                const b = belegungskalender.find(b => b.record_id === id);
                if (b) crud.belegungskalender.openDetail(b);
              }}
              empty={{
                text: naechsteAnreise
                  ? String(tx`Nächste Buchung: ${formatDate(naechsteAnreise.fields.anreisedatum)}`)
                  : tx('Noch keine Belegungen eingetragen.'),
                action: {
                  label: tx('Belegung eintragen'),
                  onClick: () => crud.belegungskalender.openCreate({ status: 'belegt' }),
                },
              }}
            />
          </>
        }
      />

      {crud.surfaces}
    </div>
  );
}
