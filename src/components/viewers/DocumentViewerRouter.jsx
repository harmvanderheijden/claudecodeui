import React from 'react';
import CodeEditor from '../CodeEditor';
import PDFViewer from './PDFViewer';
import MarkdownViewer from './MarkdownViewer';
import { getViewerType, VIEWER_TYPES } from './viewerRegistry';

/**
 * Routes files to the appropriate viewer component based on file type
 * Extensible architecture - add new viewers by:
 * 1. Creating the viewer component
 * 2. Adding to viewerRegistry.js
 * 3. Adding case to switch statement below
 */
export default function DocumentViewerRouter({
  file,
  onClose,
  projectPath,
  isSidebar,
  isExpanded,
  onToggleExpand,
  onPopOut,
}) {
  // Determine which viewer to use
  const viewerType = getViewerType(file.name);

  // Route to appropriate viewer
  switch (viewerType) {
    case VIEWER_TYPES.PDF:
      return (
        <PDFViewer
          file={file}
          onClose={onClose}
          projectPath={projectPath}
          isSidebar={isSidebar}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onPopOut={onPopOut}
        />
      );

    case VIEWER_TYPES.MARKDOWN:
      return (
        <MarkdownViewer
          file={file}
          onClose={onClose}
          projectPath={projectPath}
          isSidebar={isSidebar}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onPopOut={onPopOut}
        />
      );

    case VIEWER_TYPES.CODE:
    default:
      // Default to CodeEditor for text files
      return (
        <CodeEditor
          file={file}
          onClose={onClose}
          projectPath={projectPath}
          isSidebar={isSidebar}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onPopOut={onPopOut}
        />
      );
  }
}
