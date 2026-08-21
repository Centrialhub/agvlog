WITH numbered_loads AS (
  SELECT
    id,
    load_number,
    1000 + row_number() OVER (ORDER BY created_at ASC, id ASC) AS sequence_number
  FROM public.loads
  WHERE load_number !~ '^\d+\s+-\s+'
    AND load_number !~ '^\d+$'
)
UPDATE public.loads AS l
SET
  load_number = numbered_loads.sequence_number::text || ' - ' || numbered_loads.load_number,
  updated_at = now()
FROM numbered_loads
WHERE l.id = numbered_loads.id;