import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode, Ref } from "react";
import styles from "./ToolButton.module.css";

interface Props {
  label: string;
  active?: boolean;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick(): void;
  children: ReactNode;
}

export function ToolButton({
  label,
  active,
  disabled = false,
  buttonRef,
  onClick,
  children,
}: Props) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={buttonRef}
          type="button"
          className={styles.button}
          data-active={active === true}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={styles.tooltip}
          side="left"
          sideOffset={6}
          collisionPadding={8}
        >
          {label}
          <Tooltip.Arrow className={styles.arrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
