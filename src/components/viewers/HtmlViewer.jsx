import React, { useState, useEffect } from 'react';
import { X, Download, Maximize2, Minimize2, Eye, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../utils/api';

/**
 * HTML viewer with a rendered preview and a raw-source toggle, mirroring
 * MarkdownViewer.
 *
 * The rendered view uses a sandboxed <iframe srcDoc>. The sandbox keeps the
 * document on a unique opaque origin so it cannot reach the parent app, cookies,
 * or storage; `allow-scripts` lets dynamic pages run their own JS in that
 * isolation. Note: relative asset URLs (images/CSS) won't resolve because srcDoc
 * has no base URL — inline/internal styles and absolute URLs render as expected.
 */
export default function HtmlViewer({
  file,
  onClose,
  projectPath,
  isSidebar = true,
  isExpanded = false,
  onToggleExpand,
}) {
  const { t } = useTranslation('codeEditor');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSource, setShowSource] = useState(false);

  // Load HTML file content (text)
  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.readFile(file.projectId ?? projectPath, file.path);

        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
      } catch (err) {
        console.error('Error loading HTML file:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [file.path, file.projectId, projectPath]);

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex h-full flex-col bg-white dark:bg-gray-900 ${isSidebar ? '' : 'fixed inset-0 z-50'}`}>
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-white" title={file.name}>
            {file.name}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-0.5 md:gap-1">
          {/* Toggle source / rendered view */}
          <button
            onClick={() => setShowSource(!showSource)}
            className={`flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-1.5 transition-colors md:min-h-0 md:min-w-0 ${
              showSource
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
            }`}
            title={showSource ? 'Show rendered' : 'Show source'}
          >
            {showSource ? <Eye className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
          </button>

          <div className="mx-1 h-6 w-px bg-gray-300 dark:bg-gray-600" />

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={!content}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:min-h-0 md:min-w-0"
            title={t('actions.download')}
          >
            <Download className="h-4 w-4" />
          </button>

          {/* Expand/Collapse (only in sidebar mode) */}
          {isSidebar && onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="hidden items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:flex"
              title={isExpanded ? 'Restore' : 'Expand'}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:min-h-0 md:min-w-0"
            title={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600"></div>
              <span className="text-gray-500 dark:text-gray-400">Loading...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center">
            <div className="text-red-600 dark:text-red-400">
              <p className="font-semibold">Error loading file</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          showSource ? (
            /* Raw source view */
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-gray-800 dark:text-gray-200">
              {content}
            </pre>
          ) : (
            /* Rendered HTML view (isolated, sandboxed) */
            <iframe
              title={file.name}
              srcDoc={content}
              sandbox="allow-scripts"
              className="h-full w-full border-0 bg-white"
            />
          )
        )}
      </div>
    </div>
  );
}
