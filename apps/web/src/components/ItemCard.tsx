import { memo } from 'react';
import { useNavigate } from 'react-router';
import { DEFECT_CONDITIONS, roomDisplayName, type Condition, type DescriptionPhrase, type FormDefinition, type ItemRecord } from '@soc/shared';
import type { LocalPhoto } from '../lib/db';
import { saveEdit } from '../lib/mutations';
import type { Abbreviation } from '../lib/reference';
import { syncEngine } from '../lib/sync';
import { AutoField, Corners, QtyStepper } from './fields';
import { GradeControl } from './GradeControl';
import { PhotoThumbs } from './PhotoThumbs';
import { Icon } from './ui';

export interface ItemCardProps {
  item: ItemRecord;
  form: FormDefinition;
  roomLabel: string;
  phrases: DescriptionPhrase[];
  abbreviations: Abbreviation[];
  photos: LocalPhoto[];
  editableLabel?: boolean;
  highlighted?: boolean;
  readOnly?: boolean;
}

const save = (id: string, changes: Partial<ItemRecord>) =>
  saveEdit('item_record', id, changes).then(() => syncEngine.notifyChange());
const orNull = (s: string) => (s.trim() ? s : null);

function ItemCardImpl({ item, form, roomLabel, phrases, abbreviations, photos, editableLabel, highlighted, readOnly }: ItemCardProps) {
  const nav = useNavigate();
  const isDefect = item.condition !== null && DEFECT_CONDITIONS.includes(item.condition);
  const live = photos.filter((p) => !p.deletedAt);
  const name = `${roomLabel}, ${item.label}`;
  const headingId = `item-${item.id}-name`;

  const takePhoto = () =>
    nav(`/visits/${item.visitId}/photo?kind=item&item=${item.id}${item.roomInstanceId ? `&room=${item.roomInstanceId}` : ''}`, {
      state: { returnTo: `${location.pathname}#item-${item.id}` },
    });

  const appendDescription = (text: string, replace: boolean) => {
    const cur = item.description?.trim() ?? '';
    const next = replace || !cur ? text : `${cur} ${text}`;
    void save(item.id, { description: next });
  };

  return (
    <article id={`item-${item.id}`} className={`card item${item.condition ? ` item--${item.condition}` : ''}${highlighted ? ' item--target' : ''}`} aria-labelledby={headingId}>
      <Corners />
      <div className="item__head">
        {editableLabel ? (
          <div style={{ flex: 1 }}>
            <AutoField label="Item name" value={item.label} onSave={(v) => { if (v.trim()) void save(item.id, { label: v.trim() }); }} disabled={readOnly} id={headingId} />
          </div>
        ) : (
          <h3 className="item__name" id={headingId}>{roomDisplayName(item.label)}</h3>
        )}
        <QtyStepper value={item.qty} itemLabel={item.label} disabled={readOnly} onChange={(qty) => void save(item.id, { qty })} />
      </div>

      <GradeControl
        itemLabel={name} value={item.condition} options={form.conditionOptions} disabled={readOnly}
        onChange={(condition: Condition) => void save(item.id, { condition })}
      />

      <AutoField label={`Description of ${item.label}`} hideLabel placeholder="Description" soft value={item.description}
        onSave={(v) => void save(item.id, { description: orNull(v) })} disabled={readOnly} />
      {!readOnly && (phrases.length > 0 || abbreviations.length > 0) && (
        <div className="chips" aria-label={`Description shortcuts for ${item.label}`} role="group">
          {phrases.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => appendDescription(p.phrase, true)}>{p.phrase}</button>
          ))}
          {abbreviations.length > 0 && (
            <details style={{ width: '100%' }}>
              <summary className="small" style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--teal)', fontWeight: 550 }}>
                Shorthand (template key)
              </summary>
              <div className="chips">
                {abbreviations.map((a) => (
                  <button key={a.code} type="button" className="chip chip--abbr" title={a.meaning} aria-label={`Add ${a.code}, ${a.meaning}`}
                    onClick={() => appendDescription(a.code, false)}>{a.code}</button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {item.condition === 'NA' && (
        <div className="item__defect">
          <AutoField label="Reason for N/A (required)" placeholder="e.g. not present, locked, no access" value={item.naReason}
            onSave={(v) => void save(item.id, { naReason: orNull(v) })} disabled={readOnly} />
        </div>
      )}

      {isDefect && (
        <div className="item__defect">
          <AutoField label="Comment — what's wrong, and where (required)" multiline soft value={item.comment}
            onSave={(v) => void save(item.id, { comment: orNull(v) })} disabled={readOnly} />
          <AutoField label="Schedule of dilapidation — what should be done" multiline soft value={item.dilapidation}
            onSave={(v) => void save(item.id, { dilapidation: orNull(v) })} disabled={readOnly} />
        </div>
      )}

      {!readOnly && (
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
          <button type="button" className={`btn btn--sm${isDefect && live.length === 0 ? ' photo-btn--required' : ''}`} onClick={takePhoto}>
            <Icon name="camera" size={18} />
            {live.length ? `${live.length} photo${live.length > 1 ? 's' : ''} · add` : isDefect ? 'Photo required' : 'Photo'}
          </button>
          {isDefect && live.length === 0 && <span className="small muted">Blocks the report until taken</span>}
        </div>
      )}
      <PhotoThumbs photos={live} label={item.label} canDelete={!readOnly} />
    </article>
  );
}

export const ItemCard = memo(ItemCardImpl);
