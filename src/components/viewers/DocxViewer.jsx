import React, { useState, useEffect, useRef, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { X, Download, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';
import { useTranslation } from 'react-i18next';

export default function DocxViewer({
  file,
  onClose,
  projectPath,
  isSidebar = true,
  isExpanded = false,
  onToggleExpand,
}) {
  const { t } = useTranslation('codeEditor');
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const containerRef = useRef(null);
  const blobRef = useRef(null);

  // Load and render the .docx file
  useEffect(() => {
    const loadDocx = async () => {
      try {
        setLoading(true);
        setError(null);

        const url = `/api/projects/${encodeURIComponent(file.projectName)}/files/content?path=${encodeURIComponent(file.path)}`;
        const response = await authenticatedFetch(url);

        if (!response.ok) {
          throw new Error(`Failed to load document: ${response.statusText}`);
        }

        const blob = await response.blob();
        blobRef.current = blob;
        setBlobUrl(URL.createObjectURL(blob));

        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          await renderAsync(blob, containerRef.current, null, {
            renderChanges: true,
            ignoreWidth: false,
            ignoreHeight: true,
          });
        }
      } catch (err) {
        console.error('Error loading DOCX:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDocx();

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [file.path, file.projectName]);

  const handleDownload = useCallback(() => {
    if (blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.name;
      a.click();
    }
  }, [blobUrl, file.name]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
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
          {/* Zoom Controls */}
          <button
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            disabled={scale >= 3.0}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={!blobUrl}
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

      {/* DOCX Content */}
      <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 dark:text-gray-400">Loading document...</div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-600 dark:text-red-400">
              <p className="font-semibold">Error loading document</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className="docx-viewer-container"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            display: loading || error ? 'none' : 'block',
          }}
        />
      </div>

      {/* Track changes styling */}
      <style>{`
        .docx-viewer-container ins {
          text-decoration: underline;
          color: #16a34a;
        }
        .docx-viewer-container del {
          text-decoration: line-through;
          color: #dc2626;
        }
      `}</style>
    </div>
  );
}
