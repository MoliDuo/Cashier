"use client";
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

type DropdownMenuProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;
type DropdownMenuTriggerProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Trigger
>;

interface DropdownMenuContextValue {
  open: boolean;
  onOpenToggle: () => void;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext(componentName: string) {
  const context = React.useContext(DropdownMenuContext);

  if (context == null) {
    throw new Error(`${componentName} must be used within DropdownMenu`);
  }

  return context;
}

function useDropdownMenuOpenState({
  prop,
  defaultProp,
  onChange,
}: {
  prop: boolean | undefined;
  defaultProp: boolean;
  onChange: ((open: boolean) => void) | undefined;
}): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultProp);
  const isControlled = prop !== undefined;
  const open = isControlled ? prop : uncontrolledOpen;
  const onChangeRef = React.useRef(onChange);
  const previousUncontrolledOpenRef = React.useRef(uncontrolledOpen);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    if (!isControlled && previousUncontrolledOpenRef.current !== uncontrolledOpen) {
      previousUncontrolledOpenRef.current = uncontrolledOpen;
      onChangeRef.current?.(uncontrolledOpen);
    }
  }, [isControlled, uncontrolledOpen]);

  const setOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (nextOpen) => {
      if (isControlled) {
        const currentOpen = prop ?? false;
        const resolvedOpen = typeof nextOpen === "function" ? nextOpen(currentOpen) : nextOpen;

        if (resolvedOpen !== currentOpen) {
          onChangeRef.current?.(resolvedOpen);
        }
        return;
      }

      setUncontrolledOpen(nextOpen);
    },
    [isControlled, prop]
  );

  return [open, setOpen];
}

function hasNoPointerModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

const DropdownMenu = ({
  children,
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: DropdownMenuProps) => {
  const [open, setOpen] = useDropdownMenuOpenState({
    prop: openProp,
    defaultProp: defaultOpen ?? false,
    onChange: onOpenChange,
  });
  const handleOpenChange = React.useCallback((nextOpen: boolean) => setOpen(nextOpen), [setOpen]);
  const handleOpenToggle = React.useCallback(() => setOpen(!open), [open, setOpen]);
  const contextValue = React.useMemo(
    () => ({
      open,
      onOpenToggle: handleOpenToggle,
    }),
    [handleOpenToggle, open]
  );

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <DropdownMenuPrimitive.Root {...props} open={open} onOpenChange={handleOpenChange}>
        {children}
      </DropdownMenuPrimitive.Root>
    </DropdownMenuContext.Provider>
  );
};
DropdownMenu.displayName = DropdownMenuPrimitive.Root.displayName;

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  DropdownMenuTriggerProps
>(function DropdownMenuTrigger(
  {
    disabled = false,
    onClick,
    onKeyDown,
    onKeyUp,
    onPointerCancel,
    onPointerDown,
    onPointerUp,
    ...props
  },
  ref
) {
  const { onOpenToggle } = useDropdownMenuContext("DropdownMenuTrigger");
  const pointerActivationRef = React.useRef(false);
  const touchActivationPointerIdRef = React.useRef<number | null>(null);
  const keyboardActivationRef = React.useRef(false);
  const suppressNextClickRef = React.useRef(false);
  const keyboardActivationTimeoutRef = React.useRef<number | null>(null);

  const clearKeyboardActivationTimeout = React.useCallback(() => {
    if (keyboardActivationTimeoutRef.current != null) {
      window.clearTimeout(keyboardActivationTimeoutRef.current);
      keyboardActivationTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(
    () => () => {
      clearKeyboardActivationTimeout();
    },
    [clearKeyboardActivationTimeout]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    pointerActivationRef.current = false;
    touchActivationPointerIdRef.current = null;
    keyboardActivationRef.current = false;
    suppressNextClickRef.current = false;
    clearKeyboardActivationTimeout();

    onPointerDown?.(event);

    if (event.defaultPrevented) {
      suppressNextClickRef.current = true;
      return;
    }

    if (disabled || event.button !== 0) {
      return;
    }

    // Radix opens on pointerdown. Keep that internal behavior from running for
    // both accepted and rejected primary-button activations.
    event.preventDefault();

    if (hasNoPointerModifiers(event)) {
      pointerActivationRef.current = true;
      if (event.pointerType === "touch") {
        touchActivationPointerIdRef.current = event.pointerId;
      }
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event);
    pointerActivationRef.current = false;
    touchActivationPointerIdRef.current = null;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);

    if (touchActivationPointerIdRef.current !== event.pointerId) {
      return;
    }

    touchActivationPointerIdRef.current = null;
    pointerActivationRef.current = false;
    suppressNextClickRef.current = true;

    if (event.defaultPrevented || disabled || !hasNoPointerModifiers(event)) {
      return;
    }

    onOpenToggle();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    keyboardActivationRef.current = false;
    suppressNextClickRef.current = false;
    clearKeyboardActivationTimeout();

    onKeyDown?.(event);

    if (event.defaultPrevented) {
      if (!disabled && (event.key === "Enter" || event.key === " ")) {
        suppressNextClickRef.current = true;
      }
      return;
    }

    if (disabled) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      keyboardActivationRef.current = true;
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyUp?.(event);

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    clearKeyboardActivationTimeout();
    keyboardActivationTimeoutRef.current = window.setTimeout(() => {
      keyboardActivationRef.current = false;
      keyboardActivationTimeoutRef.current = null;
    }, 0);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);

    if (event.defaultPrevented || disabled || event.button !== 0 || !hasNoPointerModifiers(event)) {
      pointerActivationRef.current = false;
      suppressNextClickRef.current = false;
      return;
    }

    if (suppressNextClickRef.current) {
      pointerActivationRef.current = false;
      suppressNextClickRef.current = false;
      return;
    }

    // A real pointer click must follow an accepted primary pointerdown. A
    // detail-less click is also allowed for assistive technology and tests.
    if (event.detail > 0 && !pointerActivationRef.current) {
      return;
    }

    pointerActivationRef.current = false;

    if (keyboardActivationRef.current) {
      keyboardActivationRef.current = false;
      return;
    }

    onOpenToggle();
  };

  return (
    <DropdownMenuPrimitive.Trigger
      {...props}
      ref={ref}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    />
  );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, onPointerDownOutside, sideOffset = 4, ...props }, ref) => {
  const handlePointerDownOutside = (
    event: Parameters<
      NonNullable<
        React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>["onPointerDownOutside"]
      >
    >[0]
  ) => {
    onPointerDownOutside?.(event);

    if (!event.defaultPrevented && event.detail.originalEvent.defaultPrevented) {
      event.preventDefault();
    }
  };

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-[400] min-w-[8rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-[0_4px_12px_rgba(0,0,0,0.1)] ease-[var(--motion-enter)] data-[state=open]:animate-in data-[state=open]:duration-[180ms] data-[state=closed]:animate-out data-[state=closed]:duration-[140ms] data-[state=closed]:fade-out-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          className
        )}
        {...props}
        onPointerDownOutside={handlePointerDownOutside}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-surface2 focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
