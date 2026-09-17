-- Reuse each receivable installment position while calculating overdue totals.
do $migration$
declare
  body text;
  call_expression constant text := 'finance_private.receivable_installment_position(_tenant,id)';
  summary_marker constant text := '), summary as(';
  overdue_source constant text := 'overdue from amounts';
begin
  select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure)
    into body;

  if (length(body) - length(replace(body, call_expression, ''))) / length(call_expression) <> 2
    or (length(body) - length(replace(body, summary_marker, ''))) / length(summary_marker) <> 1
    or (length(body) - length(replace(body, overdue_source, ''))) / length(overdue_source) <> 1
  then
    raise exception 'finance_receivable_portfolio_installment_reader_changed' using errcode = '55000';
  end if;

  body := replace(body, call_expression, 'installment_position');
  body := replace(
    body,
    summary_marker,
    '), installment_positions as materialized(select a.*,finance_private.receivable_installment_position(_tenant,a.id) installment_position from amounts a), summary as('
  );
  body := replace(body, overdue_source, 'overdue from installment_positions');
  execute body;
end
$migration$;

do $postflight$
declare body text;
begin
  select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure)
    into body;
  if (length(body) - length(replace(body, 'finance_private.receivable_installment_position(', ''))) /
       length('finance_private.receivable_installment_position(') <> 1
    or position('installment_positions as materialized' in body) = 0
    or position('overdue from installment_positions' in body) = 0
  then
    raise exception 'finance_receivable_portfolio_installment_materialization_failed' using errcode = '55000';
  end if;
end
$postflight$;
