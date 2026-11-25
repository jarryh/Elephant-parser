import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        // Chrome lets a second Escape skip onCancel. Reopen, and let onClose decide.
        const element = event.currentTarget;
        if (element.open || !element.isConnected) return;
        element.showModal();
        onClose();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button onClick={onClose}>Close</button>
      </header>
      {children}
    </dialog>
  );
}
