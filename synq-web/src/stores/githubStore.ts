import { create } from 'zustand';
import { GitHubStatus, LinkedRepo } from '../services/githubService';

export interface GitActivityEvent {
  id?: string;
  chatId: string;
  repoFullName: string;
  eventType: string;
  action?: string;
  actorLogin?: string;
  actorAvatar?: string;
  title?: string;
  summary?: string;
  url?: string;
  tone: string;
  createdAt: string;
}

export interface PullRequestTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface CommitTarget {
  owner: string;
  repo: string;
  sha: string;
}

export interface FileEditorTarget {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  /** Pre-fill the AI instruction box when opened from "ask AI to change this". */
  instruction?: string;
}

interface GitHubState {
  status: GitHubStatus | null;
  statusChecked: boolean;

  /** Linked repositories keyed by chat id. */
  reposByChat: Record<string, LinkedRepo[]>;
  /** Live webhook activity keyed by chat id, newest first. */
  activityByChat: Record<string, GitActivityEvent[]>;
  /** Chats with unread activity, for the panel badge. */
  unreadActivity: Record<string, number>;

  // Modal / panel routing
  showConnectModal: boolean;
  showLinkRepoModal: boolean;
  pullRequestTarget: PullRequestTarget | null;
  commitTarget: CommitTarget | null;
  fileEditorTarget: FileEditorTarget | null;
  /** Text queued for the message composer (from "quote in chat" actions). */
  pendingComposerInsert: string | null;

  setStatus: (status: GitHubStatus | null) => void;
  setRepos: (chatId: string, repos: LinkedRepo[]) => void;
  addActivity: (event: GitActivityEvent) => void;
  setActivity: (chatId: string, events: GitActivityEvent[]) => void;
  clearUnread: (chatId: string) => void;

  openConnectModal: (open: boolean) => void;
  openLinkRepoModal: (open: boolean) => void;
  openPullRequest: (target: PullRequestTarget | null) => void;
  openCommit: (target: CommitTarget | null) => void;
  openFileEditor: (target: FileEditorTarget | null) => void;
  queueComposerInsert: (text: string | null) => void;
}

export const useGitHubStore = create<GitHubState>((set) => ({
  status: null,
  statusChecked: false,
  reposByChat: {},
  activityByChat: {},
  unreadActivity: {},

  showConnectModal: false,
  showLinkRepoModal: false,
  pullRequestTarget: null,
  commitTarget: null,
  fileEditorTarget: null,
  pendingComposerInsert: null,

  setStatus: (status) => set({ status, statusChecked: true }),

  setRepos: (chatId, repos) =>
    set((state) => ({ reposByChat: { ...state.reposByChat, [chatId]: repos } })),

  addActivity: (event) =>
    set((state) => {
      const existing = state.activityByChat[event.chatId] || [];
      return {
        activityByChat: {
          ...state.activityByChat,
          [event.chatId]: [event, ...existing].slice(0, 100),
        },
        unreadActivity: {
          ...state.unreadActivity,
          [event.chatId]: (state.unreadActivity[event.chatId] || 0) + 1,
        },
      };
    }),

  setActivity: (chatId, events) =>
    set((state) => ({ activityByChat: { ...state.activityByChat, [chatId]: events } })),

  clearUnread: (chatId) =>
    set((state) => ({ unreadActivity: { ...state.unreadActivity, [chatId]: 0 } })),

  openConnectModal: (showConnectModal) => set({ showConnectModal }),
  openLinkRepoModal: (showLinkRepoModal) => set({ showLinkRepoModal }),
  openPullRequest: (pullRequestTarget) => set({ pullRequestTarget }),
  openCommit: (commitTarget) => set({ commitTarget }),
  openFileEditor: (fileEditorTarget) => set({ fileEditorTarget }),
  queueComposerInsert: (pendingComposerInsert) => set({ pendingComposerInsert }),
}));

/** The repository that bare `#123` and `path/file.ts:10-20` resolve against. */
export const getPrimaryRepo = (chatId: string | null): { owner: string; repo: string; fullName: string; defaultBranch: string } | undefined => {
  if (!chatId) return undefined;
  const repos = useGitHubStore.getState().reposByChat[chatId];
  if (!repos || repos.length === 0) return undefined;
  const primary = repos.find((r) => r.isPrimary) || repos[0];
  return { owner: primary.owner, repo: primary.name, fullName: primary.fullName, defaultBranch: primary.defaultBranch };
};

export default useGitHubStore;
