import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client';

export default function ImageGallery({ entityType, entityId, editable = false }) {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  const loadImages = async () => {
    try {
      const data = await api.get(`/images/${entityType}/${entityId}`);
      setImages(data || []);
    } catch (err) {
      console.error('Failed to load images:', err);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);
    formData.append('is_primary', images.length === 0 ? 'true' : 'false');

    setUploading(true);
    try {
      await api.uploadImage(formData);
      toast.success('Image uploaded');
      loadImages();
    } catch (err) {
      toast.error(err.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleSetPrimary = async (imageId) => {
    try {
      await api.setPrimaryImage(imageId);
      toast.success('Primary image updated');
      loadImages();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (imageId) => {
    if (!confirm('Delete this image?')) return;
    try {
      await api.deleteImage(imageId);
      toast.success('Image deleted');
      loadImages();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Load images on mount
  useState(() => {
    loadImages();
  });

  const primaryImage = images.find(img => img.is_primary) || images[0];

  return (
    <div className="space-y-4">
      {/* Main Image */}
      {primaryImage && (
        <div className="card overflow-hidden">
          <img
            src={primaryImage.url}
            alt={primaryImage.alt_text || 'Primary image'}
            className="w-full h-64 object-cover"
            onClick={() => setSelectedImage(primaryImage)}
          />
        </div>
      )}

      {/* Thumbnail Gallery */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {images.map((img) => (
            <div
              key={img.id}
              className={`relative shrink-0 w-20 h-20 rounded-lg overflow-hidden cursor-pointer border-2 ${
                img.is_primary ? 'border-primary-500' : 'border-transparent'
              }`}
              onClick={() => setSelectedImage(img)}
            >
              <img src={img.url} alt={img.alt_text} className="w-full h-full object-cover" />
              {img.is_primary && (
                <div className="absolute top-1 right-1 w-4 h-4 bg-primary-500 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload Button */}
      {editable && (
        <div>
          <input
            type="file"
            id="image-upload"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
          <label
            htmlFor="image-upload"
            className="btn btn-secondary btn-sm cursor-pointer"
          >
            {uploading ? 'Uploading...' : 'Upload Image'}
          </label>
        </div>
      )}

      {/* Image Actions (Admin) */}
      {editable && images.length > 0 && (
        <div className="space-y-2">
          {images.map((img) => (
            <div key={img.id} className="flex items-center gap-2 p-2 bg-[var(--color-surface-hover)] rounded-lg">
              <img src={img.url} alt={img.alt_text} className="w-12 h-12 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{img.alt_text || 'No description'}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {img.is_primary ? 'Primary' : 'Secondary'}
                </p>
              </div>
              <div className="flex gap-1">
                {!img.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(img.id)}
                    className="btn btn-ghost btn-icon text-xs"
                    title="Set as primary"
                  >
                    Set Primary
                  </button>
                )}
                <button
                  onClick={() => handleDelete(img.id)}
                  className="btn btn-ghost btn-icon text-red-500"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage.url}
            alt={selectedImage.alt_text}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white btn btn-ghost btn-icon"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
