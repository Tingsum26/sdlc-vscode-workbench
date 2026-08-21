import type {
  EnterpriseIdentity,
  EpicResume,
  EpicSummary,
  PodMember,
  RepoTaskSummary,
  TicketSummary,
  WorkflowTask,
} from "../api/workflowClient.js";
import type { FreshViewState } from "./viewState.js";
import type * as vscode from "vscode";

/** A ViewState plus the freshness badge computed by toViewState. */
export type ViewStateWithFreshness<T> = FreshViewState<T>;

/**
 * Narrow client surface the workbench views need. The concrete WorkflowClient
 * satisfies this structurally; tests pass minimal fakes cast to this type.
 */
export interface WorkflowViewsClient {
  listTasks(): Promise<WorkflowTask[]>;
  listEpics(): Promise<EpicSummary[]>;
  getEpicResume(epicId: string): Promise<EpicResume>;
  listTickets(epicId: string): Promise<TicketSummary[]>;
  listRepoTasks(ticketId: string): Promise<RepoTaskSummary[]>;
  getIdentity(): Promise<EnterpriseIdentity>;
  getPodMembers(journeyId: string): Promise<PodMember[]>;
}

/** Store-shaped subset of vscode.Memento used by the customization view. */
export interface KeyValueStore {
  get<T>(key: string, fallback: T): T;
}

/**
 * Record persisted by bundleInstaller under INSTALLED_BUNDLES_KEY. Kept in
 * sync with the private `InstalledBundle`/`stateKey` in
 * `customization/bundleInstaller.ts`.
 */
export interface InstalledBundle {
  version: string;
  root: string;
  installedAt: string;
}

/** globalState key written by bundleInstaller.installCustomizationBundle. */
export const INSTALLED_BUNDLES_KEY = "sdlc.installedCustomizationBundles";

/** MCP catalog entry rendered by the MCP center view. */
export interface McpCatalogEntry {
  id: string;
  name: string;
  required: boolean;
  skills: string[];
}

/** Shared live Epic context for the views whose data is scoped to one Epic. */
export interface EpicSelection {
  selectedEpicId(): string | undefined;
  select(epicId: string): void;
  onDidChange: vscode.Event<void>;
}

/** Journey whose pod members drive the Identity / Pod view. */
export const ACCOUNT_OPENING_JOURNEY = "ACCOUNT_OPENING";
