import { useMemo, useState, useCallback } from 'react';
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay, addDays, differenceInDays, isWithinInterval } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { LivingAppsService } from '@/services/livingAppsService';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { CalendarWidget, type CalendarEvent } from '@/components/widgets/CalendarWidget';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { formatDate } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { lookupOption } from '@/types/app';
import { IconCalendarEvent, IconMailOpened, IconAlertTriangle, IconBeach, IconUsers, IconCheck } from '@tabler/icons-react';

export default function DashboardOverview() {
  const data = useDashboardData();
  const { belegungskalender, setBelegungskalender, buchungsanfrage, loading, error, fetchAll } = data;
  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungsanfrage') {
        const anfrage = buchungsanfrage.find(a => a.record_id === (top as { record_id?: string }).record_id);
        if (anfrage) {
          return {
            label: tx('Als Buchung übernehmen'),
            onClick: () => {
              if (anfrage.fields.wunsch_anreise && anfrage.fields.wunsch_abreise) {
                crud.belegungskalender.openCreate({
                  anreisedatum: anfrage.fields.wunsch_anreise,
                  abreisedatum: anfrage.fields.wunsch_abreise,
                  status: 'belegt',
                  interne_notiz: [anfrage.fields.vorname, anfrage.fields.nachname].filter(Boolean).join(' '),
                });
              }
            },
          };
        }
      }
      return undefined;
    },
  });

  const clock = useClock();

  const today = format(clock, 'yyyy-MM-dd');

  // Belegte Zeiträume: Einträge mit Status "belegt" oder ohne Status (=belegt)
  const belegte = useMemo(
    () => belegungskalender.filter(b => b.fields.status?.key === 'belegt' || !b.fields.status),
    [belegungskalender]
  );

  // Aktuelle und zukünftige Belegungen
  const aktiveBelegungen = useMemo(
    () => belegte.filter(b => b.fields.abreisedatum && b.fields.abreisedatum >= today),
    [belegte, today]
  );

  // Heute anreisende Gäste
  const heuteAnreise = useMemo(
    () => belegte.filter(b => b.fields.anreisedatum === today),
    [belegte, today]
  );

  // Heute abreisende Gäste
  const heuteAbreise = useMemo(
    () => belegte.filter(b => b.fields.abreisedatum === today),
    [belegte, today]
  );

  // Auslastung nächste 30 Tage
  const auslastung30 = useMemo(() => {
    const days = 30;
    let belegtDays = 0;
    for (let i = 0; i < days; i++) {
      const d = format(addDays(clock, i), 'yyyy-MM-dd');
      const istBelegt = belegte.some(b => {
        const von = b.fields.anreisedatum;
        const bis = b.fields.abreisedatum;
        return von && bis && d >= von && d < bis;
      });
      if (istBelegt) belegtDays++;
    }
    return Math.round((belegtDays / days) * 100);
  }, [belegte, clock]);

  // Neue unbearbeitete Buchungsanfragen (letzte 14 Tage)
  const neueAnfragen = useMemo(
    () => buchungsanfrage.filter(a => {
      if (!a.createdat) return true;
      const erstellt = a.createdat.slice(0, 10);
      return erstellt >= format(addDays(clock, -14), 'yyyy-MM-dd');
    }),
    [buchungsanfrage, clock]
  );

  // Anfragen mit Wunschtermin im belegten Zeitraum
  const konflikteAnfragen = useMemo(
    () => buchungsanfrage.filter(a => {
      if (!a.fields.wunsch_anreise || !a.fields.wunsch_abreise) return false;
      return belegte.some(b => {
        if (!b.fields.anreisedatum || !b.fields.abreisedatum) return false;
        // Überschneidung: a.von < b.bis && a.bis > b.von
        return (
          a.fields.wunsch_anreise! < b.fields.abreisedatum! &&
          a.fields.wunsch_abreise! > b.fields.anreisedatum!
        );
      });
    }),
    [buchungsanfrage, belegte]
  );

  // Calendar events — alle Kalendereinträge (frei/belegt)
  const events = useMemo<CalendarEvent[]>(() => {
    return belegungskalender
      .filter(b => b.fields.anreisedatum)
      .map(b => {
        const isBelegt = b.fields.status?.key === 'belegt' || !b.fields.status;
        const label = b.fields.interne_notiz
          ? b.fields.interne_notiz.split('\n')[0]
          : isBelegt ? tx('Belegt') : tx('Frei');
        return {
          id: `belegung:${b.record_id}`,
          start: b.fields.anreisedatum!,
          end: b.fields.abreisedatum,
          allDay: true,
          title: label,
          subtitle: b.fields.abreisedatum
            ? tx`${differenceInDays(parseISO(b.fields.abreisedatum), parseISO(b.fields.anreisedatum!))} Nächte`
            : undefined,
          tone: isBelegt ? 'primary' : 'success',
        } satisfies CalendarEvent;
      });
  }, [belegungskalender]);

  // Mindestaufenthalt 3 Nächte prüfen
  const checkMinAufenthalt = useCallback((start: Date, end: Date): string | undefined => {
    const naechte = differenceInDays(end, start);
    if (naechte < 3) {
      return tx('Mindestaufenthalt: 3 Nächte');
    }
    return undefined;
  }, []);

  // Doppelbelegung prüfen
  const checkKeinKonflikt = useCallback((start: Date, end: Date, ausnahmeId?: string): string | undefined => {
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    const konflikt = belegte.find(b => {
      if (ausnahmeId && b.record_id === ausnahmeId) return false;
      if (!b.fields.anreisedatum || !b.fields.abreisedatum) return false;
      return startStr < b.fields.abreisedatum && endStr > b.fields.anreisedatum;
    });
    if (konflikt) {
      return tx('Zeitraum bereits belegt');
    }
    return undefined;
  }, [belegte]);

  // Neue Belegung aus Kalender anlegen
  const handleRangeCreate = useCallback((start: Date, end: Date) => {
    const conflict = checkKeinKonflikt(start, end);
    if (conflict) return;
    const minErr = checkMinAufenthalt(start, end);
    if (minErr) return;
    crud.belegungskalender.openCreate({
      anreisedatum: format(start, 'yyyy-MM-dd'),
      abreisedatum: format(end, 'yyyy-MM-dd'),
      status: 'belegt',
    });
  }, [checkKeinKonflikt, checkMinAufenthalt, crud]);

  // Drag: Belegung verschieben
  const handleEventDrop = useCallback(async (eventId: string, newStart: string, newEnd?: string): Promise<string | void> => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    const record = belegungskalender.find(b => b.record_id === rid);
    if (!record) return;

    // Nur belegte Einträge verschieben
    if (record.fields.status?.key === 'frei') {
      return tx('Freie Zeiträume können nicht verschoben werden');
    }

    if (newEnd) {
      const startDate = parseISO(newStart);
      const endDate = parseISO(newEnd);
      const minErr = checkMinAufenthalt(startDate, endDate);
      if (minErr) return minErr;
      const conflictErr = checkKeinKonflikt(startDate, endDate, rid);
      if (conflictErr) return conflictErr;
    }

    const oldAnreise = record.fields.anreisedatum;
    const oldAbreise = record.fields.abreisedatum;

    // Optimistisch
    setBelegungskalender(prev =>
      prev.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreisedatum: newStart, ...(newEnd ? { abreisedatum: newEnd } : {}) } }
          : b
      )
    );

    try {
      await LivingAppsService.updateBelegungskalenderEntry(rid, {
        anreisedatum: newStart,
        ...(newEnd ? { abreisedatum: newEnd } : {}),
      });
      undoToast(
        tx`Belegung verschoben`,
        async () => {
          setBelegungskalender(prev =>
            prev.map(b =>
              b.record_id === rid
                ? { ...b, fields: { ...b.fields, anreisedatum: oldAnreise, abreisedatum: oldAbreise } }
                : b
            )
          );
          await LivingAppsService.updateBelegungskalenderEntry(rid, {
            anreisedatum: oldAnreise,
            abreisedatum: oldAbreise,
          });
        }
      );
    } catch {
      await fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll, checkMinAufenthalt, checkKeinKonflikt]);

  // Drag: Belegung verlängern/kürzen
  const handleEventResize = useCallback(async (eventId: string, newStart: string, newEnd: string): Promise<string | void> => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    const record = belegungskalender.find(b => b.record_id === rid);
    if (!record) return;

    const startDate = parseISO(newStart);
    const endDate = parseISO(newEnd);
    const minErr = checkMinAufenthalt(startDate, endDate);
    if (minErr) return minErr;
    const conflictErr = checkKeinKonflikt(startDate, endDate, rid);
    if (conflictErr) return conflictErr;

    const oldAnreise = record.fields.anreisedatum;
    const oldAbreise = record.fields.abreisedatum;

    setBelegungskalender(prev =>
      prev.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreisedatum: newStart, abreisedatum: newEnd } }
          : b
      )
    );

    try {
      await LivingAppsService.updateBelegungskalenderEntry(rid, {
        anreisedatum: newStart,
        abreisedatum: newEnd,
      });
      undoToast(
        tx`Belegung angepasst`,
        async () => {
          setBelegungskalender(prev =>
            prev.map(b =>
              b.record_id === rid
                ? { ...b, fields: { ...b.fields, anreisedatum: oldAnreise, abreisedatum: oldAbreise } }
                : b
            )
          );
          await LivingAppsService.updateBelegungskalenderEntry(rid, {
            anreisedatum: oldAnreise,
            abreisedatum: oldAbreise,
          });
        }
      );
    } catch {
      await fetchAll();
    }
  }, [belegungskalender, setBelegungskalender, fetchAll, checkMinAufenthalt, checkKeinKonflikt]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Kontextzeile
  const kontextTeile: string[] = [];
  if (heuteAnreise.length > 0) {
    const namen_ = heuteAnreise.map(b => b.fields.interne_notiz?.split('\n')[0] ?? '').filter(Boolean);
    if (namen_.length > 0) {
      kontextTeile.push(tx`Anreise: ${namen(namen_)}`);
    } else {
      kontextTeile.push(tx`${heuteAnreise.length} Anreise${heuteAnreise.length > 1 ? 'n' : ''} heute`);
    }
  }
  if (heuteAbreise.length > 0) {
    kontextTeile.push(tx`${heuteAbreise.length} Abreise${heuteAbreise.length > 1 ? 'n' : ''} heute`);
  }
  if (kontextTeile.length === 0 && aktiveBelegungen.length === 0) {
    kontextTeile.push(tx('Die Wohnung ist frei — perfekt für eine neue Buchung.'));
  } else if (kontextTeile.length === 0) {
    kontextTeile.push(tx`${aktiveBelegungen.length} kommende Aufenthalt${aktiveBelegungen.length !== 1 ? 'e' : ''}`);
  }

  const naechsteAnreise = [...belegte]
    .filter(b => b.fields.anreisedatum && b.fields.anreisedatum > today)
    .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''))
    [0];

  const hero = konflikteAnfragen.length > 0 ? (
    <HeroBanner
      icon={<IconAlertTriangle size={18} />}
      action={{
        label: tx('Anfragen prüfen'),
        onClick: () => {
          const erste = konflikteAnfragen[0];
          if (erste) crud.buchungsanfrage.openDetail(erste);
        },
      }}
    >
      {konflikteAnfragen.length === 1
        ? tx`1 Buchungsanfrage betrifft einen bereits belegten Zeitraum.`
        : tx`${konflikteAnfragen.length} Buchungsanfragen betreffen bereits belegte Zeiträume.`}
    </HeroBanner>
  ) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">
          {kontextTeile.join(' · ')}
        </p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={hero}
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Auslastung (30 Tage)')}
              value={`${auslastung30} %`}
              icon={<IconBeach size={16} className="shrink-0" />}
              tone={auslastung30 >= 70 ? 'success' : auslastung30 >= 40 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Neue Anfragen')}
              value={neueAnfragen.length}
              icon={<IconMailOpened size={16} className="shrink-0" />}
              tone={neueAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => neueAnfragen.length > 0 ? crud.buchungsanfrage.openDetail(neueAnfragen[0]) : undefined}
              active={neueAnfragen.length > 0}
            />
            <StatStripItem
              title={tx('Konflikte')}
              value={konflikteAnfragen.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={konflikteAnfragen.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title={tx('Aktive Belegungen')}
              value={aktiveBelegungen.length}
              icon={<IconCalendarEvent size={16} className="shrink-0" />}
              tone="default"
            />
          </StatStrip>
        }
        primary={
          <CalendarWidget
            events={events}
            defaultView="month"
            locale={dateFnsLocale()}
            views={['month', 'week', 'agenda', 'year']}
            onEventClick={ev => {
              const rid = ev.id.split(':')[1];
              const record = belegungskalender.find(b => b.record_id === rid);
              if (record) crud.belegungskalender.openDetail(record);
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onRangeCreate={handleRangeCreate}
            onEmptyClick={date => {
              crud.belegungskalender.openCreate({
                anreisedatum: format(date, 'yyyy-MM-dd'),
                abreisedatum: format(addDays(date, 3), 'yyyy-MM-dd'),
                status: 'belegt',
              });
            }}
            dayClassName={date => {
              const d = format(date, 'yyyy-MM-dd');
              const istBelegt = belegte.some(b => {
                const von = b.fields.anreisedatum;
                const bis = b.fields.abreisedatum;
                return von && bis && d >= von && d < bis;
              });
              return istBelegt ? '' : 'bg-emerald-50/40';
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Buchungsanfragen')}
              items={buchungsanfrage.slice(0, 8).map(a => ({
                id: a.record_id,
                title: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' ') || tx('Unbekannt'),
                secondLine: (
                  <>
                    {a.fields.wunsch_anreise && a.fields.wunsch_abreise ? (
                      <span className="text-muted-foreground">
                        {formatDate(a.fields.wunsch_anreise)}
                        {' – '}
                        {formatDate(a.fields.wunsch_abreise)}
                        {a.fields.anzahl_personen ? ` · ${a.fields.anzahl_personen} ${tx('Pers.')}` : ''}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{tx('Kein Wunschtermin')}</span>
                    )}
                    {konflikteAnfragen.some(k => k.record_id === a.record_id) && (
                      <span className="ml-2 font-medium text-destructive">{tx('Konflikt')}</span>
                    )}
                  </>
                ),
                action: {
                  label: tx('Annehmen'),
                  onClick: () => {
                    if (a.fields.wunsch_anreise && a.fields.wunsch_abreise) {
                      crud.belegungskalender.openCreate({
                        anreisedatum: a.fields.wunsch_anreise,
                        abreisedatum: a.fields.wunsch_abreise,
                        status: 'belegt',
                        interne_notiz: [a.fields.vorname, a.fields.nachname].filter(Boolean).join(' '),
                      });
                    }
                  },
                },
              }))}
              onItemClick={id => {
                const a = buchungsanfrage.find(x => x.record_id === id);
                if (a) crud.buchungsanfrage.openDetail(a);
              }}
              empty={{
                text: tx('Keine Buchungsanfragen — teile deinen Buchungslink mit Gästen!'),
                action: {
                  label: tx('Neue Anfrage erfassen'),
                  onClick: () => crud.buchungsanfrage.openCreate({}),
                },
              }}
            />
            <WorkList
              title={tx('Kommende Aufenthalte')}
              items={aktiveBelegungen
                .sort((a, b) => (a.fields.anreisedatum ?? '').localeCompare(b.fields.anreisedatum ?? ''))
                .slice(0, 6)
                .map(b => ({
                  id: b.record_id,
                  title: b.fields.interne_notiz?.split('\n')[0] ?? tx('Gast'),
                  secondLine: (
                    <span className="text-muted-foreground">
                      {formatDate(b.fields.anreisedatum)}
                      {b.fields.abreisedatum ? ` – ${formatDate(b.fields.abreisedatum)}` : ''}
                      {b.fields.anreisedatum && b.fields.abreisedatum
                        ? ` · ${differenceInDays(parseISO(b.fields.abreisedatum), parseISO(b.fields.anreisedatum))} ${tx('Nächte')}`
                        : ''}
                    </span>
                  ),
                  action: {
                    label: tx('Notiz'),
                    onClick: () => crud.belegungskalender.openEdit(b),
                  },
                }))}
              onItemClick={id => {
                const b = belegungskalender.find(x => x.record_id === id);
                if (b) crud.belegungskalender.openDetail(b);
              }}
              empty={{
                text: naechsteAnreise
                  ? `${tx('Nächste Anreise:')} ${formatDate(naechsteAnreise.fields.anreisedatum)}`
                  : tx('Noch keine Belegungen — ziehe im Kalender einen Zeitraum auf!'),
                action: {
                  label: tx('Neue Belegung'),
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
