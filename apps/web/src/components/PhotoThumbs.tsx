import type { LocalPhoto } from '../lib/db';
import { useBlobUrl } from '../lib/hooks';
import { deletePhoto } from '../lib/photo';
import { Icon } from './ui';

function Thumb({ photo, label, canDelete }: { photo: LocalPhoto; label: string; canDelete: boolean }) {
  const url = useBlobUrl(photo.blob);
  const when = new Date(photo.capturedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="thumb">
      {url ? <img src={url} alt={`${label} photo taken ${when}`} /> : <div className="stripe" style={{ width: '100%', height: '100%' }} role="img" aria-label={`${label} photo (stored on server)`} />}
      {canDelete && (
        <button
          type="button" aria-label={`Delete ${label} photo taken ${when}`}
          onClick={() => { if (confirm('Delete this photo?')) void deletePhoto(photo.id); }}
        ><Icon name="trash" size={16} /></button>
      )}
    </div>
  );
}

export function PhotoThumbs({ photos, label, canDelete = true }: { photos: LocalPhoto[]; label: string; canDelete?: boolean }) {
  const live = photos.filter((p) => !p.deletedAt);
  if (!live.length) return null;
  return (
    <div className="thumbs">
      {live.map((p) => <Thumb key={p.id} photo={p} label={label} canDelete={canDelete} />)}
    </div>
  );
}
