import { RBACMatrix, type ActionKey, type CapabilityKey } from "./rbacMatrix";

type ScreenWithActions = { actions?: Partial<Record<ActionKey, CapabilityKey>> };
export const actionCapabilities: Record<ActionKey, CapabilityKey> = (Object.values(RBACMatrix.screens) as ScreenWithActions[]).reduce((actions, screen) => ({ ...actions, ...(screen.actions ?? {}) }), {} as Record<ActionKey, CapabilityKey>);
