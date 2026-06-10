import {
  joinAgentPromptSections,
  resolveAgentPromptSections,
  type AgentPromptSection,
  type AgentPromptSectionDefinition,
} from "./prompt-sections";
import type { AgentTool, AgentToolContext } from "./tool";

export type AgentTaskRunInput = Omit<AgentToolContext, "artifacts"> & {
  artifacts?: AgentToolContext["artifacts"];
};

export type AgentTaskDefinition = {
  id: string;
  purpose: string;
  promptSections: Array<AgentPromptSection | AgentPromptSectionDefinition>;
  tools: AgentTool[];
};

export type AgentTaskContext = AgentToolContext & {
  taskId: string;
  purpose: string;
  promptSections: AgentPromptSection[];
  systemPrompt: string;
  tools: AgentTool[];
};

export function defineAgentTask(definition: AgentTaskDefinition) {
  return {
    ...definition,
    async resolveContext(input: AgentTaskRunInput): Promise<AgentTaskContext> {
      const promptSections = await resolveAgentPromptSections(definition.promptSections);

      return {
        taskId: definition.id,
        purpose: definition.purpose,
        runId: input.runId,
        now: input.now,
        abortSignal: input.abortSignal,
        artifacts: input.artifacts ?? null,
        member: input.member ?? null,
        promptSections,
        systemPrompt: joinAgentPromptSections(promptSections),
        tools: [...definition.tools],
      };
    },
  };
}
