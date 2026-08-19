import type { Belegungskalender } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';

export interface BelegungskalenderDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Belegungskalender;
}

export function BelegungskalenderDetails({
  record,
}: BelegungskalenderDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('belegungskalender', 'anreisedatum')} value={record.fields.anreisedatum} format="date" />
        <RecordField label={fieldLabel('belegungskalender', 'abreisedatum')} value={record.fields.abreisedatum} format="date" />
        <RecordField label={fieldLabel('belegungskalender', 'status')} value={record.fields.status} format="pill" />
        <RecordField label={fieldLabel('belegungskalender', 'interne_notiz')} value={record.fields.interne_notiz} format="longtext" className="md:col-span-2" />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.BELEGUNGSKALENDER} recordId={record.record_id} />
    </>
  );
}
