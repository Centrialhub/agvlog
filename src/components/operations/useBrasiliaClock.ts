import { useEffect, useState } from 'react';

const MOTIVATIONAL_QUOTES = [
  'A excelência não é um ato, é um hábito. — Aristóteles',
  'Cada entrega feita com cuidado constrói confiança.',
  'O sucesso é a soma de pequenos esforços repetidos dia após dia.',
  'Logística é a arte de fazer o impossível parecer simples.',
  'Quem planeja bem, executa melhor.',
  'Disciplina é a ponte entre metas e conquistas.',
  'Grandes resultados nascem de equipes comprometidas.',
  'Eficiência hoje, crescimento amanhã.',
  'Cada quilômetro rodado é uma promessa cumprida.',
  'A estrada é longa, mas o destino compensa.',
  'Precisão nos detalhes, excelência no resultado.',
  'Juntos somos mais fortes — e mais rápidos.',
  'Segurança em primeiro lugar, sempre.',
  'Um bom dia começa com um bom planejamento.',
  'Entregar no prazo é entregar respeito.',
  'Cada carga carrega a confiança do nosso cliente.',
  'O caminho se faz ao caminhar. — Antonio Machado',
  'Persistência transforma esforço em resultado.',
  'A melhor rota é aquela bem planejada.',
  'Hoje é um bom dia para superar expectativas.',
  'Trabalho em equipe divide tarefas e multiplica resultados.',
  'Pontualidade é o compromisso com quem espera.',
  'Inovação é fazer mais com menos, sem perder qualidade.',
  'Cada desafio é uma oportunidade disfarçada.',
  'Quem cuida da frota, cuida do futuro.',
  'A operação não para — e nós também não.',
  'Compromisso com a qualidade, todos os dias.',
  'O detalhe faz a diferença entre bom e excelente.',
  'Velocidade com segurança: esse é o nosso ritmo.',
  'Um dia produtivo começa com foco e atitude.',
];

export function useBrasiliaClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const date = now.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const hour = parseInt(now.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
  }));
  const greeting = hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  return { time, date, hour, greeting, dailyQuote: MOTIVATIONAL_QUOTES[dayOfYear % MOTIVATIONAL_QUOTES.length] };
}
