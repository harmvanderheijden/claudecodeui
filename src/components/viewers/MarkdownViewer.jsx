import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, Maximize2, Minimize2, Eye, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark as prismOneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { api } from '../../utils/api';
import { useTranslation } from 'react-i18next';

function MarkdownCodeBlock({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const shouldInline = inline || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${className || ''}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="relative group my-2">
      {language && language !== 'text' && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(raw).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <SyntaxHighlighter
        language={language}
        style={prismOneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents = {
  code: MarkdownCodeBlock,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
  ),
  // HTML tag styling for broad markdown support
  mark: ({ children }) => (
    <mark className="bg-yellow-200 dark:bg-yellow-800 dark:text-yellow-100 px-0.5 rounded-sm">{children}</mark>
  ),
  ins: ({ children }) => (
    <ins className="underline decoration-green-500 dark:decoration-green-400 text-green-800 dark:text-green-300 no-underline bg-green-50 dark:bg-green-900/30 px-0.5 rounded-sm">{children}</ins>
  ),
  del: ({ children }) => (
    <del className="line-through decoration-red-500 dark:decoration-red-400 text-red-800 dark:text-red-300 opacity-70">{children}</del>
  ),
  u: ({ children }) => (
    <u className="underline decoration-2 underline-offset-2">{children}</u>
  ),
  // Image rendering with responsive sizing
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg shadow-sm"
      loading="lazy"
      {...props}
    />
  ),
};

export default function MarkdownViewer({
  file,
  onClose,
  projectPath,
  isSidebar = true,
  isExpanded = false,
  onToggleExpand,
  onPopOut,
}) {
  const { t } = useTranslation('codeEditor');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSource, setShowSource] = useState(false);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeRaw, rehypeKatex], []);

  // Load markdown file content
  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.readFile(file.projectName, file.path);

        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
      } catch (err) {
        console.error('Error loading markdown file:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [file.path, file.projectName]);

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 ${isSidebar ? '' : 'fixed inset-0 z-50'}`}>
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate" title={file.name}>
            {file.name}
          </span>
        </div>

        <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
          {/* Toggle source / rendered view */}
          <button
            onClick={() => setShowSource(!showSource)}
            className={`p-1.5 rounded-md min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center transition-colors ${
              showSource
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title={showSource ? 'Show rendered' : 'Show source'}
          >
            {showSource ? <Eye className="w-4 h-4" /> : <Code2 className="w-4 h-4" />}
          </button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={!content}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('actions.download')}
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Expand/Collapse (only in sidebar mode) */}
          {isSidebar && onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="hidden md:flex p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
              title={isExpanded ? 'Restore' : 'Expand'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            title={t('actions.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-gray-500 dark:text-gray-400">Loading...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-600 dark:text-red-400">
              <p className="font-semibold">Error loading file</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          showSource ? (
            /* Raw source view */
            <pre className="p-4 text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {content}
            </pre>
          ) : (
            /* Rendered markdown view */
            <div className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-code:text-sm prose-pre:bg-gray-900 prose-img:rounded-lg max-w-none">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          )
        )}
      </div>
    </div>
  );
}
