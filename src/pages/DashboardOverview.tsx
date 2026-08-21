import { useMemo, useState, useCallback } from 'react';
import { format, parseISO, isAfter, isBefore, startOfToday, differenceInDays, addDays, isWithinInterval } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { useClock, gruss, undoToast } from '@/lib/polish';
import { tx, dateFnsLocale } from '@/i18n';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { CalendarWidget, type CalendarEvent, type CalendarTone } from '@/components/widgets/CalendarWidget';
import type { Belegungskalender } from '@/types/app';
import { lookupOption } from '@/types/app';
import { IconCalendarCheck, IconCalendarX, IconUsers, IconInbox, IconBriefcase, IconAlertTriangle } from '@tabler/icons-react';

const EVENT_PREFIX = 'belegung';

function toneForBuchung(b: Belegungskalender): CalendarTone {
  const key = b.fields.status?.key;
  if (key === 'belegt') return 'primary';
  return 'success';
}

export default function DashboardOverview() {
  const data = useDashboardData();
  const { belegungskalender, setBelegungskalender, buchungsanfrage, loading, error, fetchAll } = data;

  const crud = useEntityCrud(data);
  const clock = useClock();

  const today = format(clock, 'yyyy-MM-dd');

  const events = useMemo<CalendarEvent[]>(
    () =>
      belegungskalender
        .filter(b => !!b.fields.anreisedatum)
        .map(b => ({
          id: `${EVENT_PREFIX}:${b.record_id}`,
          start: b.fields.anreisedatum!,
          end: b.fields.abreisedatum,
          allDay: true,
          title: b.fields.status?.key === 'belegt' ? tx('Belegt') : tx('Frei gehalten'),
          subtitle: b.fields.interne_notiz
            ? b.fields.interne_notiz.split('\n')[0]
            : undefined,
          tone: toneForBuchung(b),
        })),
    [belegungskalender],
  );

  // Heutige Buchungen (Anreise heute oder aktuell belegt)
  const heuteAnreise = useMemo(() =>
    belegungskalender.filter(b => b.fields.anreisedatum === today),
    [belegungskalender, today],
  );

  const belegtHeute = useMemo(() =>
    belegungskalender.filter(b => {
      if (!b.fields.anreisedatum || !b.fields.abreisedatum) return false;
      try {
        return isWithinInterval(parseISO(today), {
          start: parseISO(b.fields.anreisedatum),
          end: parseISO(b.fields.abreisedatum),
        });
      } catch { return false; }
    }),
    [belegungskalender, today],
  );

  // Neue / offene Anfragen (ohne Verknüpfung zur Belegung)
  const offeneAnfragen = useMemo(() =>
    buchungsanfrage.filter(a => !!a.fields.wunsch_anreise),
    [buchungsanfrage],
  );

  // Belegung für die nächsten 30 Tage
  const next30Start = today;
  const next30End = format(addDays(clock, 30), 'yyyy-MM-dd');
  const belegungenNext30 = useMemo(() =>
    belegungskalender.filter(b => {
      if (!b.fields.anreisedatum) return false;
      return b.fields.anreisedatum >= next30Start && b.fields.anreisedatum <= next30End;
    }),
    [belegungskalender, next30Start, next30End],
  );

  // Nächste Anreise
  const naechsteAnreise = useMemo(() => {
    const kuenftige = belegungskalender
      .filter(b => b.fields.anreisedatum && b.fields.anreisedatum >= today)
      .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''));
    return kuenftige[0] ?? null;
  }, [belegungskalender, today]);

  // Abreise heute
  const heuteAbreise = useMemo(() =>
    belegungskalender.filter(b => b.fields.abreisedatum === today),
    [belegungskalender, today],
  );

  const [filter, setFilter] = useState<'anreise' | 'anfragen' | null>(null);

  const handleEventDrop = useCallback(async (eventId: string, newStart: string, newEnd?: string) => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    const prev = belegungskalender.find(b => b.record_id === rid);
    if (!prev) return;
    // Mindestaufenthalt 3 Nächte prüfen
    if (newEnd) {
      const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
      if (nights < 3) {
        return tx('Mindestaufenthalt: 3 Nächte');
      }
    }
    const snapshot = { anreisedatum: prev.fields.anreisedatum, abreisedatum: prev.fields.abreisedatum };
    setBelegungskalender(list =>
      list.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
          : b,
      ),
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(rid, {
        anreisedatum: newStart,
        ...(newEnd ? { abreisedatum: newEnd } : {}),
      });
      undoToast(tx`Buchung verschoben`, async () => {
        setBelegungskalender(list =>
          list.map(b => b.record_id === rid ? { ...b, fields: { ...b.fields, ...snapshot } } : b),
        );
        await LivingAppsService.updateBelegungskalenderEntry(rid, snapshot);
      });
    } catch {
      await fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll]);

  const handleEventResize = useCallback(async (eventId: string, newStart: string, newEnd: string) => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    const nights = differenceInDays(parseISO(newEnd), parseISO(newStart));
    if (nights < 3) {
      return tx('Mindestaufenthalt: 3 Nächte');
    }
    const prev = belegungskalender.find(b => b.record_id === rid);
    if (!prev) return;
    const snapshot = { anreisedatum: prev.fields.anreisedatum, abreisedatum: prev.fields.abreisedatum };
    setBelegungskalender(list =>
      list.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreisedatum: newStart, abreisedatum: newEnd } }
          : b,
      ),
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(rid, { anreisedatum: newStart, abreisedatum: newEnd });
      undoToast(tx`Buchungsdauer geändert`, async () => {
        setBelegungskalender(list =>
          list.map(b => b.record_id === rid ? { ...b, fields: { ...b.fields, ...snapshot } } : b),
        );
        await LivingAppsService.updateBelegungskalenderEntry(rid, snapshot);
      });
    } catch {
      await fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll]);

  const handleStatusToggle = useCallback(async (b: Belegungskalender) => {
    const newKey = b.fields.status?.key === 'belegt' ? 'frei' : 'belegt';
    const newStatus = lookupOption('belegungskalender', 'status', newKey);
    const oldStatus = b.fields.status;
    setBelegungskalender(list =>
      list.map(x => x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: newStatus } } : x),
    );
    try {
      await LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: newKey });
      undoToast(tx`Status geändert`, async () => {
        setBelegungskalender(list =>
          list.map(x => x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: oldStatus } } : x),
        );
        await LivingAppsService.updateBelegungskalenderEntry(b.record_id, { status: oldStatus?.key ?? 'belegt' });
      });
    } catch {
      await fetchAll();
    }
  }, [setBelegungskalender, fetchAll]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Kontext-Zeile
  const kontextTeile: string[] = [];
  if (heuteAnreise.length > 0) {
    kontextTeile.push(tx`${heuteAnreise.length} Anreise heute`);
  }
  if (heuteAbreise.length > 0) {
    kontextTeile.push(tx`${heuteAbreise.length} Abreise heute`);
  }
  if (offeneAnfragen.length > 0) {
    kontextTeile.push(tx`${offeneAnfragen.length} offene Anfrage`);
  }
  if (kontextTeile.length === 0 && naechsteAnreise) {
    kontextTeile.push(tx`Nächste Anreise: ${formatDate(naechsteAnreise.fields.anreisedatum)}`);
  }
  if (kontextTeile.length === 0) {
    kontextTeile.push(tx('Noch keine Buchungen eingetragen.'));
  }

  const heroElement = offeneAnfragen.length > 0 ? (
    <HeroBanner
      icon={<IconInbox size={18} />}
      action={{
        label: tx('Anfrage ansehen'),
        onClick: () => crud.buchungsanfrage.openDetail(offeneAnfragen[0]),
      }}
    >
      {offeneAnfragen.length === 1
        ? tx`Eine neue Buchungsanfrage wartet auf deine Antwort.`
        : tx`${offeneAnfragen.length} Buchungsanfragen warten auf deine Antwort.`}
    </HeroBanner>
  ) : undefined;

  const kpisElement = (
    <StatStrip>
      <StatStripItem
        title={tx('Heute belegt')}
        value={belegtHeute.length}
        icon={<IconBriefcase size={16} className="shrink-0" />}
        tone={belegtHeute.length > 0 ? 'primary' : 'default'}
      />
      <StatStripItem
        title={tx('Anreisen heute')}
        value={heuteAnreise.length}
        icon={<IconCalendarCheck size={16} className="shrink-0" />}
        tone={heuteAnreise.length > 0 ? 'success' : 'default'}
        onClick={() => setFilter(f => f === 'anreise' ? null : 'anreise')}
        active={filter === 'anreise'}
      />
      <StatStripItem
        title={tx('Buchungen nächste 30 Tage')}
        value={belegungenNext30.length}
        icon={<IconCalendarCheck size={16} className="shrink-0" />}
        tone="default"
      />
      <StatStripItem
        title={tx('Neue Anfragen')}
        value={offeneAnfragen.length}
        icon={<IconInbox size={16} className="shrink-0" />}
        tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
        onClick={() => setFilter(f => f === 'anfragen' ? null : 'anfragen')}
        active={filter === 'anfragen'}
      />
    </StatStrip>
  );

  const asideElement = (
    <>
      <WorkList
        title={tx('Heutige Bewegungen')}
        items={[
          ...heuteAnreise.map(b => ({
            id: `an:${b.record_id}`,
            title: formatDate(b.fields.anreisedatum),
            secondLine: (
              <>
                <span className="font-medium text-emerald-600">{tx('Anreise')}</span>
                {b.fields.abreisedatum && (
                  <span className="text-muted-foreground"> · {tx('bis')} {formatDate(b.fields.abreisedatum)}</span>
                )}
              </>
            ),
            action: {
              label: b.fields.status?.key === 'belegt' ? tx('→ Frei') : tx('→ Belegt'),
              onClick: () => handleStatusToggle(b),
            },
          })),
          ...heuteAbreise.map(b => ({
            id: `ab:${b.record_id}`,
            title: formatDate(b.fields.abreisedatum),
            secondLine: (
              <span className="font-medium text-amber-600">{tx('Abreise')}</span>
            ),
            action: {
              label: b.fields.status?.key === 'belegt' ? tx('→ Frei') : tx('→ Belegt'),
              onClick: () => handleStatusToggle(b),
            },
          })),
        ]}
        onItemClick={id => {
          const rid = id.split(':')[1];
          const rec = belegungskalender.find(b => b.record_id === rid);
          if (rec) crud.belegungskalender.openDetail(rec);
        }}
        empty={{
          text: naechsteAnreise
            ? tx`Nächste Anreise: ${formatDate(naechsteAnreise.fields.anreisedatum)}`
            : tx('Heute keine Anreisen oder Abreisen.'),
          action: {
            label: tx('Neue Buchung anlegen'),
            onClick: () => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: today }),
          },
        }}
      />
      <WorkList
        title={tx('Offene Anfragen')}
        items={offeneAnfragen.map(a => ({
          id: a.record_id,
          title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('Unbekannt'),
          secondLine: (
            <>
              <span className="text-muted-foreground">
                {formatDate(a.fields.wunsch_anreise)}
                {a.fields.wunsch_abreise ? ` – ${formatDate(a.fields.wunsch_abreise)}` : ''}
              </span>
              {a.fields.anzahl_personen != null && (
                <span className="text-muted-foreground"> · {a.fields.anzahl_personen} {tx('Pers.')}</span>
              )}
            </>
          ),
          action: { label: tx('Details'), onClick: () => crud.buchungsanfrage.openDetail(a) },
        }))}
        onItemClick={id => {
          const rec = buchungsanfrage.find(a => a.record_id === id);
          if (rec) crud.buchungsanfrage.openDetail(rec);
        }}
        empty={{
          text: tx('Keine offenen Anfragen.'),
          action: {
            label: tx('Buchung direkt eintragen'),
            onClick: () => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: today }),
          },
        }}
      />
    </>
  );

  const primaryElement = (
    <CalendarWidget
      events={events}
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
        const nights = differenceInDays(end, start);
        if (nights < 3) return;
        crud.belegungskalender.openCreate({
          status: 'belegt',
          anreisedatum: format(start, 'yyyy-MM-dd'),
          abreisedatum: format(end, 'yyyy-MM-dd'),
        });
      }}
      onEmptyClick={date => {
        crud.belegungskalender.openCreate({
          status: 'belegt',
          anreisedatum: format(date, 'yyyy-MM-dd'),
        });
      }}
      renderDayBackground={date => {
        const d = format(date, 'yyyy-MM-dd');
        const isBelegt = belegungskalender.some(b => {
          if (!b.fields.anreisedatum || b.fields.status?.key !== 'belegt') return false;
          const von = b.fields.anreisedatum;
          const bis = b.fields.abreisedatum ?? von;
          return d >= von && d <= bis;
        });
        if (!isBelegt) return null;
        return (
          <div className="absolute inset-0 -z-10 bg-primary/5 rounded-sm" />
        );
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-0.5">{kontextTeile.join(' · ')}</p>
        <div className="mt-3 flex gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            onClick={() => crud.belegungskalender.openCreate({ status: 'belegt', anreisedatum: today })}
          >
            <IconCalendarCheck size={15} className="shrink-0" />
            {tx('Neue Buchung')}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
            onClick={() => crud.buchungsanfrage.openCreate({})}
          >
            <IconInbox size={15} className="shrink-0" />
            {tx('Anfrage erfassen')}
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroElement}
        kpis={kpisElement}
        aside={asideElement}
        primary={primaryElement}
      />

      {crud.surfaces}
    </div>
  );
}
