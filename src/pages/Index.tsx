import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Reestruture a integração fiscal conforme hub-fiscal-api-v1-2026-08-20.csv. Toda operação deve ocorrer no servidor, com tenant/emitente/ambiente validados e tentativa fiscal persistida antes da chamada. Use externalId/idIntegracao estável e unique; retry reutiliza a tentativa, reemissão corrigida cria nova tentativa vinculada. Trate 202 como processing e só marque notas-fonte emitidas após authorized. Preserve status canônicos, cStat, messages, hints, technicalMessage e traceId. CT-e deve usar origem/destino reais, CFOP validado, chaves de 44 dígitos e payload aceito; não invente fallback fiscal. NFS-e: regimeApuracaoTributaria e servico[]; MDF-e: reboques, municípios/documentos, contratantes, seguros e totais corretos. Implemente sync, arquivos, cancelamento/eventos e reconciliação por webhook/polling. Teste idempotência, rejeição, 202, callback antecipado, cancelamento, PDF/XML e divergência local–Hub.
    </div>
  );
};

export default Index;
