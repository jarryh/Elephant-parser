import type { Scene } from '../../shared/scenes';
import { RP_TYPES, type Filters } from '../../shared/filter';
import { clock, dayTitle } from '../time';

const LIMIT = 100;

interface Props {
  scenes: Scene[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  open: boolean;
}

/**
 * Choosing a scene sets the character, the period and the roleplay types, which together
 * select exactly its lines. So everything else works on it as it is.
 */
export function SceneList({ scenes, filters, onChange, open }: Props) {
  const { owners, from, to } = filters;
  const chosen = (scene: Scene) =>
    owners.length === 1 && owners[0] === scene.owner && from === scene.from && to === scene.to;

  const newest = [...scenes].reverse();
  const visible = newest.filter((scene, index) => index < LIMIT || chosen(scene));
  const severalOwners = scenes.some((scene) => scene.owner !== scenes[0]!.owner);

  return (
    <details className="group" open={open}>
      <summary>
        <span>Scenes</span>
        <span className="summary-note">{scenes.length}</span>
      </summary>
      <ul className="scenes">
        {visible.map((scene) => {
          const selected = chosen(scene);
          const people = scene.participants;
          return (
            <li key={scene.id}>
              <button
                className="scene-choice"
                aria-pressed={selected}
                title={[scene.place, people.map((person) => `${person.name}: ${person.lines}`).join('\n')]
                  .filter(Boolean)
                  .join('\n')}
                onClick={() =>
                  onChange(
                    selected
                      ? { owners: [], from: null, to: null, types: [] }
                      : { owners: [scene.owner], from: scene.from, to: scene.to, types: RP_TYPES },
                  )
                }
              >
                <strong>{scene.name || scene.place || people.map((person) => person.name).join(', ')}</strong>
                <span>
                  {dayTitle(clock.day(scene.from))}, {clock.time(scene.from)}–{clock.time(scene.to)} · {scene.lines}{' '}
                  {scene.lines === 1 ? 'line' : 'lines'}
                  {severalOwners && ` · ${scene.owner.split(' ')[0]}`}
                </span>
                {selected ? (
                  <span className="participants">
                    {people.map((person) => `${person.name} ${person.lines}`).join(' · ')}
                  </span>
                ) : (
                  (scene.name || scene.place) && <span>{people.map((person) => person.name).join(', ')}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {scenes.length === 0 && <p className="hint">No roleplay lines yet.</p>}
      {newest.length > visible.length && (
        <p className="hint">{newest.length - visible.length} older scenes. Use Period to reach them.</p>
      )}
    </details>
  );
}
