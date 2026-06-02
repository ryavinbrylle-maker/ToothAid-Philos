import { useCallback, useEffect, useMemo, useState } from 'react';

function uniqueLabels(labels) {
  const seen = new Set();
  const out = [];
  for (const label of labels) {
    const t = String(label || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function loadPresetState(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const p = raw ? JSON.parse(raw) : null;
    if (Array.isArray(p)) {
      return { extras: uniqueLabels(p), removedDefaults: [] };
    }
    if (p && typeof p === 'object') {
      return {
        extras: uniqueLabels(Array.isArray(p.extras) ? p.extras : []),
        removedDefaults: uniqueLabels(Array.isArray(p.removedDefaults) ? p.removedDefaults : [])
      };
    }
    return { extras: [], removedDefaults: [] };
  } catch {
    return { extras: [], removedDefaults: [] };
  }
}

/**
 * Merges default shortcuts with user edits from localStorage.
 */
export function useEditablePresets(storageKey, defaultList) {
  const [presetState, setPresetState] = useState(() => loadPresetState(storageKey));

  useEffect(() => {
    setPresetState(loadPresetState(storageKey));
  }, [storageKey]);

  const extras = presetState.extras;
  const removedDefaults = presetState.removedDefaults;

  const list = useMemo(() => {
    const removed = new Set(removedDefaults.map((d) => String(d).toLowerCase()));
    const out = [];
    const seen = new Set();
    for (const d of defaultList) {
      const t = String(d || '').trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (removed.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    for (const e of extras) {
      const t = String(e).trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }, [defaultList, extras, removedDefaults]);

  const writePresetState = useCallback((next) => {
    const cleanNext = {
      extras: uniqueLabels(next.extras || []),
      removedDefaults: uniqueLabels(next.removedDefaults || [])
    };
    setPresetState(cleanNext);
    try {
      localStorage.setItem(storageKey, JSON.stringify(cleanNext));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const saveShortcut = useCallback(
    (label) => {
      const t = String(label || '').trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (list.some((x) => String(x).toLowerCase() === key)) return;
      if (defaultList.some((x) => String(x).toLowerCase() === key)) {
        writePresetState({
          extras,
          removedDefaults: removedDefaults.filter((x) => String(x).toLowerCase() !== key)
        });
        return;
      }
      writePresetState({ extras: [...extras, t], removedDefaults });
    },
    [defaultList, extras, list, removedDefaults, writePresetState]
  );

  const renameShortcut = useCallback(
    (oldLabel, newLabel) => {
      const t = String(newLabel || '').trim();
      if (!t) return;
      const oldKey = String(oldLabel || '').toLowerCase();
      const newKey = t.toLowerCase();
      const oldIsDefault = defaultList.some((d) => String(d).toLowerCase() === oldKey);
      const newIsDefault = defaultList.some((d) => String(d).toLowerCase() === newKey);

      const nextRemoved = oldIsDefault
        ? [...removedDefaults, oldLabel]
        : removedDefaults.filter((x) => String(x).toLowerCase() !== oldKey);
      const extrasWithoutOld = extras.filter((x) => String(x).toLowerCase() !== oldKey);
      const nextExtras = newIsDefault ? extrasWithoutOld : [...extrasWithoutOld, t];

      writePresetState({
        extras: nextExtras,
        removedDefaults: newIsDefault
          ? nextRemoved.filter((x) => String(x).toLowerCase() !== newKey)
          : nextRemoved
      });
    },
    [defaultList, extras, removedDefaults, writePresetState]
  );

  const removeShortcut = useCallback(
    (label) => {
      const key = String(label || '').toLowerCase();
      const defaultLabel = defaultList.find((d) => String(d).toLowerCase() === key);
      writePresetState({
        extras: extras.filter((x) => String(x).toLowerCase() !== key),
        removedDefaults: defaultLabel ? [...removedDefaults, defaultLabel] : removedDefaults
      });
    },
    [defaultList, extras, removedDefaults, writePresetState]
  );

  return { list, extras, saveShortcut, renameShortcut, removeShortcut };
}

export const LONG_PRESS_MS = 550;
