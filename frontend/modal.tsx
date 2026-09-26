import { useLayoutEffect, useRef, type ReactNode } from "react";

export function Modal({
  variant,
  label,
  onClose,
  children,
}: {
  variant: "sheet" | "picker";
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={variant === "sheet" ? "backdrop" : "picker"}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={variant === "sheet" ? (event) => {
        if (event.target === event.currentTarget) onClose();
      } : undefined}
    >
      {children}
    </dialog>
  );
}
