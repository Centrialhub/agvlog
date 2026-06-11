export type PublicShipmentStatus =
  | 'received'
  | 'pickup_requested'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'at_origin_warehouse'
  | 'being_prepared'
  | 'loaded'
  | 'in_transit'
  | 'out_for_delivery'
  | 'arrived_at_destination'
  | 'delivered'
  | 'pod_pending'
  | 'pod_available'
  | 'not_delivered'
  | 'redelivery_scheduled'
  | 'returned'
  | 'cancelled'
  | 'exception';

export const PUBLIC_STATUS_LABELS: Record<PublicShipmentStatus, string> = {
  received: 'Recebido no sistema',
  pickup_requested: 'Coleta solicitada',
  pickup_scheduled: 'Coleta agendada',
  picked_up: 'Coletado',
  at_origin_warehouse: 'No CD de origem',
  being_prepared: 'Em separação',
  loaded: 'Carregado',
  in_transit: 'Em trânsito',
  out_for_delivery: 'Saiu para entrega',
  arrived_at_destination: 'Chegou ao destino',
  delivered: 'Entregue',
  pod_pending: 'Entregue, aguardando canhoto',
  pod_available: 'Canhoto disponível',
  not_delivered: 'Não entregue',
  redelivery_scheduled: 'Reentrega agendada',
  returned: 'Devolvido',
  cancelled: 'Cancelado',
  exception: 'Com ocorrência',
};

export const PUBLIC_STATUS_TONE: Record<PublicShipmentStatus, 'success' | 'info' | 'warning' | 'danger' | 'muted'> = {
  delivered: 'success',
  pod_available: 'success',
  in_transit: 'info',
  out_for_delivery: 'info',
  loaded: 'info',
  being_prepared: 'info',
  arrived_at_destination: 'info',
  picked_up: 'info',
  at_origin_warehouse: 'info',
  pickup_scheduled: 'info',
  pickup_requested: 'warning',
  pod_pending: 'warning',
  redelivery_scheduled: 'warning',
  not_delivered: 'danger',
  exception: 'danger',
  returned: 'danger',
  cancelled: 'muted',
  received: 'muted',
};
