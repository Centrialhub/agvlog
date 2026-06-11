import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';

export default function PortalOccurrences() {
  return (
    <PortalSection title="Occurrences" description="Esta área será habilitada nas próximas fases do portal.">
      <PortalEmptyState title="Em construção" description="Disponível em breve com filtros, busca e exportação." />
    </PortalSection>
  );
}
