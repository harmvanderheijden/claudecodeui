import React, { memo, useMemo, useCallback } from 'react';
import { getToolConfig } from './configs/toolConfigs';
import { OneLineDisplay, CollapsibleDisplay, DiffViewer, MarkdownContent, FileListContent, TodoListContent, TaskListContent, TextContent, QuestionAnswerContent, SubagentContainer } from './components';
import type { Project } from '../../../types/app';
import type { SubagentChildTool } from '../types/types';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolRendererProps {
  toolName: string;
  toolInput: any;
  toolResult?: any;
  toolId?: string;
  mode: 'input' | 'result';
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  createDiff?: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  rawToolInput?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
}

function getToolCategory(toolName: string): string {
  if (['Edit', 'Write', 'ApplyPatch'].includes(toolName)) return 'edit';
  if (['Grep', 'Glob'].includes(toolName)) return 'search';
  if (toolName === 'Bash') return 'bash';
  if (['TodoWrite', 'TodoRead'].includes(toolName)) return 'todo';
  if (['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(toolName)) return 'task';
  if (toolName === 'Task') return 'agent';  // Subagent task
  if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') return 'plan';
  if (toolName === 'AskUserQuestion') return 'question';
  return 'default';
}

/**
 * Generate a compact one-line preview string for collapsible tool sections.
 * For objects, renders as { key: value, key2: value2 }.
 * For strings, takes the first line / first ~120 chars.
 */
function generatePreview(data: any): string {
  if (data == null) return '';

  if (typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    if (entries.length === 0) return '{}';
    const parts = entries.map(([key, val]) => {
      let v: string;
      if (val == null) v = 'null';
      else if (typeof val === 'string') v = val.length > 40 ? val.slice(0, 40) + '\u2026' : val;
      else if (typeof val === 'object') v = Array.isArray(val) ? `[${val.length}]` : '{...}';
      else v = String(val);
      return `${key}: ${v}`;
    });
    return `{ ${parts.join(', ')} }`;
  }

  if (Array.isArray(data)) {
    return `[${data.length} item${data.length !== 1 ? 's' : ''}]`;
  }

  const str = String(data);
  const firstLine = str.split('\n')[0];
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '\u2026' : firstLine;
}

/**
 * Generate a preview for tool result content.
 * Handles the various shapes results can take.
 */
function generateResultPreview(data: any): string {
  if (data == null) return '';

  // Tool results often have a { content, isError } shape
  const content = data?.content ?? data;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return '';
    const firstLine = trimmed.split('\n')[0];
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '\u2026' : firstLine;
  }

  if (Array.isArray(content)) {
    // Array of content blocks (Anthropic format)
    const texts = content
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text.trim());
    if (texts.length > 0) {
      const joined = texts.join(' ');
      const firstLine = joined.split('\n')[0];
      return firstLine.length > 120 ? firstLine.slice(0, 120) + '\u2026' : firstLine;
    }
    return `[${content.length} item${content.length !== 1 ? 's' : ''}]`;
  }

  if (typeof content === 'object') {
    return generatePreview(content);
  }

  return String(content).slice(0, 120);
}

/**
 * Main tool renderer router
 * Routes to OneLineDisplay or CollapsibleDisplay based on tool config
 */
export const ToolRenderer: React.FC<ToolRendererProps> = memo(({
  toolName,
  toolInput,
  toolResult,
  toolId,
  mode,
  onFileOpen,
  createDiff,
  selectedProject,
  autoExpandTools = false,
  showRawParameters = false,
  rawToolInput,
  isSubagentContainer,
  subagentState
}) => {
  // Route subagent containers to dedicated component
  if (isSubagentContainer && subagentState) {
    if (mode === 'result') {
      return null;
    }
    return (
      <SubagentContainer
        toolInput={toolInput}
        toolResult={toolResult}
        subagentState={subagentState}
      />
    );
  }

  const config = getToolConfig(toolName);
  const displayConfig: any = mode === 'input' ? config.input : config.result;

  const parsedData = useMemo(() => {
    try {
      const rawData = mode === 'input' ? toolInput : toolResult;
      return typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      return mode === 'input' ? toolInput : toolResult;
    }
  }, [mode, toolInput, toolResult]);

  const handleAction = useCallback(() => {
    if (displayConfig?.action === 'open-file' && onFileOpen) {
      const value = displayConfig.getValue?.(parsedData) || '';
      onFileOpen(value);
    }
  }, [displayConfig, parsedData, onFileOpen]);

  // Keep hooks above this guard so hook call order stays stable across renders.
  if (!displayConfig) return null;

  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(parsedData) || '';
    const secondary = displayConfig.getSecondary?.(parsedData);

    return (
      <OneLineDisplay
        toolName={toolName}
        toolResult={toolResult}
        toolId={toolId}
        icon={displayConfig.icon}
        label={displayConfig.label}
        value={value}
        secondary={secondary}
        action={displayConfig.action}
        onAction={handleAction}
        style={displayConfig.style}
        wrapText={displayConfig.wrapText}
        colorScheme={displayConfig.colorScheme}
        resultId={mode === 'input' ? `tool-result-${toolId}` : undefined}
      />
    );
  }

  if (displayConfig.type === 'collapsible') {
    const title = typeof displayConfig.title === 'function'
      ? displayConfig.title(parsedData)
      : displayConfig.title || 'Details';

    const defaultOpen = displayConfig.defaultOpen !== undefined
      ? displayConfig.defaultOpen
      : autoExpandTools;

    const contentProps = displayConfig.getContentProps?.(parsedData, {
      selectedProject,
      createDiff,
      onFileOpen
    }) || {};

    // Build the content component based on contentType
    let contentComponent: React.ReactNode = null;

    switch (displayConfig.contentType) {
      case 'diff':
        if (createDiff) {
          contentComponent = (
            <DiffViewer
              {...contentProps}
              createDiff={createDiff}
              onFileClick={() => onFileOpen?.(contentProps.filePath)}
            />
          );
        }
        break;

      case 'markdown':
        contentComponent = <MarkdownContent content={contentProps.content || ''} />;
        break;

      case 'file-list':
        contentComponent = (
          <FileListContent
            files={contentProps.files || []}
            onFileClick={onFileOpen}
            title={contentProps.title}
          />
        );
        break;

      case 'todo-list':
        if (contentProps.todos?.length > 0) {
          contentComponent = (
            <TodoListContent
              todos={contentProps.todos}
              isResult={contentProps.isResult}
            />
          );
        }
        break;

      case 'task':
        contentComponent = <TaskListContent content={contentProps.content || ''} />;
        break;

      case 'question-answer':
        contentComponent = (
          <QuestionAnswerContent
            questions={contentProps.questions || []}
            answers={contentProps.answers || {}}
          />
        );
        break;

      case 'text':
        contentComponent = (
          <TextContent
            content={contentProps.content || ''}
            format={contentProps.format || 'plain'}
          />
        );
        break;

      case 'success-message': {
        const msg = displayConfig.getMessage?.(parsedData) || 'Success';
        contentComponent = (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {msg}
          </div>
        );
        break;
      }
    }

    // For edit tools, make the title (filename) clickable to open the file
    const handleTitleClick = (toolName === 'Edit' || toolName === 'Write' || toolName === 'ApplyPatch') && contentProps.filePath && onFileOpen
      ? () => onFileOpen(contentProps.filePath, {
          old_string: contentProps.oldContent,
          new_string: contentProps.newContent
        })
      : undefined;

    const preview = mode === 'input'
      ? generatePreview(parsedData)
      : generateResultPreview(parsedData);

    return (
      <CollapsibleDisplay
        toolName={toolName}
        toolId={toolId}
        title={title}
        defaultOpen={defaultOpen}
        onTitleClick={handleTitleClick}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
        toolCategory={getToolCategory(toolName)}
        preview={preview}
      >
        {contentComponent}
      </CollapsibleDisplay>
    );
  }

  return null;
});

ToolRenderer.displayName = 'ToolRenderer';
