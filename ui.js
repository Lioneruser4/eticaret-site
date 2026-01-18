// UI Manager
class UIManager {
    constructor() {
        this.currentScreen = 'loading-screen';
        this.currentRoom = null;
        this.selectedVoteTarget = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        console.log('UI Manager initialized');
    }

    setupEventListeners() {
        // Main Menu buttons
        document.getElementById('btn-quick-match').addEventListener('click', () => {
            this.handleQuickMatch();
        });

        document.getElementById('btn-create-room').addEventListener('click', () => {
            this.showScreen('create-room-screen');
        });

        document.getElementById('btn-join-room').addEventListener('click', () => {
            this.showScreen('join-room-screen');
            window.networkManager.requestRoomList();
        });

        // Create Room
        document.getElementById('btn-back-from-create').addEventListener('click', () => {
            this.showScreen('main-menu');
        });

        document.getElementById('btn-create-room-confirm').addEventListener('click', () => {
            this.handleCreateRoom();
        });

        // Range inputs
        this.setupRangeInputs();

        // Join Room
        document.getElementById('btn-back-from-join').addEventListener('click', () => {
            this.showScreen('main-menu');
        });

        // Room Lobby
        document.getElementById('btn-leave-room').addEventListener('click', () => {
            window.networkManager.leaveRoom();
            this.showScreen('main-menu');
        });

        document.getElementById('btn-ready').addEventListener('click', () => {
            this.handleReadyToggle();
        });

        document.getElementById('btn-start-game').addEventListener('click', () => {
            window.networkManager.startGame();
        });

        // Meeting
        document.getElementById('btn-send-chat').addEventListener('click', () => {
            this.handleSendChat();
        });

        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSendChat();
            }
        });

        // Game Over
        document.getElementById('btn-back-to-menu').addEventListener('click', () => {
            this.showScreen('main-menu');
            window.gameManager.reset();
        });

        // Password Modal
        document.getElementById('btn-cancel-password').addEventListener('click', () => {
            this.hidePasswordModal();
        });

        document.getElementById('btn-submit-password').addEventListener('click', () => {
            this.handlePasswordSubmit();
        });
    }

    setupRangeInputs() {
        const ranges = [
            { id: 'max-players', valueId: 'max-players-value' },
            { id: 'imposter-count', valueId: 'imposter-count-value' },
            { id: 'police-count', valueId: 'police-count-value' },
            { id: 'task-count', valueId: 'task-count-value' },
            { id: 'emergency-count', valueId: 'emergency-count-value' },
            { id: 'discussion-time', valueId: 'discussion-time-value' },
            { id: 'voting-time', valueId: 'voting-time-value' }
        ];

        ranges.forEach(range => {
            const input = document.getElementById(range.id);
            const valueDisplay = document.getElementById(range.valueId);

            input.addEventListener('input', () => {
                valueDisplay.textContent = input.value;
            });
        });
    }

    showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });

        // Show target screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.remove('hidden');
            this.currentScreen = screenId;

            // Update Telegram back button
            if (screenId === 'main-menu') {
                window.telegramAuth?.hideBackButton();
            } else {
                window.telegramAuth?.showBackButton();
            }
        }
    }

    updateUserProfile() {
        const userName = window.telegramAuth.getUserName();
        document.getElementById('user-name-display').textContent = userName;
    }

    handleQuickMatch() {
        // Show join room screen with room list
        this.showScreen('join-room-screen');
        window.networkManager.requestRoomList();
        window.telegramAuth?.vibrate('medium');
    }

    handleCreateRoom() {
        const settings = {
            name: document.getElementById('room-name').value || 'Yeni Oda',
            password: document.getElementById('room-password').value || null,
            maxPlayers: parseInt(document.getElementById('max-players').value),
            imposterCount: parseInt(document.getElementById('imposter-count').value),
            policeCount: parseInt(document.getElementById('police-count').value),
            taskCount: parseInt(document.getElementById('task-count').value),
            emergencyMeetings: parseInt(document.getElementById('emergency-count').value),
            discussionTime: parseInt(document.getElementById('discussion-time').value),
            votingTime: parseInt(document.getElementById('voting-time').value)
        };

        window.networkManager.createRoom(settings);
        window.telegramAuth?.vibrate('medium');
    }

    updateRoomList(rooms) {
        const roomList = document.getElementById('room-list');
        roomList.innerHTML = '';

        if (rooms.length === 0) {
            roomList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">Aktif oda bulunamadı</div>';
            return;
        }

        rooms.forEach(room => {
            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';

            roomCard.innerHTML = `
                <div class="room-card-header">
                    <div class="room-name">${room.name}</div>
                    <div class="room-players">${room.currentPlayers}/${room.maxPlayers}</div>
                </div>
                <div class="room-info">
                    <span class="room-tag">🎭 ${room.imposterCount} İmposter</span>
                    <span class="room-tag">👮 ${room.policeCount} Polis</span>
                    <span class="room-tag">📋 ${room.taskCount} Görev</span>
                    ${room.hasPassword ? '<span class="room-tag room-locked">🔒 Şifreli</span>' : ''}
                </div>
            `;

            roomCard.addEventListener('click', () => {
                if (room.hasPassword) {
                    this.showPasswordModal(room.code);
                } else {
                    window.networkManager.joinRoom(room.code);
                }
                window.telegramAuth?.vibrate('light');
            });

            roomList.appendChild(roomCard);
        });
    }

    showPasswordModal(roomCode) {
        const modal = document.getElementById('password-modal');
        modal.classList.remove('hidden');
        modal.dataset.roomCode = roomCode;
        document.getElementById('modal-password').value = '';
        document.getElementById('modal-password').focus();
    }

    hidePasswordModal() {
        const modal = document.getElementById('password-modal');
        modal.classList.add('hidden');
        delete modal.dataset.roomCode;
    }

    handlePasswordSubmit() {
        const modal = document.getElementById('password-modal');
        const roomCode = modal.dataset.roomCode;
        const password = document.getElementById('modal-password').value;

        if (roomCode && password) {
            window.networkManager.joinRoom(roomCode, password);
            this.hidePasswordModal();
        }
    }

    showRoomLobby(room) {
        this.currentRoom = room;
        this.showScreen('room-lobby-screen');

        document.getElementById('lobby-room-name').textContent = room.name;
        document.getElementById('lobby-code').textContent = room.code;

        // Update settings summary
        const settingsSummary = document.getElementById('lobby-settings');
        settingsSummary.innerHTML = `
            <span class="room-tag">🎭 ${room.settings.imposterCount} İmposter</span>
            <span class="room-tag">👮 ${room.settings.policeCount} Polis</span>
            <span class="room-tag">📋 ${room.settings.taskCount} Görev</span>
            <span class="room-tag">⏱️ ${room.settings.discussionTime}s Tartışma</span>
            <span class="room-tag">🗳️ ${room.settings.votingTime}s Oylama</span>
        `;

        this.updatePlayerGrid(room.players);
        this.updateReadyStatus(room);
    }

    updatePlayerGrid(players) {
        const grid = document.getElementById('players-grid');
        grid.innerHTML = '';

        players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            if (player.ready) card.classList.add('ready');
            if (player.isHost) card.classList.add('host');

            card.innerHTML = `
                <img src="${player.avatar}" alt="${player.username}" class="player-avatar">
                <div class="player-name">${player.username}</div>
                <div class="player-status">${player.ready ? '✓ Hazır' : player.isHost ? '👑 Host' : 'Bekliyor'}</div>
            `;

            grid.appendChild(card);
        });
    }

    updateReadyStatus(room) {
        const readyCount = room.players.filter(p => p.ready).length;
        const totalCount = room.players.length;

        document.getElementById('ready-count').textContent = readyCount;
        document.getElementById('total-count').textContent = room.settings.maxPlayers;

        // Show start button for host if all ready
        const localPlayer = room.players.find(p => p.id === window.networkManager.playerId);
        if (localPlayer && localPlayer.isHost) {
            const startBtn = document.getElementById('btn-start-game');
            if (readyCount === totalCount && totalCount >= CONFIG.GAME.MIN_PLAYERS) {
                startBtn.classList.remove('hidden');
            } else {
                startBtn.classList.add('hidden');
            }
        }
    }

    handleReadyToggle() {
        const btn = document.getElementById('btn-ready');
        const isReady = btn.textContent === 'Hazır';

        window.networkManager.setReady(!isReady);
        btn.textContent = isReady ? 'Hazır Değil' : 'Hazır';
        btn.classList.toggle('btn-success');

        window.telegramAuth?.vibrate('light');
    }

    showRoleReveal(role) {
        const roleReveal = document.getElementById('role-reveal');
        const roleTitle = document.getElementById('role-title');
        const roleIcon = document.getElementById('role-icon');
        const roleDescription = document.getElementById('role-description');

        roleReveal.classList.remove('hidden');

        switch (role) {
            case CONFIG.ROLES.CREWMATE:
                roleTitle.textContent = 'Crewmate';
                roleIcon.className = 'role-icon crewmate';
                roleDescription.textContent = 'Görevleri tamamla ve imposteri bul!';
                break;

            case CONFIG.ROLES.IMPOSTER:
                roleTitle.textContent = 'Imposter';
                roleIcon.className = 'role-icon imposter';
                roleDescription.textContent = 'Crewmate\'leri öldür ve yakalanma!';
                break;

            case CONFIG.ROLES.POLICE:
                roleTitle.textContent = 'Polis';
                roleIcon.className = 'role-icon police';
                roleDescription.textContent = 'Görevleri tamamla ve imposteri yakala!';
                break;
        }

        // Hide after 5 seconds
        setTimeout(() => {
            roleReveal.classList.add('hidden');
        }, 5000);
    }

    showMeeting(data) {
        this.showScreen('meeting-screen');

        const title = document.getElementById('meeting-title');
        const body = document.getElementById('meeting-body');

        if (data.type === 'body') {
            title.textContent = 'Ceset Bulundu!';
            body.innerHTML = `<div class="body-info">${data.reporter} bir ceset bildirdi!</div>`;
        } else {
            title.textContent = 'Acil Toplantı';
            body.innerHTML = `<div class="body-info">${data.caller} acil toplantı çağırdı!</div>`;
        }

        this.updateVotingPlayers(data.players);
        this.startMeetingTimer(data.discussionTime + data.votingTime);
    }

    updateVotingPlayers(players) {
        const container = document.getElementById('players-voting');
        container.innerHTML = '';

        players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'voting-player';
            if (player.isDead) card.classList.add('dead');

            card.innerHTML = `
                <img src="${player.avatar}" alt="${player.username}" class="player-avatar">
                <div class="player-name">${player.username}</div>
                ${player.voteCount > 0 ? `<div class="vote-count">${player.voteCount}</div>` : ''}
            `;

            if (!player.isDead && !window.gameManager.isAlive === false) {
                card.addEventListener('click', () => {
                    this.handleVote(player.id);
                });
            }

            container.appendChild(card);
        });

        // Add skip vote option
        const skipCard = document.createElement('div');
        skipCard.className = 'voting-player';
        skipCard.innerHTML = `
            <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 24px;">⏭️</div>
            <div class="player-name">Atla</div>
        `;
        skipCard.addEventListener('click', () => {
            this.handleVote(null);
        });
        container.appendChild(skipCard);
    }

    handleVote(targetId) {
        // Remove previous selection
        document.querySelectorAll('.voting-player').forEach(card => {
            card.classList.remove('selected');
        });

        // Select new target
        event.currentTarget.classList.add('selected');
        this.selectedVoteTarget = targetId;

        // Send vote
        if (targetId === null) {
            window.networkManager.skipVote();
        } else {
            window.networkManager.castVote(targetId);
        }

        window.telegramAuth?.vibrate('medium');
    }

    startMeetingTimer(seconds) {
        const timerDisplay = document.getElementById('meeting-timer');
        let remaining = seconds;

        const interval = setInterval(() => {
            remaining--;
            timerDisplay.textContent = remaining;

            if (remaining <= 0) {
                clearInterval(interval);
            }
        }, 1000);
    }

    showVotingResult(result) {
        const resultsDiv = document.getElementById('voting-results');
        resultsDiv.classList.remove('hidden');

        if (result.ejected) {
            resultsDiv.innerHTML = `
                <div class="ejected-player">${result.ejected.username} dışarı atıldı!</div>
                <div class="ejection-result">${result.wasImposter ? 'Imposter idi!' : 'Imposter değildi...'}</div>
            `;
        } else {
            resultsDiv.innerHTML = `
                <div class="ejection-result">Kimse dışarı atılmadı</div>
            `;
        }

        setTimeout(() => {
            resultsDiv.classList.add('hidden');
            this.showScreen('game-screen');
        }, 5000);
    }

    handleSendChat() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();

        if (message) {
            window.networkManager.sendChatMessage(message);
            input.value = '';
        }
    }

    addChatMessage(username, message) {
        const container = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `
            <span class="chat-author">${username}:</span>
            <span class="chat-text">${message}</span>
        `;
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }

    showGameOver(result) {
        this.showScreen('game-over-screen');

        const title = document.getElementById('game-over-title');
        const reason = document.getElementById('game-over-reason');
        const winnersList = document.getElementById('winners-list');

        if (result.winner === 'crewmates') {
            title.textContent = 'Crewmates Kazandı!';
            title.style.background = 'linear-gradient(135deg, #5352ed, #26de81)';
        } else {
            title.textContent = 'Imposterler Kazandı!';
            title.style.background = 'linear-gradient(135deg, #ff4757, #fc5c65)';
        }

        reason.textContent = result.reason;

        // Show winners
        winnersList.innerHTML = '';
        result.winners.forEach(winner => {
            const item = document.createElement('div');
            item.className = 'winner-item';
            item.innerHTML = `
                <img src="${winner.avatar}" alt="${winner.username}" class="winner-avatar">
                <div class="winner-name">${winner.username}</div>
                <div class="winner-role">${winner.role}</div>
            `;
            winnersList.appendChild(item);
        });
    }

    updateOnlineCount(count) {
        const el = document.getElementById('online-players');
        if (el) el.textContent = count;
    }

    // Freeze Overlay management
    showFreezeScreen(message) {
        const overlay = document.getElementById('freeze-overlay');
        const status = document.getElementById('freeze-status');
        if (overlay) overlay.classList.remove('hidden');
        if (status) status.textContent = message;
    }

    hideFreezeScreen() {
        const overlay = document.getElementById('freeze-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    updateFreezeStatus(message) {
        const status = document.getElementById('freeze-status');
        if (status) status.textContent = message;
    }
}

// Global instance
window.uiManager = new UIManager();
