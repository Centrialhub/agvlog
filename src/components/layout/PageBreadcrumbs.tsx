import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { findNavigationPage } from './navigation';

export function PageBreadcrumbs() {
  const { pathname } = useLocation();
  const page = findNavigationPage(pathname);
  if (!page) return null;
  return <nav aria-label="Caminho da página" className="min-w-0 text-xs text-muted-foreground">
    <ol className="flex min-w-0 items-center gap-2">
      <li><Link to="/" aria-label="Centro de operações" className="inline-flex rounded p-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><Home className="h-4 w-4" /></Link></li>
      <li aria-hidden="true"><ChevronRight className="h-3 w-3" /></li>
      <li className="hidden shrink-0 sm:block">{page.section.label}</li>
      <li aria-hidden="true" className="hidden sm:block"><ChevronRight className="h-3 w-3" /></li>
      <li className="truncate font-medium text-foreground">{page.isDetail ? <Link to={page.item.href} className="hover:underline">{page.item.label}</Link> : <span aria-current="page">{page.item.label}</span>}</li>
      {page.isDetail && <><li aria-hidden="true"><ChevronRight className="h-3 w-3" /></li><li aria-current="page">Detalhes</li></>}
    </ol>
  </nav>;
}
