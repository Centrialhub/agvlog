import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { EXPECTED_FORWARD_FILES } from './check-baseline-candidate.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
export const MAX_BASELINE_REVISIONS = 8;
const roles = ['application-schema', 'managed-customizations', 'reviewed-roles', 'reviewed-extensions', 'synthetic-buckets'];
const reviewAssertions = ['schemaSanitized', 'noCustomerData', 'noProductionSecrets', 'externalJobsDisabled',
  'managedCustomizationsReviewed', 'rolesReviewed', 'extensionsReviewed', 'syntheticBucketsReviewed', 'rawRolesDumpExcluded'];

function requireCondition(condition, code) {
  if (!condition) throw new Error(`Local baseline approval rejected: ${code}`);
}

function exactKeys(value, expected, code) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)), code);
}

function readBounded(path, maximumBytes) {
  path = resolve(path);
  const anchor = parse(path).root;
  let component = anchor;
  for (const part of path.slice(anchor.length).split(sep).filter(Boolean)) {
    component = join(component, part);
    const stat = lstatSync(component);
    requireCondition(!stat.isSymbolicLink(), 'linked_input');
    if (stat.isFile()) requireCondition(stat.nlink === 1, 'hard_linked_input');
  }
  const stat = lstatSync(path);
  requireCondition(stat.isFile() && stat.size > 0 && stat.size <= maximumBytes, 'invalid_input_type_or_size');
  return readFileSync(path);
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Local baseline approval rejected: invalid_json'); }
}

function validUtc(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateLedger(value) {
  exactKeys(value, ['count', 'maxVersion', 'catalogMd5'], 'invalid_ledger_fields');
  requireCondition(Number.isSafeInteger(value.count) && value.count > 0 &&
    typeof value.maxVersion === 'string' && /^\d{14}$/.test(value.maxVersion) &&
    typeof value.catalogMd5 === 'string' && /^[a-f0-9]{32}$/.test(value.catalogMd5), 'invalid_ledger_identity');
}

function validateApproval(approval, candidate, candidateSha256) {
  exactKeys(approval, ['formatVersion', 'purpose', 'targetProjectId', 'source', 'review', 'artifacts', 'candidate',
    ...(approval?.formatVersion === 2 ? ['supersedesApprovalSha256'] : [])], 'invalid_manifest_fields');
  requireCondition([1, 2].includes(approval.formatVersion) && approval.purpose === 'agvlog-local-staging-reviewed-baseline' &&
    approval.targetProjectId === 'agvlog-local-staging', 'wrong_manifest_scope');
  if (approval.formatVersion === 2) requireCondition(typeof approval.supersedesApprovalSha256 === 'string' &&
    hashPattern.test(approval.supersedesApprovalSha256), 'invalid_previous_approval_hash');
  const source = approval.source;
  exactKeys(source, ['projectRef', 'capturedAtUtc', 'postgresMajor', 'captureMethod', 'schemaCaptureSha256', 'ledgerCaptureSha256', 'ledgerBefore', 'ledgerAfter'], 'invalid_source_fields');
  requireCondition(source.projectRef === candidate.liveObservation.projectRef && source.postgresMajor === 17 &&
    ['supabase-db-dump-schema-only', 'pg-dump-schema-only'].includes(source.captureMethod) &&
    validUtc(source.capturedAtUtc) && hashPattern.test(source.schemaCaptureSha256) &&
    hashPattern.test(source.ledgerCaptureSha256), 'invalid_capture_provenance');
  validateLedger(source.ledgerBefore);
  validateLedger(source.ledgerAfter);
  requireCondition(['count', 'maxVersion', 'catalogMd5'].every((key) => source.ledgerBefore[key] === source.ledgerAfter[key]), 'ledger_changed_during_capture');
  const review = approval.review;
  exactKeys(review, ['decision', 'reviewer', 'evidenceId', 'reviewedAtUtc', ...reviewAssertions], 'invalid_review_fields');
  requireCondition(review.decision === 'approved-for-local-preparation' &&
    typeof review.reviewer === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._@ -]{2,99}$/.test(review.reviewer) &&
    typeof review.evidenceId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(review.evidenceId) &&
    validUtc(review.reviewedAtUtc) && review.reviewedAtUtc >= source.capturedAtUtc &&
    Date.parse(review.reviewedAtUtc) <= Date.now() + 300_000 && reviewAssertions.every((key) => review[key] === true), 'review_incomplete');
  exactKeys(approval.candidate, ['manifestSha256', 'forwards'], 'invalid_candidate_fields');
  requireCondition(approval.candidate.manifestSha256 === candidateSha256 &&
    Array.isArray(approval.candidate.forwards) && approval.candidate.forwards.length === candidate.forwards.length, 'candidate_manifest_changed');
  let previousVersion = source.ledgerAfter.maxVersion;
  for (let index = 0; index < candidate.forwards.length; index += 1) {
    const forward = approval.candidate.forwards[index];
    const expected = candidate.forwards[index];
    exactKeys(forward, ['version', 'filename', 'sha256'], 'invalid_forward_fields');
    requireCondition(/^\d{14}_[a-z0-9_]+\.sql$/.test(forward.filename) && /^\d{14}$/.test(forward.version) &&
      forward.filename.startsWith(`${forward.version}_`) && hashPattern.test(forward.sha256) &&
      ['version', 'filename', 'sha256'].every((key) => forward[key] === expected[key]) &&
      forward.version > previousVersion, 'forward_list_changed_or_not_after_capture');
    previousVersion = forward.version;
  }
  requireCondition(Array.isArray(approval.artifacts) && approval.artifacts.length >= 2 && approval.artifacts.length <= 16, 'invalid_artifact_count');
  const filenames = new Set();
  const foundRoles = new Set();
  let totalBytes = 0;
  for (const artifact of approval.artifacts) {
    exactKeys(artifact, ['filename', 'role', 'bytes', 'sha256'], 'invalid_artifact_fields');
    requireCondition(typeof artifact.filename === 'string' && /^[a-z][a-z0-9-]{0,95}\.sql$/.test(artifact.filename) &&
      !filenames.has(artifact.filename) && roles.includes(artifact.role) &&
      Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 64 * 1024 * 1024 &&
      hashPattern.test(artifact.sha256), 'invalid_artifact_identity');
    filenames.add(artifact.filename);
    foundRoles.add(artifact.role);
    totalBytes += artifact.bytes;
  }
  requireCondition(totalBytes <= 128 * 1024 * 1024 && foundRoles.has('application-schema') && foundRoles.has('managed-customizations'), 'incomplete_or_oversized_baseline');
}

// The caller supplies the independently reviewed digest. JSON review assertions
// record a decision; their presence cannot establish that a review actually occurred.
export function loadReviewedLocalBaseline({ root, manifestPath, approvedSha256, prepared = false }) {
  requireCondition(typeof approvedSha256 === 'string' && hashPattern.test(approvedSha256), 'external_approval_hash_required');
  requireCondition(typeof manifestPath === 'string' && isAbsolute(manifestPath), 'absolute_private_manifest_required');
  root = resolve(root);
  manifestPath = resolve(manifestPath);
  const insideRoot = relative(root, manifestPath);
  if (prepared) {
    requireCondition([join(root, '.local-staging/baseline/approval.json'),
      join(root, '.local-staging/baseline/revisions', approvedSha256, 'approval.json')].includes(manifestPath), 'wrong_prepared_manifest_path');
  } else {
    requireCondition(insideRoot.startsWith(`..${sep}`) || isAbsolute(insideRoot), 'private_input_must_be_outside_checkout');
  }
  const approvalBytes = readBounded(manifestPath, 256 * 1024);
  requireCondition(digest(approvalBytes) === approvedSha256, 'approval_hash_mismatch');
  const approval = parseJson(approvalBytes);
  const candidateBytes = Buffer.from(readBounded(join(root, 'docs/qa/baseline-candidate-manifest.json'), 256 * 1024).toString('utf8').replace(/\r\n/g, '\n'));
  const candidate = parseJson(candidateBytes);
  requireCondition(candidate.formatVersion === 1 && candidate.supabaseCliVersion === '2.116.0' &&
    candidate.requiresFreshLiveLedgerCheck === true && Array.isArray(candidate.forwards) && candidate.forwards.length > 0 &&
    candidate.forwards.length === EXPECTED_FORWARD_FILES.length &&
    candidate.forwards.every((forward, index) => forward.filename === EXPECTED_FORWARD_FILES[index]) &&
    candidate.liveObservation?.projectRef, 'invalid_repository_candidate_manifest');
  validateApproval(approval, candidate, digest(candidateBytes));
  const prefix = approval.formatVersion === 1 ? 'baseline' : `baseline/revisions/${approvedSha256}`;
  if (prepared) requireCondition(manifestPath === join(root, '.local-staging', prefix, 'approval.json'), 'wrong_prepared_manifest_path');
  requireCondition(approval.supersedesApprovalSha256 !== approvedSha256, 'approval_cycle');
  const files = new Map([[`${prefix}/approval.json`, approvalBytes]]);
  for (const artifact of approval.artifacts) {
    const bytes = readBounded(join(dirname(manifestPath), artifact.filename), artifact.bytes);
    requireCondition(bytes.length === artifact.bytes && digest(bytes) === artifact.sha256, 'baseline_artifact_changed');
    files.set(`${prefix}/${artifact.filename}`, bytes);
  }
  for (const forward of candidate.forwards) {
    const bytes = readBounded(join(root, 'supabase/migrations', forward.filename), 16 * 1024 * 1024);
    requireCondition(digest(bytes) === forward.sha256, 'candidate_forward_changed');
    files.set(`${prefix}/forwards/${forward.filename}`, bytes);
  }
  return { approvedSha256, approval, files, approvalArtifact: `${prefix}/approval.json`, revisionCount: 0, previous: null };
}

export function combineLocalBaselineRevision(previous, revision) {
  requireCondition(revision.approval.formatVersion === 2 &&
    revision.approval.supersedesApprovalSha256 === previous.approvedSha256, 'previous_approval_mismatch');
  requireCondition(previous.revisionCount < MAX_BASELINE_REVISIONS, 'revision_depth_exceeded');
  const seen = new Set([revision.approvedSha256]);
  for (let ancestor = previous; ancestor; ancestor = ancestor.previous) {
    requireCondition(!seen.has(ancestor.approvedSha256), 'approval_cycle');
    seen.add(ancestor.approvedSha256);
    requireCondition(seen.size <= MAX_BASELINE_REVISIONS + 1, 'revision_depth_exceeded');
  }
  requireCondition(revision.approval.review.reviewedAtUtc >= previous.approval.review.reviewedAtUtc, 'revision_review_predates_previous');
  for (const path of revision.files.keys()) requireCondition(!previous.files.has(path), 'revision_path_collision');
  return { ...revision, previous, revisionCount: previous.revisionCount + 1,
    files: new Map([...previous.files, ...revision.files]) };
}

export function loadPreparedLocalBaseline({ root, approvedSha256 }) {
  requireCondition(typeof approvedSha256 === 'string' && hashPattern.test(approvedSha256), 'external_approval_hash_required');
  const originalPath = join(resolve(root), '.local-staging/baseline/approval.json');
  const originalHash = digest(readBounded(originalPath, 256 * 1024));
  const seen = new Set();
  function load(hash) {
    requireCondition(!seen.has(hash), 'approval_cycle');
    requireCondition(seen.size <= MAX_BASELINE_REVISIONS, 'revision_depth_exceeded');
    seen.add(hash);
    const manifestPath = hash === originalHash ? originalPath : join(resolve(root), '.local-staging/baseline/revisions', hash, 'approval.json');
    let revision;
    try {
      revision = loadReviewedLocalBaseline({ root, manifestPath, approvedSha256: hash, prepared: true });
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Local baseline approval rejected: approval_hash_mismatch_or_missing_revision');
      throw error;
    }
    return revision.approval.formatVersion === 1 ? revision : combineLocalBaselineRevision(load(revision.approval.supersedesApprovalSha256), revision);
  }
  return load(approvedSha256);
}
