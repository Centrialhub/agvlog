-- Defense in depth for private proof/receipt buckets. Client validation is UX;
-- these bucket constraints are the authoritative size and declared-MIME gate.
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf'
    ]::text[]
WHERE id IN ('occurrence-return-proofs', 'pallet-return-proofs');

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf', 'application/xml', 'text/xml'
    ]::text[]
WHERE id = 'receipts';

