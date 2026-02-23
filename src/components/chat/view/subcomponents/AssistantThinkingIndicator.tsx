import { useState, useEffect } from 'react';
import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../SessionProviderLogo';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
  claudeStatus?: { text: string; tokens: number; can_interrupt: boolean } | null;
  toolCount?: number;
  lastToolName?: string | null;
};

export default function AssistantThinkingIndicator({
  selectedProvider,
  claudeStatus,
  toolCount = 0,
  lastToolName,
}: AssistantThinkingIndicatorProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const providerName =
    selectedProvider === 'cursor' ? 'Cursor' : selectedProvider === 'codex' ? 'Codex' : 'Claude';

  const statusText = claudeStatus?.text || 'Thinking';

  // Format elapsed time as mm:ss when over 60s
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="chat-message assistant">
      <div className="w-full">
        <div className="flex items-center space-x-3 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1 bg-transparent">
            <SessionProviderLogo provider={selectedProvider} className="w-full h-full" />
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">{providerName}</div>
        </div>
        <div className="w-full pl-3 sm:pl-0">
          {/* Main status line with animated dots */}
          <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
            <div className="animate-pulse">.</div>
            <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>
              .
            </div>
            <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>
              .
            </div>
            <span className="ml-2">{statusText}...</span>
            <span className="text-gray-400 dark:text-gray-500">({formatTime(elapsedTime)})</span>
          </div>

          {/* Activity details line */}
          {(toolCount > 0 || lastToolName) && (
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 dark:text-gray-500">
              {toolCount > 0 && (
                <span>
                  {toolCount} tool {toolCount === 1 ? 'call' : 'calls'}
                </span>
              )}
              {lastToolName && (
                <>
                  {toolCount > 0 && <span>&middot;</span>}
                  <span>
                    Last: <span className="font-medium text-gray-500 dark:text-gray-400">{lastToolName}</span>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
