import React from 'react';
import { X, Download, FileText, ExternalLink } from 'lucide-react';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string | null;
  isLoading?: boolean;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  fileName,
  fileUrl,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  const handleDownload = () => {
    if (fileUrl) {
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleOpenInNewTab = () => {
    if (fileUrl) {
      window.open(fileUrl, '_blank');
    }
  };

  const isExcelFile = fileName.toLowerCase().match(/\.(xlsx|xls)$/);
  const isPdfFile = fileName.toLowerCase().endsWith('.pdf');
  const isImageFile = fileName.toLowerCase().match(/\.(png|jpg|jpeg|gif|webp)$/);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <FileText className="text-indigo-600" size={24} />
            <div>
              <h2 className="text-lg font-bold text-slate-800">{fileName}</h2>
              <p className="text-sm text-slate-500">File Preview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fileUrl && (
              <>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Download file"
                >
                  <Download size={16} />
                  Download
                </button>
                <button
                  onClick={handleOpenInNewTab}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink size={16} />
                  Open
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                <p className="text-slate-500">Loading file...</p>
              </div>
            </div>
          ) : !fileUrl ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <FileText className="text-slate-300 mx-auto mb-4" size={48} />
                <p className="text-slate-500">File URL not available</p>
              </div>
            </div>
          ) : isImageFile ? (
            <div className="flex items-center justify-center">
              <img
                src={fileUrl}
                alt={fileName}
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>
          ) : isPdfFile ? (
            <iframe
              src={fileUrl}
              className="w-full h-[60vh] border border-slate-200 rounded-lg"
              title={fileName}
            />
          ) : isExcelFile ? (
            <div className="text-center py-12">
              <FileText className="text-indigo-300 mx-auto mb-4" size={64} />
              <p className="text-lg font-medium text-slate-700 mb-2">Excel File</p>
              <p className="text-slate-500 mb-6">
                Excel files cannot be previewed in the browser. Please download to view.
              </p>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Download size={18} />
                Download File
              </button>
            </div>
          ) : (
            <div className="text-center py-12">
              <FileText className="text-slate-300 mx-auto mb-4" size={64} />
              <p className="text-lg font-medium text-slate-700 mb-2">File Preview Not Available</p>
              <p className="text-slate-500 mb-6">
                This file type cannot be previewed in the browser. Please download to view.
              </p>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Download size={18} />
                Download File
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
