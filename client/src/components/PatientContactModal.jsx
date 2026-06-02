import { useEffect, useState } from 'react';
import { formatChildDisplayName } from '../utils/displayName';
import { PatientNameBlock } from './PatientNameBlock';
import { buildSmsHref } from '../utils/contactActions';
import { notifyError, notifySuccess } from '../utils/notify';

/**
 * @param {object} props
 * @param {object | null} props.child
 * @param {() => void} props.onClose
 * @param {(child: object) => string} [props.getSmsBody] SMS template from child; default "Regarding {name}."
 * @param {boolean} [props.showMessageComposer] Show editable message + copy section (default: true)
 */
export default function PatientContactModal({ child, onClose, getSmsBody, showMessageComposer = true }) {
  const messengerRaw = child?.messenger != null ? String(child.messenger).trim() : '';
  const messengerIsHttpUrl = messengerRaw !== '' && /^https?:\/\//i.test(messengerRaw);

  const smsBody =
    child && typeof getSmsBody === 'function'
      ? getSmsBody(child)
      : child
        ? `Regarding ${formatChildDisplayName(child)}.`
        : '';
  const [smsDraft, setSmsDraft] = useState(smsBody);

  useEffect(() => {
    setSmsDraft(smsBody);
  }, [smsBody]);

  const copyMessengerToClipboard = async () => {
    if (!messengerRaw) return;
    try {
      await navigator.clipboard.writeText(messengerRaw);
      notifySuccess('Copied');
    } catch {
      notifyError('Copy failed');
    }
  };

  const copySmsToClipboard = async () => {
    if (!smsDraft || !smsDraft.trim()) return;
    try {
      await navigator.clipboard.writeText(smsDraft.trim());
      notifySuccess('Message copied');
    } catch {
      notifyError('Copy failed');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1060,
        padding: '16px'
      }}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div className="card" style={{ maxWidth: '420px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Contact</h3>
        <div style={{ marginBottom: '12px' }}>
          {child ? (
            <PatientNameBlock child={child} />
          ) : (
            <PatientNameBlock name="Unknown patient" patientId={undefined} />
          )}
        </div>
        {!child ? (
          <p style={{ margin: '0 0 16px', color: 'var(--color-muted)', fontSize: '14px' }}>No patient record loaded.</p>
        ) : (
          <>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Phone</label>
              {child.guardianPhone ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <span style={{ wordBreak: 'break-word' }}>{child.guardianPhone}</span>
                  <a href={`tel:${child.guardianPhone}`} className="btn btn-secondary btn-sm">
                    Call
                  </a>
                  <a href={buildSmsHref(child.guardianPhone, smsDraft)} className="btn btn-secondary btn-sm">
                    SMS
                  </a>
                </div>
              ) : (
                <span style={{ color: 'var(--color-muted)' }}>—</span>
              )}
            </div>
            {showMessageComposer && (
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Reminder message</label>
                <textarea
                  value={smsDraft}
                  onChange={(e) => setSmsDraft(e.target.value)}
                  rows={4}
                  placeholder="Reminder text"
                />
                <div style={{ marginTop: '8px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copySmsToClipboard()}>
                    Copy message
                  </button>
                </div>
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>Messenger</label>
              {messengerRaw !== '' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <span style={{ wordBreak: 'break-word' }}>{messengerRaw}</span>
                  {messengerIsHttpUrl ? (
                    <a
                      href={messengerRaw}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      Open link
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void copyMessengerToClipboard()}
                    >
                      Copy
                    </button>
                  )}
                </div>
              ) : (
                <span style={{ color: 'var(--color-muted)' }}>—</span>
              )}
            </div>
          </>
        )}
        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: '16px' }} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
