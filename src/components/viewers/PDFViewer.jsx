import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { X, Download, Maximize2, Minimize2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';
import { useTranslation } from 'react-i18next';
// Import react-pdf styles
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// PDF.js options (CMap, standard fonts, and OpenJPEG WASM for JPEG 2000 images)
// wasmUrl must be absolute because the worker runs from unpkg CDN origin
const pdfOptions = {
  cMapUrl: `//unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `//unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
  wasmUrl: `${window.location.origin}/pdfjs-wasm/`,
};

export default function PDFViewer({
  file,
  onClose,
  projectPath,
  isSidebar = true,
  isExpanded = false,
  onToggleExpand,
}) {
  const { t } = useTranslation('codeEditor');
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load PDF file
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch PDF as blob
        const url = `/api/projects/${encodeURIComponent(file.projectName)}/files/content?path=${encodeURIComponent(file.path)}`;
        const response = await authenticatedFetch(url);

        if (!response.ok) {
          throw new Error(`Failed to load PDF: ${response.statusText}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadPDF();

    // Cleanup object URL on unmount
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [file.path, file.projectName]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const onDocumentLoadError = (error) => {
    console.error('Error loading PDF document:', error);
    setError('Failed to load PDF document');
  };

  const handleDownload = () => {
    if (pdfUrl) {
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = file.name;
      a.click();
    }
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handlePrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages || 1));
  };

  const handlePageInputChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= numPages) {
      setPageNumber(value);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 ${isSidebar ? '' : 'fixed inset-0 z-50'}`}>
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate" title={file.name}>
            {file.name}
          </span>
          {numPages && (
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              ({numPages} {numPages === 1 ? 'page' : 'pages'})
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
          {/* Page Navigation */}
          {numPages > 1 && (
            <>
              <button
                onClick={handlePrevPage}
                disabled={pageNumber <= 1}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  min="1"
                  max={numPages}
                  value={pageNumber}
                  onChange={handlePageInputChange}
                  className="w-12 px-1 py-0.5 text-center bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                />
                <span className="text-gray-500 dark:text-gray-400">/ {numPages}</span>
              </div>

              <button
                onClick={handleNextPage}
                disabled={pageNumber >= numPages}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
            </>
          )}

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
            disabled={!pdfUrl}
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

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 dark:text-gray-400">Loading PDF...</div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-600 dark:text-red-400">
              <p className="font-semibold">Error loading PDF</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && pdfUrl && (
          <div className="flex justify-center p-4">
            <Document
              file={pdfUrl}
              options={pdfOptions}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <div className="flex items-center justify-center p-8">
                  <div className="text-gray-500 dark:text-gray-400">Loading document...</div>
                </div>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                loading={
                  <div className="flex items-center justify-center p-8">
                    <div className="text-gray-500 dark:text-gray-400">Loading page...</div>
                  </div>
                }
                className="shadow-lg"
              />
            </Document>
          </div>
        )}
      </div>
    </div>
  );
}
