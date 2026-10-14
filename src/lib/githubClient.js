'use strict';

// BE-27 — the minimal server-side GitHub REST client for "Maak review-PR".
// Server only: the token comes from the server environment and is never
// sent to a browser, logged or returned. It can read files on the base
// branch, create one new branch with one commit, and open (or find) a pull
// request. It has no merge, no push to an existing branch, no delete and
// no workflow dispatch — merging stays a human action on GitHub.

const API = 'https://api.github.com';
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

class GithubError extends Error {
  constructor(status, operation) {
    super(`GitHub ${operation} failed (${status})`);
    this.status = status;
    this.operation = operation;
  }
}

/** null when the integration is not configured — callers must then refuse, never fall back. */
function createGithubClient({ token, repository, baseBranch = 'main', fetchImpl = fetch } = {}) {
  if (!token || !repository || !REPOSITORY_PATTERN.test(repository)) return null;

  async function call(operation, method, path, body) {
    const res = await fetchImpl(`${API}/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) throw new GithubError(res.status, operation);
    return res.status === 204 ? null : res.json();
  }

  return {
    repository,
    baseBranch,
    /** The current commit of the base branch. */
    async baseSha() {
      const ref = await call('read base branch', 'GET', `/git/ref/heads/${encodeURIComponent(baseBranch)}`);
      return ref.object.sha;
    },
    /** A UTF-8 text file at a commit. */
    async readFile(path, sha) {
      const file = await call(`read ${path}`, 'GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`);
      if (!file || file.encoding !== 'base64' || typeof file.content !== 'string') throw new GithubError(422, `read ${path}`);
      return Buffer.from(file.content, 'base64').toString('utf8');
    },
    /** One commit on top of `parentSha` with the given files, on a NEW branch (fails if it exists). */
    async commitToNewBranch({ branch, parentSha, files, message }) {
      const parent = await call('read base commit', 'GET', `/git/commits/${parentSha}`);
      const tree = await call('create tree', 'POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      });
      const commit = await call('create commit', 'POST', '/git/commits', { message, tree: tree.sha, parents: [parentSha] });
      await call('create branch', 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
      return { commitSha: commit.sha };
    },
    async openPullRequest({ branch, title, body }) {
      const pr = await call('open pull request', 'POST', '/pulls', { title, body, head: branch, base: baseBranch, draft: false, maintainer_can_modify: true });
      return { number: pr.number, url: pr.html_url, headSha: pr.head && pr.head.sha };
    },
    /** Open pull requests against the base branch (newest first, one page). */
    async openPullRequests() {
      const prs = await call('list pull requests', 'GET', `/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`);
      return (prs || []).map((pr) => ({ number: pr.number, url: pr.html_url, body: pr.body || '', branch: pr.head && pr.head.ref, headSha: pr.head && pr.head.sha }));
    },
    /** 'open' | 'merged' | 'closed' */
    async pullRequestState(number) {
      const pr = await call('read pull request', 'GET', `/pulls/${Number(number)}`);
      return pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
    },
  };
}

module.exports = { createGithubClient, GithubError };
