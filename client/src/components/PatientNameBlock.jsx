import { formatChildDisplayName } from '../utils/displayName';

/**
 * Patient name with Patient ID on the next line (primary emphasis on ID).
 * @param {object} [props.child]
 * @param {string} [props.name] — used when `child` is missing
 * @param {string} [props.patientId] — overrides `child.patientId` when set
 * @param {string} [props.unknownLabel]
 * @param {'div'|'h2'|'h3'} [props.nameTag]
 */
export function PatientNameBlock({
  child,
  name,
  patientId,
  unknownLabel = 'Unknown',
  nameTag: NameTag = 'div'
}) {
  const displayName = child ? formatChildDisplayName(child) : (name ?? unknownLabel);
  let pid = null;
  if (patientId != null && String(patientId).trim() !== '') {
    pid = String(patientId).trim();
  } else if (child?.patientId != null && String(child.patientId).trim() !== '') {
    pid = String(child.patientId).trim();
  }

  const isHeading = NameTag === 'h2' || NameTag === 'h3';

  return (
    <div style={{ minWidth: 0 }}>
      <NameTag
        style={{
          margin: 0,
          fontWeight: 700,
          lineHeight: 1.25,
          ...(isHeading ? { fontSize: '18px' } : { fontSize: 'inherit' })
        }}
      >
        {displayName}
      </NameTag>
      <div
        style={{
          fontSize: '14px',
          fontWeight: 700,
          color: pid ? 'var(--color-primary)' : 'var(--color-muted)',
          marginTop: '5px',
          letterSpacing: pid ? '0.06em' : undefined,
          lineHeight: 1.2
        }}
      >
        {pid ? `ID ${pid}` : 'ID —'}
      </div>
    </div>
  );
}
