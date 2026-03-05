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
  error?: string;
}

interface GitCommit {
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
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function getGitStatus(repos: string[]): Promise<GitRepoStatus[]> {
  return Promise.all(repos.map(getRepoStatus));
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
