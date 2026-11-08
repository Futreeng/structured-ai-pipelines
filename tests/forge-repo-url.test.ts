import { afterEach, describe, expect, it } from 'vitest'
import { validateGitHubRepoUrl } from '../src/services/forge/utils/repo'

describe('Forge GitHub repo URL validation', () => {
  const originalAllowedHosts = process.env.GITHUB_ALLOWED_HOSTS

  afterEach(() => {
    if (originalAllowedHosts === undefined) {
      delete process.env.GITHUB_ALLOWED_HOSTS
    } else {
      process.env.GITHUB_ALLOWED_HOSTS = originalAllowedHosts
    }
  })

  it('accepts GitHub HTTPS URLs', () => {
    expect(validateGitHubRepoUrl('https://github.com/owner/project.git')).toBe(
      'https://github.com/owner/project.git',
    )
  })

  it('accepts configured GitHub Enterprise hosts', () => {
    process.env.GITHUB_ALLOWED_HOSTS = 'git.example.com'

    expect(validateGitHubRepoUrl('https://git.example.com/team/project')).toBe(
      'https://git.example.com/team/project',
    )
  })

  it('rejects unsupported protocols and credentialed URLs', () => {
    expect(() => validateGitHubRepoUrl('http://github.com/owner/project')).toThrow(/https/i)
    expect(() => validateGitHubRepoUrl('ssh://git@github.com/owner/project')).toThrow(/https/i)
    expect(() => validateGitHubRepoUrl('https://token@github.com/owner/project')).toThrow(/https/i)
  })

  it('rejects private/local hosts and public hosts outside the GitHub allowlist', () => {
    expect(() => validateGitHubRepoUrl('https://localhost/owner/project')).toThrow(/github repository/i)
    expect(() => validateGitHubRepoUrl('https://127.0.0.1/owner/project')).toThrow(/github repository/i)
    expect(() => validateGitHubRepoUrl('https://gitlab.com/owner/project')).toThrow(/github repository/i)
  })

  it('requires an owner and repository path', () => {
    expect(() => validateGitHubRepoUrl('https://github.com/owner')).toThrow(/owner and repository/i)
  })
})
