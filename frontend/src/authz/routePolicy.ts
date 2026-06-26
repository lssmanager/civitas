import { RBACMatrix } from "./rbacMatrix";
import type { CapabilityKey } from "./capabilities";
export const routeCapabilities: Record<string, CapabilityKey> = Object.fromEntries(Object.values(RBACMatrix.screens).map((screen) => [screen.path, screen.route])) as Record<string, CapabilityKey>;
