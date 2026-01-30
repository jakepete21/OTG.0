import React, { useState, useEffect } from 'react';
import { getFileUrl } from '../services/firebaseQueries';
import FilePreviewModal from './FilePreviewModal';

interface FilePreviewModalWrapperProps {
  fileName: string;
  storageId: string; // Can be a Firebase Storage path or URL
  onClose: () => void;
}

const FilePreviewModalWrapper: React.FC<FilePreviewModalWrapperProps> = ({
  fileName,
  storageId,
  onClose,
}) => {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchFileUrl() {
      try {
        // If it's already a URL, use it directly
        if (storageId.startsWith('http://') || storageId.startsWith('https://')) {
          setFileUrl(storageId);
          setIsLoading(false);
          return;
        }
        // Otherwise, get download URL from Firebase Storage
        const url = await getFileUrl(storageId);
        setFileUrl(url);
      } catch (error) {
        console.error('Failed to get file URL:', error);
        setFileUrl(null);
      } finally {
        setIsLoading(false);
      }
    }
    fetchFileUrl();
  }, [storageId]);

  return (
    <FilePreviewModal
      isOpen={true}
      onClose={onClose}
      fileName={fileName}
      fileUrl={fileUrl}
      isLoading={isLoading}
    />
  );
};

export default FilePreviewModalWrapper;
