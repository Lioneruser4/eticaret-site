// Main Application Entry Point
class AmongUsGame {
    constructor() {
        this.initialized = false;
    }

    async init() {
        try {
            console.log('Initializing Among Us Game...');

            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }

            // Initialize managers
            await this.initializeManagers();

            // Setup network event handlers
            this.setupNetworkHandlers();

            // Update user profile
            window.uiManager.updateUserProfile();

            // Hide loading screen and show main menu
            setTimeout(() => {
                document.getElementById('loading-screen').classList.add('hidden');
                window.uiManager.showScreen('main-menu');
            }, 1500);

            this.initialized = true;
            console.log('Among Us Game initialized successfully!');

        } catch (error) {
            console.error('Failed to initialize game:', error);
            alert('Oyun başlatılamadı. Lütfen sayfayı yenileyin.');
        }
    }

    async initializeManagers() {
        const loadingStatus = document.getElementById('loading-status');

        // Connect to server
        try {
            if (loadingStatus) loadingStatus.textContent = 'Sunucuya bağlanıyor...';
            await window.networkManager.connect();
            if (loadingStatus) loadingStatus.textContent = 'Sunucuya bağlandı! ✓';
            console.log('Connected to server');
        } catch (error) {
            console.error('Failed to connect to server:', error);
            if (loadingStatus) loadingStatus.textContent = 'Bağlantı hatası! Yeniden deneniyor...';
        }
    }

    setupNetworkHandlers() {
        const nm = window.networkManager;
        const ui = window.uiManager;
        const gm = window.gameManager;

        // Connection State
        nm.on('connection_lost', () => {
            console.warn('Connection lost!');
            ui.showFreezeScreen('Bağlantı koptu. Yeniden bağlanılıyor...');
            gm.paused = true;
        });

        nm.on('connection_restored', () => {
            console.log('Connection restored!');
            ui.hideFreezeScreen();
            gm.paused = false;
            // Re-auth happens inside networkManager.connect() -> authenticate()
        });

        nm.on('reconnecting', (data) => {
            ui.updateFreezeStatus(`Yeniden bağlanma denemesi: ${data.attempt}/100`);
        });

        // Authentication
        nm.on('authenticated', (data) => {
            console.log('Authenticated as player:', data.playerId);
        });

        // Online count
        nm.on('onlineCountUpdated', (count) => {
            ui.updateOnlineCount(count);
        });

        // Room list
        nm.on('roomListUpdated', (rooms) => {
            ui.updateRoomList(rooms);
        });

        // Room joined
        nm.on('roomJoined', (room) => {
            ui.showRoomLobby(room);
            window.telegramAuth?.vibrate('medium');
        });

        // Room updated
        nm.on('roomUpdated', (room) => {
            if (ui.currentScreen === 'room-lobby-screen') {
                ui.showRoomLobby(room);
            }
        });

        // Player joined
        nm.on('playerJoined', (data) => {
            if (ui.currentScreen === 'room-lobby-screen' && nm.currentRoom) {
                ui.updatePlayerGrid(nm.currentRoom.players);
            }
        });

        // Player left
        nm.on('playerLeft', (data) => {
            if (ui.currentScreen === 'room-lobby-screen' && nm.currentRoom) {
                ui.updatePlayerGrid(nm.currentRoom.players);
            }
        });

        // Player ready
        nm.on('playerReady', (data) => {
            if (ui.currentScreen === 'room-lobby-screen' && nm.currentRoom) {
                ui.updateReadyStatus(nm.currentRoom);
            }
        });

        // Game starting
        nm.on('gameStarting', (data) => {
            console.log('Game starting in', data.countdown, 'seconds');
            window.telegramAuth?.vibrate('heavy');
        });

        // Game started
        nm.on('gameStarted', (data) => {
            console.log('Game started!');
            ui.showScreen('game-screen');
            gm.init();
            gm.startGame(data);
            window.telegramAuth?.vibrate('heavy');
        });

        // Role assigned
        nm.on('roleAssigned', (data) => {
            ui.showRoleReveal(data.role);
        });

        // Player moved
        nm.on('playerMoved', (data) => {
            if (gm.game3d && data.playerId !== nm.playerId) {
                gm.game3d.updatePlayerPosition(data.playerId, data.position, data.rotation);
            }
        });

        // Player killed
        nm.on('playerKilled', (data) => {
            if (gm.game3d) {
                gm.game3d.killPlayer(data.victimId);
            }

            if (data.victimId === nm.playerId) {
                gm.isAlive = false;
                window.telegramAuth?.showAlert('Öldürüldün!');
                window.telegramAuth?.vibrate('heavy');
            }
        });

        // Body reported
        nm.on('bodyReported', (data) => {
            console.log('Body reported by', data.reporter);
        });

        // Emergency called
        nm.on('emergencyCalled', (data) => {
            console.log('Emergency meeting called by', data.caller);
        });

        // Meeting started
        nm.on('meetingStarted', (data) => {
            ui.showMeeting(data);
            window.telegramAuth?.vibrate('heavy');
        });

        // Chat message
        nm.on('chatMessage', (data) => {
            ui.addChatMessage(data.username, data.message);
        });

        // Vote cast
        nm.on('voteCast', (data) => {
            console.log('Vote cast:', data);
        });

        // Voting ended
        nm.on('votingEnded', (data) => {
            ui.showVotingResult(data);
        });

        // Player ejected
        nm.on('playerEjected', (data) => {
            console.log('Player ejected:', data);
        });

        // Task completed
        nm.on('taskCompleted', (data) => {
            console.log('Task completed:', data);
        });

        // Sabotage triggered
        nm.on('sabotageTriggered', (data) => {
            console.log('Sabotage triggered:', data.type);
            window.telegramAuth?.showAlert(`Sabotaj: ${data.type}`);
            window.telegramAuth?.vibrate('heavy');
        });

        // Game ended
        nm.on('gameEnded', (data) => {
            ui.showGameOver(data);
            gm.endGame(data);
            window.telegramAuth?.vibrate('heavy');
        });
    }
}

// Start the application
const app = new AmongUsGame();
app.init();
