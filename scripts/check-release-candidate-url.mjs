import { assertImmutableCandidateOrigin } from "./release-candidate-origin.mjs";

const candidate = process.env.CANDIDATE_URL;
if (!candidate) throw new Error("CANDIDATE_URL is required.");
console.log(`Candidate URL verified: ${assertImmutableCandidateOrigin(candidate)}`);
