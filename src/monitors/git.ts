import simpleGit, { SimpleGit } from "simple-git";
import { existsSync } from "fs";
import { basename } from "path";

export interface GitRepoStatus {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  uncommittedChanges: number;
  untrackedFiles: number;
  recentCommits: GitCommit[];
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  error?: string;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

async function getRepoStatus(repoPath: string): Promise<GitRepoStatus> {
  const name = basename(repoPath);

  if (!existsSync(repoPath)) {
    return {
      name,
      path: repoPath,
      branch: "",
      ahead: 0,
      behind: 0,
      uncommittedChanges: 0,
      untrackedFiles: 0,
      recentCommits: [],
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      error: "Path does not exist",
    };
  }

  const git: SimpleGit = simpleGit(repoPath);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        name,
        path: repoPath,
        branch: "",
        ahead: 0,
        behind: 0,
        uncommittedChanges: 0,
        untrackedFiles: 0,
        recentCommits: [],
        remoteUrl: null,
        githubOwner: null,
        githubRepo: null,
        error: "Not a git repository",
      };
    }

    const status = await git.status();
    const log = await git.log({ maxCount: 5 });

    const recentCommits: GitCommit[] = log.all.map((c) => ({
      hash: c.hash.slice(0, 7),
      date: c.date,
      message: c.message.slice(0, 80),
      author: c.author_name,
    }));

    // Get remote URL
    let remoteUrl: string | null = null;
    try {
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin");
      remoteUrl = origin?.refs?.fetch || origin?.refs?.push || null;
    } catch {
      // no remotes
    }

    // Parse GitHub owner/repo from remote URL
    const { owner: githubOwner, repo: githubRepo } = parseGitHubUrl(remoteUrl);

    return {
      name,
      path: repoPath,
      branch: status.current ?? "detached",
      ahead: status.ahead,
      behind: status.behind,
      uncommittedChanges:
        status.modified.length + status.staged.length + status.deleted.length,
      untrackedFiles: status.not_added.length,
      recentCommits,
      remoteUrl,
      githubOwner,
      githubRepo,
    };
  } catch (err) {
    return {
      name,
      path: repoPath,
      branch: "",
      ahead: 0,
      behind: 0,
      uncommittedChanges: 0,
      untrackedFiles: 0,
      recentCommits: [],
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function getGitStatus(repos: string[]): Promise<GitRepoStatus[]> {
  return Promise.all(repos.map(getRepoStatus));
}

function parseGitHubUrl(url: string | null): { owner: string | null; repo: string | null } {
  if (!url) return { owner: null, repo: null };
  // Match: git@github.com:owner/repo.git, https://github.com/owner/repo.git, https://github.com/owner/repo
  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return { owner: null, repo: null };
}

export async function cloneRepo(url: string, targetPath: string): Promise<void> {
  const git = simpleGit();
  await git.clone(url, targetPath);
}

/** Initialize a new git repo at targetPath. Creates the directory if needed. */
export async function initRepo(targetPath: string): Promise<void> {
  const { mkdirSync } = await import("fs");
  mkdirSync(targetPath, { recursive: true });
  const git = simpleGit(targetPath);
  await git.init();
}

/** Create a GitHub repo using `gh` CLI and set it as origin. Returns the repo URL. */
export async function createGitHubRepo(
  targetPath: string,
  repoName: string,
  isPrivate: boolean
): Promise<string> {
  const { execSync } = await import("child_process");

  // Create repo on GitHub
  const visibility = isPrivate ? "--private" : "--public";
  const result = execSync(
    `gh repo create ${JSON.stringify(repoName)} ${visibility} --clone=false`,
    { encoding: "utf-8", timeout: 30_000 }
  ).trim();

  // Extract URL from gh output (it prints the URL)
  const urlMatch = result.match(/(https:\/\/github\.com\/[^\s]+)/);
  const repoUrl = urlMatch ? urlMatch[1] : `https://github.com/${repoName}`;

  // Add as remote
  const git = simpleGit(targetPath);
  await git.addRemote("origin", `${repoUrl}.git`);

  return repoUrl;
}

export async function getGitRepoStatus(
  repos: string[],
  repoName: string
): Promise<GitRepoStatus | null> {
  const match = repos.find(
    (r) => basename(r).toLowerCase() === repoName.toLowerCase()
  );
  if (!match) return null;
  return getRepoStatus(match);
}
