import { RBACMatrix } from "./rbacMatrix";
import type { CapabilityKey } from "./capabilities";
export const menuCapabilities: Record<string, CapabilityKey> = Object.fromEntries(Object.values(RBACMatrix.screens).map((screen) => [screen.path, screen.visibility])) as Record<string, CapabilityKey>;
