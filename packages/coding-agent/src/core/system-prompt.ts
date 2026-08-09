/**
 * System prompt construction and project context loading.
 *
 * 从 pi 项目 core/system-prompt.ts 抄来（V1 最小化）。
 * 🔴 暂未实现: formatSkillsForPrompt / Skill —— skills 子系统未构建。
 */

/** buildSystemPrompt 的选项 */
export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default). */
  customPrompt?: string;
  /** Tools to include in prompt. Default: [read, bash, edit, write] */
  selectedTools?: string[];
  /** Optional one-line tool snippets keyed by tool name. 🔴 V1 桩 */
  toolSnippets?: Record<string, string>;
  /** Additional guideline bullets appended to the default system prompt guidelines. */
  promptGuidelines?: string[];
  /** Text to append to system prompt. */
  appendSystemPrompt?: string;
  /** Working directory. */
  cwd: string;
  /** Pre-loaded context files. 🔴 V1 桩——context 文件加载未实现 */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Pre-loaded skills. 🔴 V1 桩——skills 子系统未构建 */
  skills?: any[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    customPrompt,
    selectedTools,
    toolSnippets,
    promptGuidelines,
    appendSystemPrompt,
    cwd,
    contextFiles: providedContextFiles,
    skills: providedSkills,
  } = options;
  const promptCwd = cwd.replace(/\\/g, "/");

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

  const contextFiles = providedContextFiles ?? [];
  const skills = providedSkills ?? [];

  if (customPrompt) {
    let prompt = customPrompt;

    if (appendSection) {
      prompt += appendSection;
    }

    // Append project context files
    if (contextFiles.length > 0) {
      prompt += "\n\n<project_context>\n\n";
      prompt += "Project-specific instructions and guidelines:\n\n";
      for (const { path: filePath, content } of contextFiles) {
        prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
      }
      prompt += "</project_context>\n";
    }

    // 🔴 Pi: Append skills section (only if read tool is available)
    // const customPromptHasRead = !selectedTools || selectedTools.includes("read");
    // if (customPromptHasRead && skills.length > 0) { prompt += formatSkillsForPrompt(skills); }

    prompt += `\nCurrent working directory: ${promptCwd}`;

    return prompt;
  }

  // 🔴 Pi: getReadmePath / getDocsPath / getExamplesPath —— Pi 文档路径，V1 不需要
  // 但保留 config 导入和函数调用

  // Build tools list based on selected tools.
  // A tool appears in Available tools only when the caller provides a one-line snippet.
  const tools = selectedTools || ["read_file", "bash", "edit", "write_file", "find", "grep", "ls"];
  const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n")
      : tools.map((name) => `- ${name}`).join("\n");

  // Build guidelines based on which tools are actually available
  const guidelinesList: string[] = [];
  const guidelinesSet = new Set<string>();
  const addGuideline = (guideline: string): void => {
    if (guidelinesSet.has(guideline)) return;
    guidelinesSet.add(guideline);
    guidelinesList.push(guideline);
  };

  const hasBash = tools.includes("bash");
  const hasGrep = tools.includes("grep");
  const hasFind = tools.includes("find");
  const hasLs = tools.includes("ls");
  const hasRead = tools.includes("read_file") || tools.includes("read");

  // File exploration guidelines
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline("Use bash for file operations like ls, rg, find");
  }

  for (const guideline of promptGuidelines ?? []) {
    const normalized = guideline.trim();
    if (normalized.length > 0) addGuideline(normalized);
  }

  // Always include these
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  // 🔴 Pi: Pi documentation 段落——V1 替换为简化的 mimi 版本
  let prompt = `You are an expert coding assistant. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

Guidelines:
${guidelines}`;

  if (appendSection) {
    prompt += appendSection;
  }

  // Append project context files
  if (contextFiles.length > 0) {
    prompt += "\n\n<project_context>\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path: filePath, content } of contextFiles) {
      prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
    }
    prompt += "</project_context>\n";
  }

  // 🔴 Pi: Append skills section (only if read tool is available)
  // if (hasRead && skills.length > 0) { prompt += formatSkillsForPrompt(skills); }

  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}
