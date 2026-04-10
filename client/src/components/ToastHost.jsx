import { useEffect, useState } from 'react';

const EVENT_NAME = 'toothaid:toast';

export default function ToastHost() {
  const [toast, setToast] = useState(null); // { type, message }

  useEffect(() => {
    let timer = null;
    const onToast = (e) => {
      const detail = e?.detail || {};
      const type = detail.type === 'error' ? 'error' : 'success';
      const message = String(detail.message || '').trim();
      if (!message) return;
      setToast({ type, message });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 2200);
    };
    window.addEventListener(EVENT_NAME, onToast);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(EVENT_NAME, onToast);
    };
  }, []);

  if (!toast) return null;

  const bg = toast.type === 'error' ? 'rgba(239, 68, 68, 0.92)' : 'rgba(16, 185, 129, 0.92)';
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '84px', // above bottom nav
        transform: 'translateX(-50%)',
        zIndex: 9999,
        maxWidth: '92vw',
        padding: '10px 18px',
        borderRadius: 'var(--radius-pill)',
        background: bg,
        color: '#fff',
        fontSize: '14px',
        fontWeight: 650,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        textAlign: 'center'
      }}
    >
      {toast.message}
    </div>
  );
}

