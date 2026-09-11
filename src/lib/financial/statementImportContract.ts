import {uploadArtifactSchema} from './uploadArtifactContract';
import {z} from 'zod';
const uuid=z.string().uuid(),index=z.number().int().min(0).max(99);
export const statementMappingSchema=z.object({header_row:z.number().int().min(0).max(19),sheet_index:z.number().int().nonnegative().optional(),
  delimiter:z.enum([';',',','\t']).optional(),number_format:z.enum(['br','decimal']),date_format:z.enum(['dmy','ymd','excel']),
  date_column:index,description_column:index,amount_column:index.optional(),credit_column:index.optional(),debit_column:index.optional(),bank_id_column:index.optional(),
  document_column:index.optional(),counterparty_document_column:index.optional(),counterparty_name_column:index.optional(),balance_column:index.optional(),
  balance_basis:z.enum(['before_transaction','after_transaction']).optional(),row_order:z.enum(['chronological','reverse_chronological']).optional()}).strict();
export const statementRowSchema=z.object({posted_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amount_cents:z.number().int().min(-99999999999999).max(99999999999999).refine(n=>n!==0),
  bank_id:z.string().nullable(),description:z.string(),document_number:z.string().nullable(),counterparty_document:z.string().nullable(),counterparty_name:z.string().nullable(),
  raw:z.object({source_row:z.number().int().positive(),cells:z.array(z.union([z.string(),z.number().finite(),z.boolean(),z.null()]))})});
export const statementImportCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,bank_account_id:uuid,
  file_hash:z.string().regex(/^[a-f0-9]{64}$/),file_name:z.string().max(255).optional(),source_path:z.string(),currency:z.literal('BRL'),parser_version:z.enum(['mapped-csv-v1','mapped-workbook-v1','native-ofx-v1']),
  mapping:statementMappingSchema,period_start:z.string(),period_end:z.string(),reason:z.string().min(5).max(2000),rows:z.array(statementRowSchema).max(10000)})
  .refine(command=>command.rows.length>0||command.parser_version==='native-ofx-v1');
export type StatementImportCommand=z.infer<typeof statementImportCommandSchema>;
export const statementIntakeResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,import_id:uuid,
  counts:z.record(z.enum(['new','duplicate','ambiguous','reference_conflict','repeated_reference']),z.number().int().nonnegative()),source_verification:z.literal('pending'),confirmed:z.literal(true)});
export const statementVerificationResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,import_id:uuid,verification_id:uuid,
  source_verification:z.enum(['rows_match','rows_mismatch','unreadable']),account_coverage_verification:z.literal('pending'),confirmed:z.literal(true)});
export const pendingStatementSchema=z.object({version:z.literal(1),tenant:uuid,actor:uuid,file_name:z.string(),file_size:z.number().int().positive().max(10485760),
  created_at:z.string(),phase:z.enum(['upload','intake','verify','rejected']),uncertain:z.boolean(),verification_request:uuid,
  upload_mode:z.literal('quarantine_v2').optional(),artifact:uploadArtifactSchema.optional(),command:statementImportCommandSchema,receipt:statementIntakeResultSchema.optional()});
export type PendingStatement=z.infer<typeof pendingStatementSchema>;
export type StatementVerificationResult=z.infer<typeof statementVerificationResultSchema>;
export function statementImportErrorMessage(error:unknown):string{
  if(error instanceof z.ZodError)return 'A resposta não pôde ser validada. O pedido foi preservado; retome a mesma importação.';
  const message=error instanceof Error?error.message:'';
  const translations:Record<string,string>={invalid_date:'Data inválida para o formato selecionado.',invalid_excel_date:'Data numérica Excel inválida.',
    invalid_amount:'Valor incompatível com o formato escolhido ou com mais de duas casas decimais.',amount_out_of_range:'Valor fora do limite suportado.',
    invalid_mapping:'Revise as colunas e os formatos selecionados.',overlapping_columns:'As colunas de data, valor e saldo precisam ser distintas.',
    column_out_of_range:'Uma coluna selecionada não existe neste cabeçalho.',date_outside_period:'Há lançamento fora do período informado.',
    ambiguous_direction:'O registro contém crédito e débito simultâneos ou sinal incompatível.',zero_transaction:'Há registro com valor zero; revise a linha no arquivo.',
    no_transactions:'Nenhum lançamento foi encontrado após o cabeçalho.',formula_cells_require_review:'A aba contém fórmulas. Use o extrato original com os valores fornecidos pelo banco.',
    invalid_encoding:'Use um CSV em UTF-8 ou o arquivo original em Excel.',invalid_csv_quotes:'O CSV contém aspas malformadas.',truncated_csv:'O CSV está incompleto: há aspas sem fechamento.',
    extra_column:'Há dados em colunas sem cabeçalho.',too_many_rows:'O arquivo ultrapassa 10 mil lançamentos. Divida o período em arquivos menores.',
    finance_statement_already_imported:'Este arquivo já foi registrado. Consulte a importação existente antes de enviar outro pedido.',
    finance_invalid_account:'Selecione uma conta ativa desta empresa.',finance_access_denied:'Acesso financeiro não permitido nesta sessão.',
    ofx_corrections_require_review:'O OFX contém correções de transações anteriores. Essas correções precisam de revisão antes da importação.',
    ofx_duplicate_field:'O OFX contém campos ou contas repetidos. Exporte um extrato de uma única conta para conferir.',
    ofx_unsupported_currency:'O arquivo precisa informar valores em reais (BRL).',ofx_fractional_cent:'O OFX contém valor inválido ou fração de centavo.',
    ofx_direction_conflict:'O sentido informado pelo banco diverge do sinal do valor. Confira o arquivo original.',
    ofx_incomplete_document:'O OFX está incompleto ou contém mais de um documento. Baixe novamente o original.',
    ofx_bank_response_not_successful:'O OFX informa uma falha na resposta do banco. Baixe um novo extrato.'};
  const code=message.split(':')[0],row=message.match(/row=(\d+)/)?.[1];
  if(translations[code])return `${row?`Registro ${row}: `:''}${translations[code]}`;
  if(code.startsWith('ofx_'))return 'Este OFX precisa de revisão: há estrutura, formato ou informação bancária incompatível com o leitor. O arquivo não foi importado automaticamente.';
  if(message.startsWith('finance_'))return 'Não foi possível confirmar esta etapa. O pedido foi preservado para recuperação.';
  return message||'Não foi possível confirmar a importação. Retome o pedido preservado.';
}
