'use strict';
// The architecture model an LLM fills from documents and diagrams. Every object closes its properties and lists
// all of them as required (strict structured outputs on both the Claude API and Codex); nothing is recursive.
// Blocks hold parts, parts hold pieces: three levels, the same as the repo map.

const KINDS = ['ui', 'endpoint', 'gate', 'process', 'agent', 'model', 'queue', 'store', 'external', 'config'];

const str = description => ({ type: 'string', description });
const obj = (properties, description) => ({ type: 'object', description, properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, description) => ({ type: 'array', description, items });
const kind = { type: 'string', enum: KINDS, description: 'ui: a screen or surface people use · endpoint: where requests enter (API, webhook, CLI) · gate: a check or decision (auth, policy, router) · process: work done in code · agent: an LLM agent · model: an ML or LLM model called · queue: a queue, bus or event stream · store: data kept (database, cache, files, memory) · external: an outside service · config: settings, prompts, catalogs' };
const link = obj({ from: str('id of the source'), to: str('id of the target'), label: str('what passes, in a few words') });

const ARCH_SCHEMA = obj({
  title: str('The system\'s name, as the sources call it.'),
  intro: str('Two or three plain sentences: what the system does and how it is split. Shown first on the page.'),
  layers: arr(obj({
    id: str('kebab-case id'),
    name: str('Area name, two or three words'),
    blurb: str('One line on what this area holds'),
    tip: str('One or two sentences, at most 170 characters'),
  }), 'The big areas of the system, in reading order (for example: what users see, orchestration, services, data). Two to seven.'),
  modules: arr(obj({
    id: str('kebab-case id, unique'),
    layer: str('id of its layer'),
    name: str('Block name as the sources say it'),
    short: str('One or two words for small labels'),
    role: str('One line: what the block is for'),
    tip: str('One or two sentences, at most 170 characters'),
    zones: arr(obj({
      name: str('Column name, a step in the flow (for example: Receive, Decide, Act, Keep)'),
      tip: str('One sentence'),
      parts: arr(str('a part id of this block'), 'Part ids in this column, top to bottom'),
    }), 'Columns inside the block, left to right in the order a request or event flows through it. Every part sits in exactly one column.'),
    parts: arr(obj({
      id: str('kebab-case id, unique inside the block'),
      name: str('Part name'),
      kind,
      what: str('One line: what it does'),
      tip: str('One or two sentences, at most 170 characters'),
      children: arr(obj({
        id: str('kebab-case id, unique inside the part'),
        name: str('Piece name'),
        kind,
        what: str('One line'),
        tip: str('One or two sentences, at most 170 characters'),
      }), 'Named pieces inside the part (tools, tables, endpoints, prompts, steps) when the sources list them; empty otherwise.'),
      links: arr(link, 'Connections between the pieces of this part, only when the sources state them.'),
    }), 'Three to nine parts.'),
    links: arr(link, 'Connections between parts of this block (part ids), only when the sources state them.'),
  }), 'The blocks: services, apps, agents, subsystems.'),
  flows: arr(obj({
    from: str('block id'), to: str('block id'),
    label: str('What passes, in a few words'),
    kind: str('One word or two: calls, reads, writes, streams, publishes, subscribes, renders'),
  }), 'Connections between blocks, only when the sources state or draw them.'),
  bus: obj({
    name: str('Name of the shared bus, dock, database or event backbone that many blocks plug into; empty string when there is none'),
    tip: str('One or two sentences'),
    ports: arr(obj({
      n: { type: 'integer', description: 'Port number, from 1' },
      name: str('What crosses at this port: a topic, a table group, a socket'),
      tip: str('One sentence'),
      modules: arr(str('block id'), 'Blocks plugged into this port'),
    }), 'Numbered ports on the bus. Empty when there is no bus.'),
  }, 'A shared backbone drawn as a rail across the plate. Leave name empty and ports empty when the sources have none.'),
  journeys: arr(obj({
    name: str('Walkthrough name, a user or system action'),
    group: str('A short heading that groups walkthroughs'),
    caption: str('One sentence'),
    steps: arr(obj({
      at: str('block id, or P<n> for a bus port (for example P3)'),
      part: str('part id inside that block, or empty string'),
      note: str('What happens at this step, one sentence'),
    }), 'Steps in order, at least two.'),
  }), 'Two to six walkthroughs that follow one request or event across blocks, only along paths the sources describe.'),
  unclear: arr(str('One question or gap'), 'What the sources leave open or contradict. Empty when nothing is unclear.'),
}, 'An architecture model: areas, blocks, parts, pieces, connections, an optional bus and walkthroughs.');

module.exports = { ARCH_SCHEMA, KINDS };
