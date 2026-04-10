export const notifySuccess = (message) => {
  const msg = (message || '').trim() || 'Saved successfully.';
  window.dispatchEvent(new CustomEvent('toothaid:toast', { detail: { type: 'success', message: msg } }));
};

export const notifyError = (message) => {
  const msg = (message || '').trim() || 'Operation failed.';
  window.dispatchEvent(new CustomEvent('toothaid:toast', { detail: { type: 'error', message: msg } }));
};

