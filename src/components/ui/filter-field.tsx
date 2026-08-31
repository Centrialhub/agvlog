import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** Associates existing compact filter controls with a visible label, including input groups. */
export function FilterField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const id = useId();
  let associated = false;
  const associate = (nodes: ReactNode): ReactNode => Children.map(nodes, node => {
    if (!isValidElement(node)) return node;
    const element = node as ReactElement<{ id?: string; children?: ReactNode }>;
    if (node.type === 'div' || node.type === 'span') return cloneElement(element, {}, associate(element.props.children));
    if (associated) return node;
    associated = true;
    return cloneElement(element, { id });
  });
  return <div className={`flex flex-col gap-1 ${className}`}><label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>{associate(children)}</div>;
}
