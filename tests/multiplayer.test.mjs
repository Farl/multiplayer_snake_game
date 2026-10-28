import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the real game class without browser startup; only its network and DOM
// boundaries are replaced so lifecycle events can be delivered deterministically.
const source = (await readFile(new URL('../main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');
async function createGame() {
  const sent = [];
  class Socket {
    clientId = 'alice';
    peers = { alice: { username: 'Alice' } };
    async initialize() {}
    send(message) { sent.push(message); }
  }
  const Game = vm.runInNewContext(`${source}\nSnakeGame;`, {
    WebsimSocket: Socket, PARTYKIT_HOST: 'example.test',
    location: { pathname: '/', search: '' }, URLSearchParams,
    window: {}, document: { createElement: () => ({ innerHTML: '' }) },
    console, setTimeout: callback => callback(),
  });
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    playerIdDisplay: { textContent: '' },
    leaderboardBody: { innerHTML: '', appendChild() {} },
    snake: [{ x: 15, y: 15 }], score: 0, speed: 1,
  });
  await game.initMultiplayer();
  sent.length = 0;
  return { game, sent };
}

test('a late join receives the existing player state', async () => {
  const { game, sent } = await createGame();
  game.room.onmessage({ data: { type: 'connected', clientId: 'bob', username: 'Bob' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'player-join');
  assert.equal(sent[0].player.id, 'alice');
  assert.equal(sent[0].player.snake[0].x, 15);
});

test('a departed peer is removed even though lifecycle events have no player payload', async () => {
  const { game } = await createGame();
  game.room.onmessage({ data: { type: 'player-join', player: { id: 'bob', username: 'Bob', score: 0 } } });
  assert.ok(game.players.bob);
  game.room.onmessage({ data: { type: 'disconnected', clientId: 'bob', username: 'Bob' } });
  assert.equal(game.players.bob, undefined);
  assert.ok(game.players.alice);
});
