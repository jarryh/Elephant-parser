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
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button onClick={onClose}>Close</button>
      </header>
      {children}
    </dialog>
  );
}
