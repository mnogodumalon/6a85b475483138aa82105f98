/**
 * EntityCrud — pre-generated CRUD + overlay plumbing for the dashboard.
 * Compose it; NEVER re-roll dialog state, submit handlers, an overlay stack
 * or a RecordOverlayHost in the page — this file owns all of it.
 *
 * API at a glance:
 *   const data = useDashboardData();
 *   const crud = useEntityCrud(data, {
 *     // optional — the ONE semantic slot on the overlay: the record's next
 *     // workflow step. Return undefined for types without one.
 *     footer: (top) => top.type === 'belegungskalender'
 *       ? { label: …, onClick: () => … }
 *       : undefined,
 *   });
 *
 *   `top.type` is the SAME camelCase key as `crud.<entity>` — one spelling
 *   per entity, everywhere in this API.
 *   …
 *   crud.belegungskalender.openCreate({ …defaults })   // create dialog, prefilled — defaults are
 *                                       // shape-tolerant: bare lookup keys / record ids are fine
 *   crud.belegungskalender.openEdit(record)            // edit dialog (recordId + defaults wired)
 *   crud.belegungskalender.openDetail(record)          // record overlay — pass the RAW record,
 *                                       // enrichment is resolved inside
 *   crud.overlay                         // RecordOverlayStack<OverlayItem> for drills:
 *                                       // push / pop / replace / close
 *   crud.enriched.belegungskalender              // the display-ready array for EVERY entity —
 *                                       // Enriched* where relations exist, the raw array
 *                                       // otherwise. Reuse these; never call enrich*()
 *                                       // in the page, and never guess which entity has
 *                                       // one: they all do.
 *   {crud.surfaces}                      // render ONCE at the end of the page JSX:
 *                                       // all entity dialogs + the overlay host
 *
 * Built in (do NOT re-implement): optimistic update + Rückgängig counter-write
 * on edit, fetchAll-on-error, edit-from-overlay, and per-entity overlay bodies
 * (RecordHeader + <{Entity}Details> with every relation reachable and the
 * contextual "+" prefilled). Drag writes (onEventDrop/onCardMove) stay YOURS:
 * optimistic setter first, PATCH in background, undoToast with counter-write.
 *
 * Overlay content per entity (the host renders these — you never compose
 * Details blocks yourself):
 *   belegungskalender: anreisedatum, abreisedatum, status, interne_notiz
 *   buchungsanfrage: wunsch_anreise, wunsch_abreise, anzahl_personen, vorname, nachname, email, telefon, anmerkungen, …
 */
import { useState, type ReactNode } from 'react';
import type { Belegungskalender, Buchungsanfrage } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { useDashboardData } from '@/hooks/useDashboardData';
import {
  useRecordOverlayStack, RecordOverlayHost, RecordHeader,
  type RecordOverlayStack,
} from '@/components/widgets/RecordView';
import { BelegungskalenderDialog, type BelegungskalenderDialogDefaults } from '@/components/dialogs/BelegungskalenderDialog';
import { BelegungskalenderDetails } from '@/components/details/BelegungskalenderDetails';
import { BuchungsanfrageDialog, type BuchungsanfrageDialogDefaults } from '@/components/dialogs/BuchungsanfrageDialog';
import { BuchungsanfrageDetails } from '@/components/details/BuchungsanfrageDetails';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { t, appLabel } from '@/i18n';
import { undoToast } from '@/lib/polish';
import { formatDate } from '@/lib/formatters';

// The overlay union — one branch per entity, `record` typed the way the data
// flows: Enriched* where enrichment exists, the raw record type otherwise.
// The host resolves enrichment itself; pages pass raw records everywhere.
export type OverlayItem =
  | { type: 'belegungskalender'; record: Belegungskalender }
  | { type: 'buchungsanfrage'; record: Buchungsanfrage };

/** The useDashboardData() return — pass it in, never re-fetch inside. */
export type EntityCrudData = ReturnType<typeof useDashboardData>;

export interface EntityCrudOptions {
  /** Per-type overlay footer — the record's next workflow step. */
  footer?: (top: OverlayItem) => ReactNode | { label: ReactNode; onClick: () => void } | undefined;
  placement?: 'side' | 'center';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface EntityCrudApi<TRecord, TDefaults> {
  /** Open the create dialog, optionally prefilled (shape-tolerant defaults). */
  openCreate: (defaults?: TDefaults) => void;
  /** Open the edit dialog for a record (recordId + defaults are wired). */
  openEdit: (record: TRecord) => void;
  /** Open the record overlay (raw record is fine — enrichment resolved inside). */
  openDetail: (record: TRecord) => void;
}

export interface EntityCrud {
  /** The overlay stack for drills: push / pop / replace / close. */
  overlay: RecordOverlayStack<OverlayItem>;
  /** Render ONCE at the end of the page JSX — all dialogs + the overlay host. */
  surfaces: ReactNode;
  belegungskalender: EntityCrudApi<Belegungskalender, BelegungskalenderDialogDefaults>;
  buchungsanfrage: EntityCrudApi<Buchungsanfrage, BuchungsanfrageDialogDefaults>;
  /** The display-ready array per entity: Enriched* where an enrich function
   *  exists, the raw array otherwise. One key per entity so no page has to
   *  know which is which. Reuse these; never re-enrich in the page. */
  enriched: { belegungskalender: Belegungskalender[]; buchungsanfrage: Buchungsanfrage[] };
}

export function useEntityCrud(data: EntityCrudData, options?: EntityCrudOptions): EntityCrud {
  const overlay = useRecordOverlayStack<OverlayItem>();
  const [belegungskalenderDialog, setBelegungskalenderDialog] = useState<{ defaults?: BelegungskalenderDialogDefaults; editing?: Belegungskalender } | null>(null);
  const [buchungsanfrageDialog, setBuchungsanfrageDialog] = useState<{ defaults?: BuchungsanfrageDialogDefaults; editing?: Buchungsanfrage } | null>(null);

  function detailBelegungskalender(record: Belegungskalender, push = false) {
    const item: OverlayItem = { type: 'belegungskalender', record };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitBelegungskalender(fields: Belegungskalender['fields']) {
    const editing = belegungskalenderDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setBelegungskalender(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateBelegungskalenderEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('belegungskalender')} — ${t('crud_updated')}`, async () => {
        data.setBelegungskalender(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateBelegungskalenderEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createBelegungskalenderEntry(fields);
      undoToast(`${appLabel('belegungskalender')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  function detailBuchungsanfrage(record: Buchungsanfrage, push = false) {
    const item: OverlayItem = { type: 'buchungsanfrage', record };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitBuchungsanfrage(fields: Buchungsanfrage['fields']) {
    const editing = buchungsanfrageDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setBuchungsanfrage(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateBuchungsanfrageEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('buchungsanfrage')} — ${t('crud_updated')}`, async () => {
        data.setBuchungsanfrage(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateBuchungsanfrageEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createBuchungsanfrageEntry(fields);
      undoToast(`${appLabel('buchungsanfrage')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  const surfaces = (
    <>
      <BelegungskalenderDialog
        open={belegungskalenderDialog !== null}
        onClose={() => setBelegungskalenderDialog(null)}
        onSubmit={submitBelegungskalender}
        defaultValues={belegungskalenderDialog?.defaults}
        recordId={belegungskalenderDialog?.editing?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Belegungskalender']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Belegungskalender']}
      />
      <BuchungsanfrageDialog
        open={buchungsanfrageDialog !== null}
        onClose={() => setBuchungsanfrageDialog(null)}
        onSubmit={submitBuchungsanfrage}
        defaultValues={buchungsanfrageDialog?.defaults}
        recordId={buchungsanfrageDialog?.editing?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Buchungsanfrage']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Buchungsanfrage']}
      />
      <RecordOverlayHost
        overlay={overlay}
        placement={options?.placement}
        size={options?.size}
        footer={options?.footer}
        render={(top) => {
          if (top.type === 'belegungskalender') {
            return (
              <>
                <RecordHeader title={appLabel('belegungskalender')} subtitle={top.record.fields.anreisedatum ? formatDate(top.record.fields.anreisedatum) : undefined} />
                <BelegungskalenderDetails
                  record={top.record}
                />
              </>
            );
          }
          if (top.type === 'buchungsanfrage') {
            return (
              <>
                <RecordHeader title={top.record.fields.vorname ?? appLabel('buchungsanfrage')} subtitle={top.record.fields.wunsch_anreise ? formatDate(top.record.fields.wunsch_anreise) : undefined} />
                <BuchungsanfrageDetails
                  record={top.record}
                />
              </>
            );
          }
          return null;
        }}
        onEdit={(top) => {
          overlay.close();
          if (top.type === 'belegungskalender') setBelegungskalenderDialog({ editing: top.record, defaults: top.record.fields });
          if (top.type === 'buchungsanfrage') setBuchungsanfrageDialog({ editing: top.record, defaults: top.record.fields });
        }}
      />
    </>
  );

  return {
    overlay,
    surfaces,
    belegungskalender: {
      openCreate: (defaults?: BelegungskalenderDialogDefaults) => setBelegungskalenderDialog({ defaults }),
      openEdit: (record: Belegungskalender) => setBelegungskalenderDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Belegungskalender) => detailBelegungskalender(record, false),
    },
    buchungsanfrage: {
      openCreate: (defaults?: BuchungsanfrageDialogDefaults) => setBuchungsanfrageDialog({ defaults }),
      openEdit: (record: Buchungsanfrage) => setBuchungsanfrageDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Buchungsanfrage) => detailBuchungsanfrage(record, false),
    },
    enriched: { belegungskalender: data.belegungskalender, buchungsanfrage: data.buchungsanfrage },
  };
}
