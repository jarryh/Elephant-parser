import { useMemo, useState } from 'react';
import { exportJson, exportLua, exportMarkdown, exportText } from '../../shared/export';
import type { EntryState } from '../../shared/selection';
import type { LogDocument, LogItem } from '../../shared/types';
import { download } from '../download';
import { clock } from '../time';
import { Modal } from './Modal';

const FORMATS = [
  { id: 'txt', label: 'Plain text', mime: 'text/plain' },
  { id: 'md', label: 'Markdown', mime: 'text/markdown' },
  { id: 'json', label: 'JSON', mime: 'application/json' },
  { id: 'lua', label: 'Elephant Lua', mime: 'text/plain' },
] as const;

type Format = (typeof FORMATS)[number];

const PREVIEW_LENGTH = 20_000;

interface Props {
  fileName: string;
  doc: LogDocument;
  messages: LogItem[];
  states: EntryState[];
  labels: Map<string, string>;
  onClose: () => void;
}

export function ExportDialog({ fileName, doc, messages, states, labels, onClose }: Props) {
  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [copied, setCopied] = useState('');

  const content = useMemo(() => {
    if (format.id === 'txt') return exportText(messages, clock);
    if (format.id === 'md') return exportMarkdown(messages, clock);
    if (format.id === 'json') return exportJson(messages, labels);
    return exportLua(doc, states);
  }, [format, doc, messages, states, labels]);

  const base = fileName.replace(/\.lua$/i, '');
  const first = messages[0];
  const last = messages.at(-1);
  let name = `${base}.cleaned.lua`;
  if (format.id !== 'lua') {
    const from = first ? `_${clock.day(first.at)}` : '';
    const to = first && last && clock.day(first.at) !== clock.day(last.at) ? `_to_${clock.day(last.at)}` : '';
    name = `${base}${from}${to}.${format.id}`;
  }

  return (
    <Modal title={`Export ${messages.length} selected messages`} onClose={onClose}>
      <div className="choices">
        {FORMATS.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="format"
              checked={option === format}
              onChange={() => {
                setFormat(option);
                setCopied('');
              }}
            />
            {option.label}
          </label>
        ))}
      </div>

      {format.id === 'lua' ? (
        <p className="hint">
          A valid Elephant file with only the selected messages. Settings and "Logging started" markers stay. To use it
          in game, quit WoW, back up your original in SavedVariables and save this as Elephant.lua.
        </p>
      ) : (
        <p className="hint">Only what matches your filters and isn't removed. Times are in your local timezone.</p>
      )}

      <pre className="preview" tabIndex={0}>
        {content.slice(0, PREVIEW_LENGTH)}
        {content.length > PREVIEW_LENGTH && '\n… (the preview is cut short, the export is complete)'}
      </pre>

      <div className="modal-actions">
        <span className="hint">{copied || name}</span>
        <button
          onClick={() =>
            navigator.clipboard.writeText(content).then(
              () => setCopied('Copied.'),
              () => setCopied('Could not copy. Use Download.'),
            )
          }
        >
          Copy
        </button>
        <button className="primary" onClick={() => download(name, content, format.mime)}>
          Download
        </button>
      </div>
    </Modal>
  );
}
