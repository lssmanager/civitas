import type { ReactNode } from "react";
import { Table } from "react-bootstrap";
import { EmptyState } from "./EmptyState";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyTitle = "Sin resultados",
  emptyDescription = "No hay datos mock para mostrar en esta vista.",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="table-responsive">
      <Table hover className="align-middle mb-0 civitas-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
