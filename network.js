// Network Manager - WebSocket bağlantısı ve sunucu iletişimi
class NetworkManager {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.currentRoom = null;
        this.playerId = null;

        this.eventHandlers = {};
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(CONFIG.WS_URL);

                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    const wasReconnecting = this.reconnectAttempts > 0;
                    this.connected = true;
                    this.reconnectAttempts = 0;

                    // Kullanıcı bilgilerini gönder
                    this.authenticate();

                    if (wasReconnecting) {
                        this.emit('connection_restored');
                    }

                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('WebSocket disconnected');
                    if (this.connected) {
                        this.connected = false;
                        this.emit('connection_lost');
                    }
                    this.attemptReconnect();
                };

            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                this.attemptReconnect();
                reject(error);
            }
        });
    }

    reconnect() {
        this.reconnectAttempts = 0;
        return this.connect();
    }

    attemptReconnect() {
        // High limit for "never disconnect"
        const maxAttempts = 100;
        if (this.reconnectAttempts < maxAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${maxAttempts}`);

            this.emit('reconnecting', {
                attempt: this.reconnectAttempts,
                max: maxAttempts,
                url: CONFIG.WS_URL
            });

            setTimeout(() => {
                this.connect().catch(err => {
                    console.error('Reconnection attempt failed:', err.message);
                });
            }, this.reconnectDelay);
        } else {
            console.error('Max reconnection attempts reached');
            this.emit('connection_failed');
            window.telegramAuth?.showAlert(`Sunucu ile bağlantı kurulamadı (${CONFIG.WS_URL}). Lütfen Render panelinden sunucunun açık olduğunu kontrol edin.`);
        }
    }

    authenticate() {
        const user = window.telegramAuth.getUser();
        this.send('auth', {
            userId: user.id,
            username: window.telegramAuth.getUserName(),
            avatar: window.telegramAuth.getUserAvatar(),
            isGuest: window.telegramAuth.isGuestUser()
        });
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            const { type, payload } = message;

            console.log('Received message:', type, payload);

            // Event handler'ı çağır
            if (this.eventHandlers[type]) {
                this.eventHandlers[type].forEach(handler => handler(payload));
            }

            // Built-in handlers
            switch (type) {
                case 'auth_success':
                    this.playerId = payload.playerId;
                    this.emit('authenticated', payload);
                    break;

                case 'room_list':
                    this.emit('roomListUpdated', payload.rooms);
                    break;

                case 'room_created':
                    this.currentRoom = payload.room;
                    this.emit('roomJoined', payload.room);
                    break;

                case 'room_joined':
                    this.currentRoom = payload.room;
                    this.emit('roomJoined', payload.room);
                    break;

                case 'room_updated':
                    this.currentRoom = payload.room;
                    this.emit('roomUpdated', payload.room);
                    break;

                case 'player_joined':
                    this.emit('playerJoined', payload);
                    break;

                case 'player_left':
                    this.emit('playerLeft', payload);
                    break;

                case 'player_ready':
                    this.emit('playerReady', payload);
                    break;

                case 'game_starting':
                    this.emit('gameStarting', payload);
                    break;

                case 'game_started':
                    this.emit('gameStarted', payload);
                    break;

                case 'role_assigned':
                    this.emit('roleAssigned', payload);
                    break;

                case 'player_moved':
                    this.emit('playerMoved', payload);
                    break;

                case 'player_killed':
                    this.emit('playerKilled', payload);
                    break;

                case 'body_reported':
                    this.emit('bodyReported', payload);
                    break;

                case 'emergency_called':
                    this.emit('emergencyCalled', payload);
                    break;

                case 'meeting_started':
                    this.emit('meetingStarted', payload);
                    break;

                case 'chat_message':
                    this.emit('chatMessage', payload);
                    break;

                case 'vote_cast':
                    this.emit('voteCast', payload);
                    break;

                case 'voting_ended':
                    this.emit('votingEnded', payload);
                    break;

                case 'player_ejected':
                    this.emit('playerEjected', payload);
                    break;

                case 'task_completed':
                    this.emit('taskCompleted', payload);
                    break;

                case 'sabotage_triggered':
                    this.emit('sabotageTriggered', payload);
                    break;

                case 'game_ended':
                    this.emit('gameEnded', payload);
                    break;

                case 'error':
                    console.error('Server error:', payload.message);
                    window.telegramAuth?.showAlert(payload.message);
                    break;

                case 'online_count':
                    this.emit('onlineCountUpdated', payload.count);
                    break;
            }

        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }

    send(type, payload = {}) {
        if (!this.connected || !this.ws) {
            console.error('WebSocket not connected');
            return;
        }

        const message = JSON.stringify({ type, payload });
        this.ws.send(message);
    }

    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }

    off(event, handler) {
        if (!this.eventHandlers[event]) return;

        const index = this.eventHandlers[event].indexOf(handler);
        if (index > -1) {
            this.eventHandlers[event].splice(index, 1);
        }
    }

    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    // Room operations
    requestRoomList() {
        this.send('get_rooms');
    }

    createRoom(settings) {
        this.send('create_room', settings);
    }

    joinRoom(roomCode, password = null) {
        this.send('join_room', { roomCode, password });
    }

    leaveRoom() {
        this.send('leave_room');
        this.currentRoom = null;
    }

    setReady(ready) {
        this.send('set_ready', { ready });
    }

    startGame() {
        this.send('start_game');
    }

    // Game operations
    movePlayer(position, rotation) {
        this.send('move_player', { position, rotation });
    }

    killPlayer(targetId) {
        this.send('kill_player', { targetId });
    }

    reportBody(bodyId) {
        this.send('report_body', { bodyId });
    }

    callEmergency() {
        this.send('call_emergency');
    }

    sendChatMessage(message) {
        this.send('chat_message', { message });
    }

    castVote(targetId) {
        this.send('cast_vote', { targetId });
    }

    skipVote() {
        this.send('cast_vote', { targetId: null });
    }

    completeTask(taskId) {
        this.send('complete_task', { taskId });
    }

    triggerSabotage(sabotageType) {
        this.send('trigger_sabotage', { sabotageType });
    }

    leaveGame() {
        this.send('leave_game');
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }
}

// Global instance
window.networkManager = new NetworkManager();
