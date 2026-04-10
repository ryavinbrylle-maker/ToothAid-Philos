/** Preset schools (single-select). Use "Others" + text field for anything else. */
export const CHILD_SCHOOL_PRESETS = ['BES', 'JCES'];

/** `<select>` value when user picks custom school. */
export const CHILD_SCHOOL_UI_OTHER = 'OTHER';

/** Children list filter: non-preset, non-empty school. */
export const CHILD_SCHOOL_FILTER_OTHERS = '__OTHERS__';

export function isPresetChildSchool(s) {
  return CHILD_SCHOOL_PRESETS.includes(String(s ?? '').trim());
}
