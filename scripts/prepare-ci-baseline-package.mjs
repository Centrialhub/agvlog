import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReviewedLocalBaseline, MAX_BASELINE_REVISIONS } from './local-staging-baseline.mjs';
import { prepareLocalStaging, reviseLocalStaging } from './prepare-local-staging.mjs';

export function prepareCiBaselinePackage({ root, directory, approvedSha256 }) {
  if (!isAbsolute(directory ?? '') || !/^[a-f0-9]{64}$/.test(approvedSha256 ?? '')) {
    throw new Error('Absolute private baseline directory and approved SHA-256 required');
  }
  const location = relative(resolve(root), resolve(directory));
  if (!(location.startsWith(`..${sep}`) || isAbsolute(location))) {
    throw new Error('Private baseline input must be outside the checkout');
  }
  const initial = join(directory, 'approval.json');
  const initialSha = createHash('sha256').update(readFileSync(initial)).digest('hex');
  const chain = [];
  const seen = new Set();
  let current = approvedSha256;
  while (true) {
    if (seen.has(current) || chain.length > MAX_BASELINE_REVISIONS) throw new Error('Invalid baseline revision chain');
    seen.add(current);
    const manifestPath = current === initialSha ? initial : join(directory, 'revisions', current, 'approval.json');
    const reviewed = loadReviewedLocalBaseline({ root, manifestPath, approvedSha256: current });
    chain.unshift({ manifestPath, sha: current, reviewed });
    if (reviewed.approval.formatVersion === 1) {
      if (current !== initialSha) throw new Error('Unexpected baseline root');
      break;
    }
    current = reviewed.approval.supersedesApprovalSha256;
  }
  // Validate every approved artifact before the first write; never replace an
  // applied migration or update an approval manifest to make a check pass.
  prepareLocalStaging({ root, baselineManifest: chain[0].manifestPath, approvedSha256: chain[0].sha });
  for (let index = 1; index < chain.length; index += 1) {
    reviseLocalStaging({ root, baselineManifest: chain[index].manifestPath,
      previousApprovedSha256: chain[index - 1].sha, approvedSha256: chain[index].sha });
  }
  return { approvalSha256: approvedSha256, revisions: chain.length - 1, sqlExecuted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(prepareCiBaselinePackage({ root: resolve(fileURLToPath(new URL('..', import.meta.url))),
      directory: process.env.AGVLOG_REVIEWED_BASELINE_DIRECTORY,
      approvedSha256: process.env.AGVLOG_REVIEWED_BASELINE_SHA256 })));
  } catch {
    console.error('Private reviewed baseline package rejected; check the artifact path, approval chain and hashes. No remote database fallback.');
    process.exitCode = 1;
  }
}
