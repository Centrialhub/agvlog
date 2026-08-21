/* Implemente geofences no PostGIS e gere alertas básicos (entrada/saída) para os veículos quando eles cruzarem os polígonos.Implemente o cálculo automático de viagens e paradas a partir das posições para cada veículo, e exiba isso na aba do Detalhes do Veículo e no Fleet Map.Configure regras de alertas por tenant para excesso de velocidade e apresente um feed cronológico de alertas no Detalhes do Veículo, com link direto ao ponto no mapa. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
