import { WebsimSocket } from 'websim-socket';
import { PARTYKIT_HOST } from './env.js';

const GRID_SIZE = 30;
const CELL_SIZE = 20;
const INITIAL_SPEED = 1;
const MAX_SPEED = 5;
const MIN_SPEED = 1;
const DEFAULT_ROOM =
  location.pathname.replace(/\/+$/,'').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') ||
  'multiplayer-snake-game';

function getRoomName() {
  const room = new URLSearchParams(location.search).get('room')?.trim();
  return room || DEFAULT_ROOM;
}

class SnakeGame {
  constructor(multiplayer = true) {
    this.canvas = document.getElementById('game-board');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = GRID_SIZE * CELL_SIZE;
    this.canvas.height = GRID_SIZE * CELL_SIZE;
    
    this.speedDisplay = document.getElementById('speed');
    this.scoreDisplay = document.getElementById('score');
    this.playerIdDisplay = document.getElementById('player-id');
    this.playerIdDisplay.textContent = '';
    this.gameOverDisplay = document.getElementById('game-over');
    this.leaderboardBody = document.getElementById('leaderboard-body');
    
    this.multiplayer = multiplayer;
    this.room = null;
    this.clientId = null;
    this.username = 'Player'
    this.players = {};
    
    this.reset();
    this.setupEventListeners();
    
    if (this.multiplayer) {
      this.initMultiplayer();
    }
  }

  async initMultiplayer() {
    try {
      this.room = new WebsimSocket({
        host: PARTYKIT_HOST,
        room: getRoomName()
      });
      await this.room.initialize();
      
      this.clientId = this.room.clientId;
      this.username = this.room.peers[this.clientId]?.username || 'Player';
      this.playerIdDisplay.textContent = this.username;

      // Clear existing players before initializing
      this.players = {};

      // Initialize player
      this.players[this.clientId] = {
        username: this.username,
        snake: this.snake,
        score: this.score,
        speed: this.speed,
        color: this.getRandomColor()
      };

      // Initial leaderboard sync
      this.updateLeaderboard();

      // Send initial player state
      this.broadcastPlayerState('player-join');

      // Handle incoming messages
      this.room.onmessage = (event) => {
        const data = event.data;
        
        if (!data?.type) return;

        // Peer lifecycle events contain clientId, but no player payload.
        // Send our state to late joiners and remove peers when they leave.
        if (data.type === 'connected') {
          setTimeout(() => this.broadcastPlayerState('player-join'), 300);
          return;
        }
        if (data.type === 'disconnected') {
          delete this.players[data.clientId];
          this.updateLeaderboard();
          return;
        }
        if (!data.player) return;
        
        // Always update player data when received
        if (data.player.id && data.player.id !== this.clientId) {
          this.players[data.player.id] = {
            ...this.players[data.player.id],
            ...data.player
          };
        }
        
        switch (data.type) {
          case 'player-join':
            this.updateLeaderboard();
            break;
          case 'player-move':
            // Already updated player data above
            break;
          case 'food-eat':
            if (data.player.id !== this.clientId) {
              this.food = this.generateFood();
            }
            this.updateLeaderboard();
            break;
          case 'player-die':
          case 'player-collision':
            this.updateLeaderboard();
            break;

        }
      };

    } catch (error) {
      console.error('Multiplayer initialization error:', error);
    }
  }

  broadcastPlayerState(type) {
    if (!this.room || !this.clientId) return;
    
    this.room.send({
      type: type,
      player: {
        id: this.clientId,
        username: this.username,
        snake: this.snake,
        score: this.score,
        speed: this.speed,
        color: this.players[this.clientId]?.color || this.getRandomColor()
      }
    });
  }

  getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 80%, 60%)`;
  }

  updateLeaderboard() {
    this.leaderboardBody.innerHTML = '';
    Object.entries(this.players)
      .sort((a, b) => b[1].score - a[1].score)
      .forEach(([id, player]) => {

          const row = document.createElement('tr');
          row.innerHTML = `
            <td style="color: ${player.color}">${player.username}</td>
            <td>${player.score}</td>
          `;
          this.leaderboardBody.appendChild(row);

      });
  }

  reset() {
    this.snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    this.direction = {x: 1, y: 0};
    this.nextDirection = {x: 1, y: 0};
    this.food = this.generateFood();
    this.speed = INITIAL_SPEED;
    this.score = 0;
    this.gameStarted = false;
    this.gameOver = false;
    this.lastUpdate = 0;
    this.invincibleUntil = Date.now() + 3000; // 3 seconds of invincibility
    
    this.updateStats();
    this.gameOverDisplay.style.display = 'none';

    // Clear players in multiplayer mode
    if (this.multiplayer) {
      this.players = {};
      this.players[this.clientId] = {
        username: this.username,
        snake: this.snake,
        score: this.score,
        speed: this.speed,
        color: this.getRandomColor() // Regenerate color on reset
      };
      this.updateLeaderboard();
    }
  }

  generateFood() {
    let food;
    do {
      food = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE)
      };
    } while (this.snake.some(segment => segment.x === food.x && segment.y === food.y));
    return food;
  }

  updateStats() {
    this.speedDisplay.textContent = `Speed: ${this.speed.toFixed(1)}`;
    this.scoreDisplay.textContent = `Score: ${this.score}`;
  }

  draw() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw players' snakes
    if (this.multiplayer) {
      Object.entries(this.players).forEach(([id, player]) => {
        // Skip invalid players
        if (!player || !player.snake) return;
        
        // Set color for this player
        const isCurrentPlayer = id === this.clientId;
        const color = player.color || '#00ff00';
        
        // Check if player is invincible
        const isInvincible = isCurrentPlayer && Date.now() < this.invincibleUntil;
        
        // Calculate pulsing opacity for invincibility effect
        let opacity = 1;
        if (isInvincible) {
          // Pulse between 0.3 and 0.7 opacity
          opacity = 0.3 + (Math.sin(Date.now() / 100) + 1) * 0.2;
        }
        
        // Draw the snake segments
        player.snake.forEach((segment, index) => {
          if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
            // Use gradient for head of current player
            if (index === 0 && isCurrentPlayer) {
              const gradient = this.ctx.createRadialGradient(
                segment.x * CELL_SIZE + CELL_SIZE/2, 
                segment.y * CELL_SIZE + CELL_SIZE/2, 
                0,
                segment.x * CELL_SIZE + CELL_SIZE/2,
                segment.y * CELL_SIZE + CELL_SIZE/2,
                CELL_SIZE
              );
              gradient.addColorStop(0, '#ffffff');
              gradient.addColorStop(1, color);
              this.ctx.fillStyle = gradient;
              // Apply invincibility opacity to current player's head
              this.ctx.globalAlpha = opacity;
            } else {
              // Slightly different shades for body segments
              const alpha = isCurrentPlayer ? opacity : 0.8; // Apply invincibility to body segments
              this.ctx.fillStyle = `${color}${alpha === 1 ? '' : Math.round(alpha * 255).toString(16)}`;
              this.ctx.globalAlpha = alpha;
            }
            
            // Round corners for snake segments
            const radius = CELL_SIZE / 4;
            this.ctx.beginPath();
            this.ctx.roundRect(
              segment.x * CELL_SIZE,
              segment.y * CELL_SIZE,
              CELL_SIZE - 1,
              CELL_SIZE - 1,
              radius
            );
            this.ctx.fill();
            this.ctx.globalAlpha = 1; // Reset global alpha
          }
        });
      });
    } else {
      // Single player drawing with improved visuals
      // Check if player is invincible
      const isInvincible = Date.now() < this.invincibleUntil;
      
      // Calculate pulsing opacity for invincibility effect
      let opacity = 1;
      if (isInvincible) {
        // Pulse between 0.3 and 0.7 opacity
        opacity = 0.3 + (Math.sin(Date.now() / 100) + 1) * 0.2;
      }
      
      this.snake.forEach((segment, index) => {
        this.ctx.globalAlpha = opacity; // Apply invincibility effect
        
        if (index === 0) {
          // Head with gradient
          const gradient = this.ctx.createRadialGradient(
            segment.x * CELL_SIZE + CELL_SIZE/2, 
            segment.y * CELL_SIZE + CELL_SIZE/2, 
            0,
            segment.x * CELL_SIZE + CELL_SIZE/2,
            segment.y * CELL_SIZE + CELL_SIZE/2,
            CELL_SIZE
          );
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(1, '#00ff00');
          this.ctx.fillStyle = gradient;
        } else {
          // Body with slight variation
          this.ctx.fillStyle = `#00ff00`;
        }
        
        // Rounded rectangle for snake segments
        const radius = CELL_SIZE / 4;
        this.ctx.beginPath();
        this.ctx.roundRect(
          segment.x * CELL_SIZE,
          segment.y * CELL_SIZE,
          CELL_SIZE - 1,
          CELL_SIZE - 1,
          radius
        );
        this.ctx.fill();
        this.ctx.globalAlpha = 1; // Reset global alpha
      });
    }

    // Draw food with pulsing effect
    const pulseAmount = Math.sin(Date.now() / 200) * 0.1 + 0.9;
    const foodSize = CELL_SIZE * pulseAmount;
    const foodOffset = (CELL_SIZE - foodSize) / 2;
    
    // Create gradient for food
    const foodGradient = this.ctx.createRadialGradient(
      this.food.x * CELL_SIZE + CELL_SIZE/2,
      this.food.y * CELL_SIZE + CELL_SIZE/2,
      0,
      this.food.x * CELL_SIZE + CELL_SIZE/2,
      this.food.y * CELL_SIZE + CELL_SIZE/2,
      CELL_SIZE/2
    );
    foodGradient.addColorStop(0, '#ff8080');
    foodGradient.addColorStop(1, '#ff0000');
    
    this.ctx.fillStyle = foodGradient;
    this.ctx.beginPath();
    this.ctx.arc(
      this.food.x * CELL_SIZE + CELL_SIZE/2,
      this.food.y * CELL_SIZE + CELL_SIZE/2,
      foodSize/2,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
  }

  update(timestamp) {
    if (!this.gameStarted || this.gameOver) return;

    const deltaTime = (timestamp - this.lastUpdate) / 1000;
    if (deltaTime < 1 / this.speed) return;

    this.direction = this.nextDirection;
    const head = {
      x: this.snake[0].x + this.direction.x,
      y: this.snake[0].y + this.direction.y
    };

    // Check if player is invincible
    const isInvincible = Date.now() < this.invincibleUntil;

    // Check collision with walls or self
    if (
      head.x < 0 || head.x >= GRID_SIZE ||
      head.y < 0 || head.y >= GRID_SIZE ||
      (!isInvincible && this.snake.some(segment => segment.x === head.x && segment.y === head.y))
    ) {
      this.gameOver = true;
      this.gameOverDisplay.style.display = 'block';
      
      if (this.multiplayer && this.clientId) {
        this.room.send({
          type: 'player-die',
          player: {
            id: this.clientId
          }
        });
      }
      
      setTimeout(() => this.reset(), 2000);
      return;
    }

    // Multiplayer snake collision
    if (this.multiplayer && this.clientId && !isInvincible) {
      for (const [id, player] of Object.entries(this.players)) {
        if (player && id !== this.clientId && 
            player.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
          this.gameOver = true;
          this.gameOverDisplay.style.display = 'block';
          
          this.room.send({
            type: 'player-collision',
            players: [this.clientId, id]
          });
          
          setTimeout(() => this.reset(), 2000);
          return;
        }
      }
    }

    this.snake.unshift(head);

    // Check if food is eaten
    if (head.x === this.food.x && head.y === this.food.y) {
      this.score++;
      this.food = this.generateFood();
      this.updateStats();

      if (this.multiplayer && this.clientId) {
        this.room.send({
          type: 'food-eat',
          player: {
            id: this.clientId,
            snake: this.snake,
            score: this.score
          }
        });
      }
    } else {
      this.snake.pop();
    }

    // Sync player state in multiplayer
    if (this.multiplayer && this.clientId) {
      // Update local player state
      if (!this.players[this.clientId]) {
        this.players[this.clientId] = {
          username: this.username,
          color: this.getRandomColor()
        };
      }
      
      this.players[this.clientId] = {
        ...this.players[this.clientId],
        snake: [...this.snake], // Create a copy to avoid reference issues
        score: this.score,
        speed: this.speed,
        id: this.clientId,
        username: this.username
      };

      // Send update to other players
      this.broadcastPlayerState('player-move');
      this.updateLeaderboard();
    }

    this.lastUpdate = timestamp;
  }

  setupEventListeners() {
    const multiplayerToggle = document.getElementById('multiplayer-toggle');

    multiplayerToggle.addEventListener('change', () => {
      // Reset the game with the new mode
      window.game = new SnakeGame(multiplayerToggle.checked);
      window.game.gameLoop(0);
    });

    window.addEventListener('keydown', (e) => {
      if (!this.gameStarted) {
        this.gameStarted = true;
      }

      const key = e.key.toLowerCase();
      const newDirection = {x: this.nextDirection.x, y: this.nextDirection.y};

      if ((key === 'arrowleft' || key === 'a')) newDirection.x = -1, newDirection.y = 0;
      if ((key === 'arrowright' || key === 'd')) newDirection.x = 1, newDirection.y = 0;
      if ((key === 'arrowup' || key === 'w')) newDirection.x = 0, newDirection.y = -1;
      if ((key === 'arrowdown' || key === 's')) newDirection.x = 0, newDirection.y = 1;

      // Speed adjustment
      if (
        newDirection.x === this.direction.x &&
        newDirection.y === this.direction.y
      ) {
        this.speed = Math.min(this.speed + 1, MAX_SPEED);
      } else if (
        newDirection.x === -this.direction.x ||
        newDirection.y === -this.direction.y
      ) {
        this.speed = Math.max(this.speed - 1, MIN_SPEED);
      }
      else
      {
        this.nextDirection = newDirection;
      }
      this.updateStats();
    });
  }

  gameLoop(timestamp) {
    this.update(timestamp);
    this.draw();
    requestAnimationFrame(this.gameLoop.bind(this));
  }
}

window.onload = () => {
  // Set multiplayer toggle to checked by default
  document.getElementById('multiplayer-toggle').checked = true;
  window.game = new SnakeGame(true);
  window.game.gameLoop(0);
};