import { prisma } from '@/src/lib/prisma'
import { validateGitHubRepoUrl } from './repo'

const GITHUB_API = 'https://api.github.com'

export interface GitHubRepoRef {
  owner: string
  repo: string
}

export async function getGitHubToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'github' },
    select: { access_token: true },
  })

  if (!account?.access_token) {
    throw new Error('No GitHub account linked. Please re-authenticate with GitHub.')
  }

  return account.access_token
}

export function parseGitHubRepo(repoUrl: string): GitHubRepoRef {
  const cleanUrl = validateGitHubRepoUrl(repoUrl).replace(/\.git$/, '')
  const [owner, repo] = new URL(cleanUrl).pathname.split('/').filter(Boolean)
  return { owner, repo }
}

export async function githubRequest<T>(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  return (await res.json()) as T
}

export async function getDefaultBranch(token: string, { owner, repo }: GitHubRepoRef): Promise<string> {
  const data = await githubRequest<{ default_branch: string }>(token, 'GET', `/repos/${owner}/${repo}`)
  return data.default_branch || 'main'
}

export async function createPullRequest(
  token: string,
  { owner, repo }: GitHubRepoRef,
  opts: { head: string; base: string; title: string; body: string },
): Promise<{ number: number; html_url: string }> {
  return githubRequest(token, 'POST', `/repos/${owner}/${repo}/pulls`, opts)
}

/**
 * Create a new branch off `baseBranch` containing one commit that adds/updates
 * the given files, using the Git Data API (no clone needed).
 */
export async function commitFilesToNewBranch(
  token: string,
  { owner, repo }: GitHubRepoRef,
  opts: {
    baseBranch: string
    branch: string
    message: string
    files: Array<{ path: string; content: string }>
  },
): Promise<void> {
  const base = `/repos/${owner}/${repo}`

  const ref = await githubRequest<{ object: { sha: string } }>(
    token, 'GET', `${base}/git/ref/heads/${opts.baseBranch}`,
  )
  const baseCommit = await githubRequest<{ tree: { sha: string } }>(
    token, 'GET', `${base}/git/commits/${ref.object.sha}`,
  )

  const tree = await githubRequest<{ sha: string }>(token, 'POST', `${base}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: opts.files.map((f) => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      content: f.content,
    })),
  })

  const commit = await githubRequest<{ sha: string }>(token, 'POST', `${base}/git/commits`, {
    message: opts.message,
    tree: tree.sha,
    parents: [ref.object.sha],
  })

  await githubRequest(token, 'POST', `${base}/git/refs`, {
    ref: `refs/heads/${opts.branch}`,
    sha: commit.sha,
  })
}
