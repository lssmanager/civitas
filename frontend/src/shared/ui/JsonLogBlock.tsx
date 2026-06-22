type JsonLogBlockProps = {
  value: unknown;
  className?: string;
};

export function JsonLogBlock({ value, className }: JsonLogBlockProps) {
  const payload = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <pre className={`civitas-json-block mb-0 ${className ?? ""}`.trim()}>
      <code>{payload}</code>
    </pre>
  );
}
