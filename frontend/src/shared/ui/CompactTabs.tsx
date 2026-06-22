import type { ComponentProps } from "react";
import { Nav } from "react-bootstrap";
export function CompactTabs(props: ComponentProps<typeof Nav>) { return <Nav variant="tabs" {...props} className={`civitas-compact-tabs ${props.className ?? ""}`.trim()} />; }
