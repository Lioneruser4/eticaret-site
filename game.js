// Game Logic Manager
class GameManager {
    constructor() {
        this.gameState = 'lobby'; // lobby, playing, meeting, ended
        this.role = null;
        this.isAlive = true;
        this.tasks = [];
        this.completedTasks = 0;
        this.killCooldown = 0;
        this.emergencyCooldown = 0;
        this.canUseEmergency = true;
        this.emergencyMeetingsLeft = 1;

        this.joystick = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0
        };

        this.movement = {
            x: 0,
            z: 0
        };

        this.nearbyInteractables = {
            tasks: [],
            players: [],
            bodies: []
        };

        this.game3d = null;
        this.animationFrameId = null;
        this.paused = false;
    }

    init() {
        // Initialize 3D engine
        const canvas = document.getElementById('game-canvas');
        this.game3d = new Game3D(canvas);

        // Setup controls
        this.setupJoystick();
        this.setupActionButtons();

        // Start game loop
        this.startGameLoop();

        console.log('Game Manager initialized');
    }

    setupJoystick() {
        const joystickContainer = document.getElementById('joystick-container');
        const joystickStick = document.getElementById('joystick-stick');

        const handleStart = (e) => {
            if (this.paused) return;
            e.preventDefault();
            this.joystick.active = true;

            const touch = e.touches ? e.touches[0] : e;
            const rect = joystickContainer.getBoundingClientRect();
            this.joystick.startX = rect.left + rect.width / 2;
            this.joystick.startY = rect.top + rect.height / 2;

            window.telegramAuth?.vibrate('light');
        };

        const handleMove = (e) => {
            if (this.paused || !this.joystick.active) return;
            e.preventDefault();

            const touch = e.touches ? e.touches[0] : e;
            this.joystick.currentX = touch.clientX;
            this.joystick.currentY = touch.clientY;

            // Calculate offset
            const deltaX = this.joystick.currentX - this.joystick.startX;
            const deltaY = this.joystick.currentY - this.joystick.startY;

            // Limit to joystick radius
            const maxDistance = 35;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance > maxDistance) {
                const angle = Math.atan2(deltaY, deltaX);
                this.joystick.currentX = this.joystick.startX + Math.cos(angle) * maxDistance;
                this.joystick.currentY = this.joystick.startY + Math.sin(angle) * maxDistance;
            }

            // Update stick position
            const stickX = this.joystick.currentX - this.joystick.startX;
            const stickY = this.joystick.currentY - this.joystick.startY;
            joystickStick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

            // Calculate movement
            this.movement.x = deltaX / maxDistance;
            this.movement.z = deltaY / maxDistance;
        };

        const handleEnd = (e) => {
            e.preventDefault();
            this.joystick.active = false;
            this.movement.x = 0;
            this.movement.z = 0;

            // Reset stick position
            joystickStick.style.transform = 'translate(-50%, -50%)';
        };

        joystickContainer.addEventListener('touchstart', handleStart);
        joystickContainer.addEventListener('mousedown', handleStart);

        window.addEventListener('touchmove', handleMove);
        window.addEventListener('mousemove', handleMove);

        window.addEventListener('touchend', handleEnd);
        window.addEventListener('mouseup', handleEnd);
    }

    setupActionButtons() {
        // Use button
        document.getElementById('btn-use').addEventListener('click', () => {
            if (this.paused) return;
            this.handleUseAction();
        });

        // Report button
        document.getElementById('btn-report').addEventListener('click', () => {
            if (this.paused) return;
            this.handleReportAction();
        });

        // Kill button (imposter only)
        document.getElementById('btn-kill').addEventListener('click', () => {
            if (this.paused) return;
            this.handleKillAction();
        });

        // Sabotage button (imposter only)
        document.getElementById('btn-sabotage').addEventListener('click', () => {
            if (this.paused) return;
            this.handleSabotageAction();
        });

        // Emergency button
        document.getElementById('btn-emergency').addEventListener('click', () => {
            if (this.paused) return;
            this.handleEmergencyAction();
        });
    }

    startGameLoop() {
        const loop = () => {
            this.update();
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    stopGameLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    update() {
        if (this.paused || this.gameState !== 'playing' || !this.isAlive) return;

        // Update player movement
        if (this.movement.x !== 0 || this.movement.z !== 0) {
            this.updatePlayerMovement();
        }

        // Update cooldowns
        this.updateCooldowns();

        // Check nearby interactables
        this.checkNearbyInteractables();

        // Update UI
        this.updateGameUI();
    }

    render() {
        if (this.game3d) {
            this.game3d.render();
        }
    }

    updatePlayerMovement() {
        const player = this.game3d.players.get(this.game3d.localPlayer);
        if (!player) return;

        const speed = CONFIG.GAME.PLAYER_SPEED * 0.016; // 60 FPS

        // Calculate new position
        const newX = player.position.x + this.movement.x * speed;
        const newZ = player.position.z + this.movement.z * speed;

        // Calculate rotation
        const rotation = Math.atan2(this.movement.x, this.movement.z);

        // Update local position
        player.position.x = newX;
        player.position.z = newZ;
        player.rotation = rotation;
        player.mesh.position.set(newX, 1, newZ);
        player.mesh.rotation.y = rotation;

        // Send to server
        window.networkManager.movePlayer(
            { x: newX, y: 0, z: newZ },
            rotation
        );
    }

    updateCooldowns() {
        if (this.killCooldown > 0) {
            this.killCooldown -= 16; // ~60 FPS
            if (this.killCooldown < 0) this.killCooldown = 0;
        }

        if (this.emergencyCooldown > 0) {
            this.emergencyCooldown -= 16;
            if (this.emergencyCooldown < 0) this.emergencyCooldown = 0;
        }
    }

    checkNearbyInteractables() {
        const player = this.game3d.players.get(this.game3d.localPlayer);
        if (!player) return;

        // Check tasks
        this.nearbyInteractables.tasks = this.game3d.getNearbyTasks(
            player.position,
            CONFIG.GAME.TASK_INTERACTION_DISTANCE
        );

        // Check players (for killing)
        if (this.role === CONFIG.ROLES.IMPOSTER) {
            this.nearbyInteractables.players = this.game3d.getNearbyPlayers(
                player.position,
                CONFIG.GAME.KILL_DISTANCE
            );
        }

        // Check bodies (for reporting)
        this.nearbyInteractables.bodies = this.game3d.getNearbyBodies(
            player.position,
            CONFIG.GAME.REPORT_DISTANCE
        );
    }

    updateGameUI() {
        // Update Use button
        const useBtn = document.getElementById('btn-use');
        if (this.nearbyInteractables.tasks.length > 0) {
            useBtn.disabled = false;
            useBtn.style.borderColor = 'var(--success-color)';
        } else {
            useBtn.disabled = true;
            useBtn.style.borderColor = 'var(--border-color)';
        }

        // Update Report button
        const reportBtn = document.getElementById('btn-report');
        if (this.nearbyInteractables.bodies.length > 0) {
            reportBtn.disabled = false;
            reportBtn.style.borderColor = 'var(--primary-color)';
        } else {
            reportBtn.disabled = true;
            reportBtn.style.borderColor = 'var(--border-color)';
        }

        // Update Kill button (imposter only)
        if (this.role === CONFIG.ROLES.IMPOSTER) {
            const killBtn = document.getElementById('btn-kill');
            if (this.nearbyInteractables.players.length > 0 && this.killCooldown === 0) {
                killBtn.disabled = false;
                killBtn.style.borderColor = 'var(--danger-color)';
            } else {
                killBtn.disabled = true;
                killBtn.style.borderColor = 'var(--border-color)';
            }
        }

        // Update Emergency button
        const emergencyBtn = document.getElementById('btn-emergency');
        if (this.canUseEmergency && this.emergencyCooldown === 0 && this.emergencyMeetingsLeft > 0) {
            emergencyBtn.disabled = false;
        } else {
            emergencyBtn.disabled = true;
        }
    }

    handleUseAction() {
        if (this.nearbyInteractables.tasks.length > 0) {
            const task = this.nearbyInteractables.tasks[0];
            this.startTask(task.id, task.task.type);
            window.telegramAuth?.vibrate('medium');
        }
    }

    handleReportAction() {
        if (this.nearbyInteractables.bodies.length > 0) {
            const body = this.nearbyInteractables.bodies[0];
            window.networkManager.reportBody(body.id);
            window.telegramAuth?.vibrate('heavy');
        }
    }

    handleKillAction() {
        if (this.role === CONFIG.ROLES.IMPOSTER &&
            this.nearbyInteractables.players.length > 0 &&
            this.killCooldown === 0) {
            const target = this.nearbyInteractables.players[0];
            window.networkManager.killPlayer(target.id);
            this.killCooldown = CONFIG.GAME.KILL_COOLDOWN;
            window.telegramAuth?.vibrate('heavy');
        }
    }

    handleSabotageAction() {
        if (this.role === CONFIG.ROLES.IMPOSTER) {
            // Show sabotage menu (simplified)
            const sabotageType = 'lights'; // Could be lights, o2, reactor, etc.
            window.networkManager.triggerSabotage(sabotageType);
            window.telegramAuth?.vibrate('medium');
        }
    }

    handleEmergencyAction() {
        if (this.canUseEmergency && this.emergencyCooldown === 0 && this.emergencyMeetingsLeft > 0) {
            window.networkManager.callEmergency();
            this.emergencyCooldown = CONFIG.GAME.EMERGENCY_COOLDOWN;
            this.emergencyMeetingsLeft--;
            window.telegramAuth?.vibrate('heavy');
        }
    }

    startTask(taskId, taskType) {
        // Simplified task completion (in real game, would show task UI)
        setTimeout(() => {
            this.completeTask(taskId);
        }, 2000);
    }

    completeTask(taskId) {
        this.game3d.completeTask(taskId);
        this.completedTasks++;
        window.networkManager.completeTask(taskId);

        // Update task progress
        const taskText = document.getElementById('task-text');
        const taskFill = document.getElementById('task-fill');
        taskText.textContent = `${this.completedTasks}/${this.tasks.length}`;
        taskFill.style.width = `${(this.completedTasks / this.tasks.length) * 100}%`;

        window.telegramAuth?.vibrate('medium');
    }

    startGame(gameData) {
        this.gameState = 'playing';
        this.role = gameData.role;
        this.tasks = gameData.tasks || [];
        this.completedTasks = 0;
        this.isAlive = true;
        this.emergencyMeetingsLeft = gameData.emergencyMeetings || 1;

        // Create players
        gameData.players.forEach(player => {
            this.game3d.createPlayer(player.id, player);
        });

        // Set local player
        this.game3d.setLocalPlayer(window.networkManager.playerId);

        // Show role-specific buttons
        if (this.role === CONFIG.ROLES.IMPOSTER) {
            document.getElementById('btn-kill').classList.remove('hidden');
            document.getElementById('btn-sabotage').classList.remove('hidden');
        } else {
            document.getElementById('btn-kill').classList.add('hidden');
            document.getElementById('btn-sabotage').classList.add('hidden');
        }

        // Update task UI
        const taskText = document.getElementById('task-text');
        taskText.textContent = `0/${this.tasks.length}`;

        console.log('Game started with role:', this.role);
    }

    endGame(result) {
        this.gameState = 'ended';
        this.stopGameLoop();

        console.log('Game ended:', result);
    }

    reset() {
        this.gameState = 'lobby';
        this.role = null;
        this.isAlive = true;
        this.tasks = [];
        this.completedTasks = 0;
        this.killCooldown = 0;
        this.emergencyCooldown = 0;
        this.canUseEmergency = true;
        this.movement.x = 0;
        this.movement.z = 0;

        if (this.game3d) {
            this.game3d.clear();
        }
    }
}

// Global instance
window.gameManager = new GameManager();
