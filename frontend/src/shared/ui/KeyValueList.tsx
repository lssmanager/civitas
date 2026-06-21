import { ListGroup } from "react-bootstrap";

type KeyValueItem = {
  label: string;
  value: string;
};

type KeyValueListProps = {
  items: KeyValueItem[];
};

export function KeyValueList({ items }: KeyValueListProps) {
  return (
    <ListGroup variant="flush" className="civitas-key-value-list">
      {items.map((item) => (
        <ListGroup.Item
          key={item.label}
          className="d-flex justify-content-between align-items-start gap-3 px-0"
        >
          <span className="civitas-key-value-list__label">{item.label}</span>
          <span className="fw-semibold text-break text-end">{item.value}</span>
        </ListGroup.Item>
      ))}
    </ListGroup>
  );
}
