import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoryResult } from '../../shared/api';
import {
  buildPrompt,
  buildTranscript,
  costOf,
  DEFAULT_OPTIONS,
  estimateCost,
  isPrivate,
  LENGTHS,
  POINTS_OF_VIEW,
  roughTokens,
  storyItems,
  type StoryOptions,
} from '../../shared/story';
import type { LogDocument, LogItem } from '../../shared/types';
import { download } from '../download';
import { countStoryTokens, generateStory } from '../storyApi';
import { clock } from '../time';
import { Modal } from './Modal';

const LANGUAGES = ['English', 'Czech', 'Slovak', 'German', 'French', 'Spanish', 'Polish'];
const TONES = ['Faithful to the log', 'Epic fantasy', 'Dark and gritty', 'Light-hearted', 'Romantic', 'Tavern tale'];
const TOKEN_LIMIT = 900_000;

const dollars = (value: number) => (value < 0.01 ? 'under $0.01' : `$${value.toFixed(2)}`);

interface Props {
  model: string;
  doc: LogDocument;
  messages: LogItem[];
  onClose: () => void;
}

export function StoryDialog({ model, doc, messages, onClose }: Props) {
  const [options, setOptions] = useState<StoryOptions>(DEFAULT_OPTIONS);
  const [whispers, setWhispers] = useState(false);
  const [notices, setNotices] = useState(false);
  const [exact, setExact] = useState<{ prompt: string; tokens: number } | null>(null);
  const [counting, setCounting] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<StoryResult | null>(null);
  const [error, setError] = useState('');
  const running = useRef<AbortController | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const items = useMemo(() => storyItems(messages, { whispers, notices }), [messages, whispers, notices]);
  const transcript = useMemo(() => buildTranscript(items, clock, doc), [items, doc]);
  const prompt = useMemo(() => {
    const { system, user } = buildPrompt(transcript, options);
    return `${system}\n\n${user}`;
  }, [transcript, options]);

  const characters = useMemo(() => {
    const names = items.flatMap((item) =>
      item.sender && !/^(?:MONSTER_|BN_|RAID_BOSS_)/.test(item.type) ? [item.rpName ?? item.sender] : [],
    );
    const ownNames = new Map(items.flatMap((item) => (item.self && item.rpName ? [[item.owner, item.rpName]] : [])));
    return [...new Set([...items.map((item) => ownNames.get(item.owner) ?? item.owner), ...names])];
  }, [items]);

  const privateCount = useMemo(() => messages.filter(isPrivate).length, [messages]);
  const publicCount = useMemo(() => items.filter((item) => item.type === 'CHANNEL').length, [items]);

  const isExact = exact?.prompt === prompt;
  const tokens = isExact ? exact.tokens : roughTokens(prompt);
  const cost = estimateCost(model, tokens, options.length);
  const tooLong = tokens > TOKEN_LIMIT;
  const busy = writing || counting;
  const set = (patch: Partial<StoryOptions>) => setOptions((current) => ({ ...current, ...patch }));

  const start = () => {
    const controller = new AbortController();
    running.current = controller;
    setError('');
    return controller.signal;
  };
  const report = (cause: unknown, signal: AbortSignal) => {
    if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
  };

  const count = async () => {
    const signal = start();
    setCounting(true);
    try {
      setExact({ prompt, tokens: await countStoryTokens({ transcript, options }, signal) });
    } catch (cause) {
      report(cause, signal);
    }
    setCounting(false);
  };

  const write = async () => {
    const signal = start();
    setWriting(true);
    setText('');
    setResult(null);
    try {
      const done = await generateStory({ transcript, options }, (part) => setText((all) => all + part), signal);
      setText(done.text);
      setResult(done);
    } catch (cause) {
      report(cause, signal);
    }
    setWriting(false);
  };

  const close = () => {
    if (writing && !window.confirm('The story is still being written. Stop it and close?')) return;
    onClose();
  };

  // After a fallback two models were billed, so a single price would be wrong.
  const spent = result && !result.fellBack ? costOf(result.model, result.inputTokens, result.outputTokens) : null;

  return (
    <Modal title="Turn the selection into a story" onClose={close}>
      <fieldset className="story-options" disabled={busy}>
        <label className="field">
          Language
          <input
            list="story-languages"
            maxLength={60}
            value={options.language}
            onChange={(event) => set({ language: event.target.value })}
          />
        </label>
        <label className="field">
          Tone
          <input
            list="story-tones"
            maxLength={120}
            value={options.tone}
            onChange={(event) => set({ tone: event.target.value })}
          />
        </label>
        <label className="field">
          Told in
          <select value={options.pov} onChange={(event) => set({ pov: event.target.value as StoryOptions['pov'] })}>
            {Object.entries(POINTS_OF_VIEW).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Following
          <select
            value={options.character}
            disabled={options.pov === 'omniscient'}
            onChange={(event) => set({ character: event.target.value })}
          >
            <option value="">Whoever recorded the log</option>
            {options.character && !characters.includes(options.character) && <option>{options.character}</option>}
            {characters.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Length
          <select
            value={options.length}
            onChange={(event) => set({ length: event.target.value as StoryOptions['length'] })}
          >
            {Object.entries(LENGTHS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Notes
          <input
            maxLength={4000}
            placeholder="Optional: focus, backstory, things to skip…"
            value={options.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </label>
        <datalist id="story-languages">
          {LANGUAGES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="story-tones">
          {TONES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className="choices">
          <label>
            <input type="checkbox" checked={whispers} onChange={(event) => setWhispers(event.target.checked)} />
            Include whispers ({privateCount})
          </label>
          <label>
            <input type="checkbox" checked={notices} onChange={(event) => setNotices(event.target.checked)} />
            Include system, loot and skill lines
          </label>
        </div>
      </fieldset>

      <div className="cost" aria-live="polite">
        <p>
          <strong>{items.length}</strong> of {messages.length} selected messages will be sent to Anthropic (
          <code>{model}</code>).
        </p>
        <p>
          {isExact ? '' : 'About '}
          {tokens.toLocaleString()} input tokens{isExact ? ' (exact)' : ' (rough, counted locally)'}.{' '}
          {cost
            ? `Typically ${dollars(cost.typical)}, at most about ${dollars(cost.most)}.`
            : 'The price of this model is not known to the app.'}
        </p>
        {publicCount > 0 && (
          <p className="hint">
            {publicCount} lines are from public channels. "Roleplay types only" in the filters leaves them out.
          </p>
        )}
        {tooLong && <p className="error">The selection is too long. Choose a shorter period or fewer channels.</p>}
      </div>

      <details className="sent">
        <summary>See exactly what will be sent</summary>
        <pre className="preview">{prompt}</pre>
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(writing || text) && <div className="story-text">{text || 'Claude is thinking…'}</div>}
      {result && (
        <p className="hint">
          {result.savedTo ? `Saved to ${result.savedTo}.` : 'Could not save the file. Use Download.'}{' '}
          {result.inputTokens.toLocaleString()} tokens in, {result.outputTokens.toLocaleString()} out
          {spent === null ? '' : `, ${dollars(spent)}`}.
          {result.truncated && ' The story was cut off at the length limit.'}
          {result.fellBack && ` A safety check declined this scene, so ${result.model} took over.`}
        </p>
      )}

      <div className="modal-actions">
        <button
          onClick={count}
          disabled={busy || !items.length}
          title="Sends the text to Anthropic's free token counter. It does not write a story."
        >
          {counting ? 'Counting…' : 'Count exactly'}
        </button>
        <span className="hint" />
        {text && !writing && (
          <>
            <button onClick={() => navigator.clipboard.writeText(text).catch(() => setError('Could not copy.'))}>
              Copy
            </button>
            <button onClick={() => download('story.md', text, 'text/markdown')}>Download .md</button>
          </>
        )}
        {writing ? (
          <button onClick={() => running.current?.abort()}>Stop</button>
        ) : (
          <button className="primary" onClick={write} disabled={counting || !items.length || tooLong}>
            {text ? 'Write again' : 'Write story'}
          </button>
        )}
      </div>
    </Modal>
  );
}
