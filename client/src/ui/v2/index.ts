// @x-builder/client — v2 primitive library barrel
//
// A fresh, token-driven, shadow-DOM-portable component library (NOT the legacy
// `../foundation.tsx`). Every primitive carries its styles inline as `var(--…)`
// references into the seeded token closure, so they render in both the SPA
// :root and the overlay shadow :host with zero global CSS. Built for XOB-020;
// later overlay tickets reuse these and add new ones (e.g. ScoreBar).

export { Alert, type AlertProps } from "./alert";
export { Badge, type BadgeProps } from "./badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { IconButton, type IconButtonProps, type IconButtonVariant } from "./icon-button";
export { Input, type InputProps } from "./input";
export { KeyValueList, type KeyValueItem, type KeyValueListProps } from "./key-value-list";
export { ScoreBar, type ScoreBand, type ScoreBarProps } from "./score-bar";
export { Select, type SelectOption, type SelectProps } from "./select";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { Switch, type SwitchProps } from "./switch";
export { FOCUS_OUTLINE, type BadgeVariant, type StateVariant } from "./tokens";
