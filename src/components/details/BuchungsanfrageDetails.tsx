import type { Buchungsanfrage } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';

export interface BuchungsanfrageDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Buchungsanfrage;
}

export function BuchungsanfrageDetails({
  record,
}: BuchungsanfrageDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('buchungsanfrage', 'wunsch_anreise')} value={record.fields.wunsch_anreise} format="date" />
        <RecordField label={fieldLabel('buchungsanfrage', 'wunsch_abreise')} value={record.fields.wunsch_abreise} format="date" />
        <RecordField label={fieldLabel('buchungsanfrage', 'anzahl_personen')} value={record.fields.anzahl_personen} format="text" />
        <RecordField label={fieldLabel('buchungsanfrage', 'vorname')} value={record.fields.vorname} format="text" />
        <RecordField label={fieldLabel('buchungsanfrage', 'nachname')} value={record.fields.nachname} format="text" />
        <RecordField label={fieldLabel('buchungsanfrage', 'email')} value={record.fields.email} format="email" />
        <RecordField label={fieldLabel('buchungsanfrage', 'telefon')} value={record.fields.telefon} format="text" />
        <RecordField label={fieldLabel('buchungsanfrage', 'anmerkungen')} value={record.fields.anmerkungen} format="longtext" className="md:col-span-2" />
        <RecordField label={fieldLabel('buchungsanfrage', 'datenschutz')} value={record.fields.datenschutz} format="bool" />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.BUCHUNGSANFRAGE} recordId={record.record_id} />
    </>
  );
}
