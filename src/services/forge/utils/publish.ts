import simpleGit from 'simple-git'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { safeRepoPath } from './repo'
import { createPullRequest, getDefaultBranch, parseGitHubRepo } from './github'

export { getGitHubToken } from './github'

export interface PublishOptions {
  workDir: string
  repoUrl: string
  files: Array<{ path: string; content: string }>
  branchName?: string
  title: string
  description: string
  token: string
}

export interface PublishResult {
  mrUrl: string
  mrIid: number
  branch: string
  title: string
}

export async function publishToGitHub(opts: PublishOptions): Promise<PublishResult> {
  const { workDir, repoUrl, files, title, description, token } = opts

  const repoRef = parseGitHubRepo(repoUrl)

  console.log(`[Publish] Publishing to github.com / ${repoRef.owner}/${repoRef.repo}`)

  // Get the repo's default branch
  const targetBranch = await getDefaultBranch(token, repoRef)

  // Generate branch name if not provided
  const branch = opts.branchName || `forge/${Date.now().toString(36)}`

  // Git operations
  const git = simpleGit(workDir)
  await git.checkoutLocalBranch(branch)

  // Write all files
  for (const file of files) {
    const fullPath = safeRepoPath(workDir, file.path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, file.content, 'utf-8')
  }

  // Stage, commit, push
  await git.add('.')
  await git.commit(`forge: ${title}`)
  await git.push('origin', branch)

  console.log(`[Publish] Pushed branch ${branch}`)

  // Create pull request
  const pr = await createPullRequest(token, repoRef, {
    head: branch,
    base: targetBranch,
    title,
    body: description,
  })

  console.log(`[Publish] Created PR #${pr.number}: ${pr.html_url}`)

  return {
    mrUrl: pr.html_url,
    mrIid: pr.number,
    branch,
    title,
  }
}
