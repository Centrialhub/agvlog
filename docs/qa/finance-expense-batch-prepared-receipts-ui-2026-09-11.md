# Prepared receipts in the expense batch — local UI

The same batch dialog prepares JPEG/PNG evidence before registration. Each row sends an intent with the early batch request, immutable row UUID and explicit context/trip/stop. The v2 upload uses expense_draft with that intent as source. Only a usable sanitized derivative yields the receipt_intent_id/receipt_artifact_id pair; neither a fictitious legacy path nor an absence explanation is sent for this receipt.

Drafts now persist batchRequest independently from request (the latter only locks editing after submission). Existing drafts retain their submitted request; editable older drafts receive an early batch identity. Intent requests persist before transport under actor/tenant/batch/row/context scope and replay after uncertain responses. The existing upload recovery preserves request and file hash. JPEG/PNG without a file extension is identified by MIME before server content validation. All five existing contexts remain supported.

Changing context, trip or unloading stop removes the prepared reference. Replacing a selected file invalidates prior evidence. Asynchronous completions require the same mounted row/scope. Functional row updates preserve parallel upload results; a counter keeps submission locked until every upload finishes. Reusing descriptive row data does not duplicate receipt references.

Validation: 24 tests passed across expenseBatchPreparedReceipt, expenseBatchReceiptClient, expenseBatchContract, expenseBatchDialog and expenseBatchEntryUx. Includes same-dialog unloading preparation, exact replay after lost batch response, old-draft recovery, foreign actor/batch rejection, invalidated context, late unmounted completion, two uploads finishing out of order with both IDs retained, quarantine rejection, five contexts and extensionless JPEG. Focused ESLint passed. Log: expense-batch-prepared-final-2026-09-11.log.

These are controlled component/client tests. Native owns the actual SQL intent and atomic batch-consumption proof; root owns Edge deployment, global type checking and publication. No database writes, deployments or commits were performed by this UI task.
