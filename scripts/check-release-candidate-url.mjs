const candidate = process.env.CANDIDATE_URL;
if (!candidate) throw new Error("CANDIDATE_URL is required.");

let url;
try {
  url = new URL(candidate);
} catch {
  throw new Error("Candidate URL is invalid.");
}

// The hosted test uses staging credentials. Only immutable deployment URLs in
// the project's Vercel team may receive them; aliases and arbitrary hosts do not.
const immutableHost = /^agvlogistica-[a-z0-9]{9}-centrialhubs-projects\.vercel\.app$/;
if (url.protocol !== "https:" || !immutableHost.test(url.hostname)
  || url.username || url.password || url.port || url.pathname !== "/"
  || url.search || url.hash || (candidate !== url.origin && candidate !== `${url.origin}/`)) {
  throw new Error("Candidate URL must be an HTTPS immutable deployment URL for the agvlogistica Vercel project.");
}

console.log(`Candidate URL verified: ${url.origin}`);
