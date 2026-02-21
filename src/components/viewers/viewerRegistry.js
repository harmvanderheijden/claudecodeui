/**
 * Registry mapping file extensions to viewer components
 * Extensible architecture for adding new document viewers
 */

export const VIEWER_TYPES = {
  CODE: 'code',
  PDF: 'pdf',
  IMAGE: 'image',
  // Future viewer types:
  // OFFICE: 'office',
  // EMAIL: 'email',
  // VIDEO: 'video',
  // AUDIO: 'audio',
};

export const VIEWER_CONFIG = {
  [VIEWER_TYPES.PDF]: {
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    canEdit: false,
    renderIn: 'sidebar', // 'sidebar' or 'modal'
  },

  [VIEWER_TYPES.IMAGE]: {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'],
    mimeTypes: ['image/*'],
    canEdit: false,
    renderIn: 'modal', // Images use modal overlay for better viewing
  },

  [VIEWER_TYPES.CODE]: {
    // Default viewer for text-based files
    extensions: [
      // JavaScript/TypeScript
      'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts',
      // Web
      'html', 'htm', 'css', 'scss', 'sass', 'less',
      // Python
      'py', 'pyw', 'pyi',
      // Other languages
      'go', 'rs', 'php', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
      'swift', 'lua', 'r', 'rb', 'erb',
      // Data/Config
      'json', 'jsonc', 'json5', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'sql',
      'toml', 'ini', 'cfg', 'conf',
      // Documents
      'md', 'mdx', 'txt', 'rst', 'tex',
      // Shell
      'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
      // Other
      'graphql', 'gql', 'proto', 'vue', 'svelte',
    ],
    canEdit: true,
    renderIn: 'sidebar',
  },
};

/**
 * Get file extension from filename
 */
export const getFileExtension = (filename) => {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

/**
 * Determine which viewer type should handle a given file
 * @param {string} filename - Name of the file
 * @returns {string} - Viewer type from VIEWER_TYPES
 */
export const getViewerType = (filename) => {
  const ext = getFileExtension(filename);

  // Check each viewer config
  for (const [viewerType, config] of Object.entries(VIEWER_CONFIG)) {
    if (config.extensions.includes(ext)) {
      return viewerType;
    }
  }

  // Default to code editor for unknown types
  return VIEWER_TYPES.CODE;
};

/**
 * Check if a file should render in sidebar vs modal
 * @param {string} filename - Name of the file
 * @returns {string} - 'sidebar' or 'modal'
 */
export const getRenderLocation = (filename) => {
  const viewerType = getViewerType(filename);
  const config = VIEWER_CONFIG[viewerType];
  return config?.renderIn || 'sidebar';
};

/**
 * Check if a file can be edited
 * @param {string} filename - Name of the file
 * @returns {boolean}
 */
export const isEditable = (filename) => {
  const viewerType = getViewerType(filename);
  const config = VIEWER_CONFIG[viewerType];
  return config?.canEdit || false;
};
