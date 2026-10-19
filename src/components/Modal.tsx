import { useEffect, useRef, type ReactNode } from 'react';
let openModals = 0; let previousOverflow = '';
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null;
    dialog.showModal(); if (openModals++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    return () => { dialog.close(); if (--openModals === 0) document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={'modal' + (wide ? ' library-modal' : '')} aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button type="button" className="close-button" aria-label={'關閉' + title} onClick={onClose}>×</button></div>
    {children}
  </dialog>;
}
