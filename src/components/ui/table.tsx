import * as React from "react";

import { cn } from "@/lib/utils";

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  scrollLabel?: string;
  containerClassName?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scrollLabel, containerClassName, ...props }, ref) => (
    <div
      className={cn(
        "relative w-full overflow-auto",
        scrollLabel && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        containerClassName,
      )}
      role={scrollLabel ? "region" : undefined}
      aria-label={scrollLabel}
      tabIndex={scrollLabel ? 0 : undefined}
    >
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & {
    sortConfig?: { key: string; direction: 'asc' | 'desc' | null } | null;
    sortKey?: string;
    onSort?: (key: string) => void;
  }
>(({ className, sortConfig, sortKey, onSort, children, ...props }, ref) => {
  const isSorted = sortConfig && sortKey && sortConfig.key === sortKey;
  const direction = isSorted ? sortConfig.direction : null;
  const sortable = Boolean(onSort && sortKey);
  const ariaSort = sortable
    ? direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
    : props['aria-sort'];

  return (
    <th
      ref={ref}
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
      aria-sort={ariaSort}
    >
      {sortable ? (
        <button
          type="button"
          className="group -mx-2 inline-flex min-h-11 select-none items-center gap-1 rounded-sm px-2 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => onSort?.(sortKey!)}
        >
          {children}
          <span aria-hidden="true" className="flex flex-col opacity-40 group-hover:opacity-100">
            <span className={cn("text-[8px] leading-[4px]", direction === 'asc' && "text-primary opacity-100 font-bold")}>▲</span>
            <span className={cn("text-[8px] leading-[4px]", direction === 'desc' && "text-primary opacity-100 font-bold")}>▼</span>
          </span>
        </button>
      ) : <div className="flex items-center gap-1">{children}</div>}
    </th>
  );
});
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
