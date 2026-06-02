import { useRef, useState } from 'react';
import { useEditablePresets, LONG_PRESS_MS } from '../hooks/useEditablePresets';

const btnAddGreen = {
  background: '#16a34a',
  color: '#fff',
  border: '1px solid #15803d',
  fontWeight: 700
};

/**
 * @param {'toggle'|'apply'} mode
 */
export default function EditableChipList({
  storageKey,
  defaultList,
  mode = 'toggle',
  activeMap,
  onToggle,
  onApply,
  disabled
}) {
  const { list, saveShortcut, renameShortcut, removeShortcut } = useEditablePresets(storageKey, defaultList);
  const [editOpen, setEditOpen] = useState(false);
  const [editOriginal, setEditOriginal] = useState('');
  const [editValue, setEditValue] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const pressTimer = useRef(null);
  const ignoreClick = useRef(false);

  const clearPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startLongPress = (label) => {
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      ignoreClick.current = true;
      window.setTimeout(() => {
        ignoreClick.current = false;
      }, 400);
      setEditOriginal(label);
      setEditValue(label);
      setEditOpen(true);
    }, LONG_PRESS_MS);
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        {list.map((label, chipIdx) => {
          const active = mode === 'toggle' ? activeMap?.[label] != null : false;
          return (
            <button
              key={`${chipIdx}-${label}`}
              type="button"
              disabled={disabled}
              onPointerDown={() => startLongPress(label)}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onClick={() => {
                if (ignoreClick.current) return;
                if (mode === 'toggle') onToggle?.(label);
                else onApply?.(label);
              }}
              className={`chip-toggle${active ? ' chip-toggle--active' : ''}`}
              title="Long-press to rename or remove"
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className="chip-toggle chip-toggle--add"
          disabled={disabled}
          onClick={() => {
            setDraft('');
            setDraftOpen((v) => !v);
          }}
          aria-label="Add custom"
        >
          +
        </button>
      </div>

      {draftOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
          <input
            type="text"
            className="form-control"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Custom…"
            style={{ flex: '1 1 200px', minWidth: '160px' }}
          />
          <button
            type="button"
            className="btn btn-sm"
            style={btnAddGreen}
            disabled={disabled}
            onClick={() => {
              const t = draft.trim();
              if (!t) return;
              if (mode === 'toggle') onToggle?.(t);
              else onApply?.(t);
              setDraft('');
              setDraftOpen(false);
            }}
          >
            Add
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ ...btnAddGreen, opacity: 0.92 }}
            disabled={disabled}
            onClick={() => {
              const t = draft.trim();
              if (!t) return;
              saveShortcut(t);
              if (mode === 'toggle') onToggle?.(t);
              else onApply?.(t);
              setDraft('');
              setDraftOpen(false);
            }}
          >
            Add &amp; save shortcut
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraftOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      {editOpen && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            background: '#fafafa'
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Edit shortcut</div>
          <input
            className="form-control"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                const t = editValue.trim();
                if (!t) return;
                renameShortcut(editOriginal, t);
                setEditOpen(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                removeShortcut(editOriginal);
                setEditOpen(false);
              }}
            >
              Remove shortcut
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', margin: '8px 0 0' }}>
            Long-press a chip to edit or remove it from this shortcut list.
          </p>
        </div>
      )}
    </div>
  );
}
