import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { desk, openDialog, useDesk, type DialogId } from '@/desk/store';

/**
 * Keep a native `<dialog>` and `dialogs[id]` in the store in step: the store
 * opening it calls `showModal()`, the store closing it calls `close()`, and a
 * native close (Esc, a `method="dialog"` submit, `[data-close]`) writes back.
 *
 * `onOpen` runs on every opening, however it was asked for — the legacy sheets
 * reset or reload themselves each time `showModal()` ran. `seq` lets a caller
 * re-run it while the sheet is already up.
 */
export function useSheetDialog(
  id: DialogId,
  ref: RefObject<HTMLDialogElement | null>,
  { onOpen, onClose, seq = 0 }: { onOpen?: () => void; onClose?: () => void; seq?: number } = {},
): boolean {
  const open = useDesk((s) => Boolean(s.dialogs[id]));
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      onOpenRef.current?.();
    } else if (d.open) d.close();
  }, [open, seq, ref]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handle = () => {
      if (desk.get().dialogs[id]) openDialog(id, false);
      onCloseRef.current?.();
    };
    d.addEventListener('close', handle);
    return () => d.removeEventListener('close', handle);
  }, [id, ref]);

  return open;
}

/** `dialog [data-close]` buttons: close the sheet they sit in. */
export function closeSheet(id: DialogId): void {
  openDialog(id, false);
}
