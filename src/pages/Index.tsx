/* Trabalho concluído na composição segura de cargas. Migrações upsert/delete_load_item_v2 implementadas, recalculate_load_totals protegida e hooks V2 sincronizados com espelhamento atômico. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
