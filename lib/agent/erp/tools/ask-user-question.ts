import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";

const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";
const ASK_USER_QUESTION_TOOL_CHIP_WIDTH = 12;

const DESCRIPTION =
  "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices.";

const PREVIEW_FEATURE_PROMPT = `
Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`.trim();

const ASK_USER_QUESTION_TOOL_PROMPT = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ${EXIT_PLAN_MODE_TOOL_NAME} for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ${EXIT_PLAN_MODE_TOOL_NAME}. If you need plan approval, use ${EXIT_PLAN_MODE_TOOL_NAME} instead.
`;

const optionSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice."
    ),
  description: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications."
    ),
  preview: z
    .string()
    .optional()
    .describe(
      "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format."
    ),
});

const questionSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"'
    ),
  header: z
    .string()
    .trim()
    .min(1)
    .max(ASK_USER_QUESTION_TOOL_CHIP_WIDTH)
    .describe(
      `Very short label displayed as a chip/tag (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} chars). Examples: "Auth method", "Library", "Approach".`
    ),
  options: z
    .array(optionSchema)
    .min(2)
    .max(4)
    .describe(
      "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically."
    ),
  multiSelect: z
    .boolean()
    .default(false)
    .describe(
      "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."
    ),
});

const askUserQuestionInputSchema = z
  .strictObject({
    questions: z
      .array(questionSchema)
      .min(1)
      .max(4)
      .describe("Questions to ask the user (1-4 questions)"),
  })
  .refine(
    (data) => {
      const questions = data.questions.map((question) => question.question);
      if (questions.length !== new Set(questions).size) {
        return false;
      }

      for (const question of data.questions) {
        const labels = question.options.map((option) => option.label);
        if (labels.length !== new Set(labels).size) {
          return false;
        }
      }

      return true;
    },
    {
      message: "Question texts must be unique, option labels must be unique within each question",
    }
  );

type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;

export const askUserQuestionTool = buildTool({
  name: "AskUserQuestion",
  description: DESCRIPTION,
  prompt: `${ASK_USER_QUESTION_TOOL_PROMPT}\n\n${PREVIEW_FEATURE_PROMPT}`,
  inputSchema: askUserQuestionInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async canUse(input: AskUserQuestionInput) {
    return {
      behavior: "ask",
      updatedInput: input,
      kind: "question",
      message: "Need clarification from the user before continuing.",
      payload: {
        questions: input.questions,
      },
    };
  },
  async call(input: AskUserQuestionInput) {
    return input;
  },
});
