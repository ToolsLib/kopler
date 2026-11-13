import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

// The same accessible Radix primitive used by shadcn's dialog component.
export function Dialog({ title, description, children, notice, onClose, busy = false, initialFocus }: {
  title: string; description: string; children: ReactNode; notice?: ReactNode; onClose: () => void; busy?: boolean; initialFocus?: RefObject<HTMLElement | null>;
}) {
  const initiallyFocused = useRef(false);
  useEffect(() => {
    if (!busy && initialFocus?.current && !initiallyFocused.current) {
      initialFocus.current.focus();
      initiallyFocused.current = true;
    }
  }, [busy, initialFocus]);
  return <Primitive.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Primitive.Portal>
      <Primitive.Overlay className="dialog-overlay" />
      <Primitive.Content className="dialog-content" onEscapeKeyDown={event => event.stopPropagation()} onOpenAutoFocus={event => { if (initialFocus) event.preventDefault(); }}>
        <div className="dialog-heading"><Primitive.Title>{title}</Primitive.Title>
          <Primitive.Close asChild><button className="icon-button" aria-label="Close dialog" disabled={busy}><X size={16} /></button></Primitive.Close></div>
        <Primitive.Description>{description}</Primitive.Description>
        {children}
        {notice}
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
